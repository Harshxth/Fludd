"""Cutting an area run into tiles (docs/regions.md).

The rule that matters: the files of a tile give every cell the same water, hour by hour,
as the area run it was cut from.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from scipy.ndimage import gaussian_filter

from gold import export
from gold.tiles import local_bowls, split, touches
from model.depressions import find_bowls
from silver.elevation import Grid

USF_BOX = (-82.4467, 28.0297, -82.3811, 28.0877)
TAMPA_BOX = (-82.56, 27.92, -82.36, 28.10)


def test_an_area_the_size_of_one_tile_is_one_tile() -> None:
    (cut,) = split((2125, 2146), USF_BOX)
    assert (cut.rows, cut.cols) == (slice(0, 2125), slice(0, 2146))
    assert cut.bbox == USF_BOX


def test_tiles_cover_every_cell_once_and_share_edges() -> None:
    shape = (6634, 6552)
    cuts = split(shape, TAMPA_BOX)
    assert len(cuts) == 9
    seen = np.zeros(shape, dtype=np.int8)
    for cut in cuts:
        seen[cut.rows, cut.cols] += 1
    assert (seen == 1).all()
    assert len({cut.name for cut in cuts}) == 9
    by_name = {cut.name: cut for cut in cuts}
    # north row first: r0 holds the north edge, and r0c0's east edge is r0c1's west edge
    assert by_name["r0c0"].bbox[3] == TAMPA_BOX[3] and by_name["r0c0"].bbox[0] == TAMPA_BOX[0]
    assert by_name["r0c0"].bbox[2] == by_name["r0c1"].bbox[0]
    assert by_name["r0c0"].bbox[1] == by_name["r1c0"].bbox[3]
    assert by_name["r2c2"].bbox[1] == TAMPA_BOX[1] and by_name["r2c2"].bbox[2] == TAMPA_BOX[2]


def test_local_bowls_renumbers_from_one_in_node_order() -> None:
    node = np.array([[-1, 7, 7], [3, 3, 900_000]])
    ids, nodes = local_bowls(node)
    assert ids.tolist() == [[0, 2, 2], [1, 1, 3]]
    assert nodes.tolist() == [3, 7, 900_000]


def test_local_bowls_changes_nothing_when_every_bowl_is_there() -> None:
    node = np.array([[0, 1, -1], [2, 2, 1]])
    ids, nodes = local_bowls(node)
    assert ids.tolist() == (node + 1).tolist()
    assert nodes.tolist() == [0, 1, 2]


def test_local_bowls_refuses_more_bowls_than_the_image_holds() -> None:
    with pytest.raises(RuntimeError, match="65535"):
        local_bowls(np.arange(65_536).reshape(256, 256))


def _decode(path: Path, low: int) -> np.ndarray:
    """A gold PNG back to one number per cell; `low` is the channel holding the low byte."""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int64)
    return rgb[..., low] + rgb[..., 1 - low] * 256


def test_tile_files_give_the_same_water_as_the_area_run(tmp_path: Path) -> None:
    rng = np.random.default_rng(7)
    ground = gaussian_filter(rng.random((40, 60)), 3) * 40 + 10
    grid = Grid(ground, (-82.5, 28.0, -82.44, 28.04), 3.0, 3.0)
    tree = find_bowls(ground, grid.cell_size_m)
    assert tree.n >= 4, "the made-up ground needs several bowls for this test to mean anything"
    hours = 5
    levels = tree.min_m[:, None] + rng.random((tree.n, hours))
    node = tree.cell_node.reshape(ground.shape)
    # what levels_json writes for a bowl: 2 decimals, never below the bowl's floor
    written = np.maximum(np.round(levels, 2), np.ceil(tree.min_m[:, None] * 100) / 100)

    cuts = split(ground.shape, grid.bbox, target_cells=20)
    assert len(cuts) == 6
    for cut in cuts:
        out = tmp_path / cut.name
        tile, (lo, hi) = export.write_tile(out, cut, grid, tree, pump_nodes=[0], runs=[("milton", "off", "", levels)])
        assert tile.bbox == cut.bbox and tile.ground_m.shape == ground[cut.rows, cut.cols].shape

        ids = _decode(out / "bowls.png", low=0)
        bowls = json.loads((out / "bowls.json").read_text())
        series = json.loads((out / "levels" / "milton-pump-off.json").read_text())["levels"]
        assert [b["id"] for b in bowls] == list(range(1, len(bowls) + 1))
        assert set(series) == {str(b["id"]) for b in bowls}
        known = {b["id"] for b in bowls} | {None}
        assert all(b["spillsTo"] in known and b["parent"] in known for b in bowls)

        want_node = node[cut.rows, cut.cols]
        assert ((ids == 0) == (want_node < 0)).all()
        for r, c in zip(*np.nonzero(ids)):
            assert series[str(ids[r, c])] == written[want_node[r, c]].tolist()

        got_ground = _decode(out / "ground.png", low=1) / 65535 * (hi - lo) + lo
        assert np.abs(got_ground - ground[cut.rows, cut.cols]).max() <= (hi - lo) / 65535


def test_a_layer_feature_is_kept_when_its_box_meets_the_tile() -> None:
    tile = (0.0, 0.0, 1.0, 1.0)
    assert touches({"type": "Point", "coordinates": [0.5, 0.5]}, tile)
    assert touches({"type": "LineString", "coordinates": [[-1.0, 0.5], [2.0, 0.5]]}, tile)
    assert not touches({"type": "Polygon", "coordinates": [[[2.0, 2.0], [3.0, 2.0], [3.0, 3.0], [2.0, 2.0]]]}, tile)
    assert not touches({"type": "MultiPolygon", "coordinates": []}, tile)


def test_the_index_gains_this_area_and_keeps_the_others(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import config

    monkeypatch.setattr(export, "GOLD", tmp_path)
    monkeypatch.setattr(config, "AREA", "tampa")
    old = {"areas": [{"id": "pinellas", "name": "Pinellas", "tiles": []}, {"id": "tampa", "name": "Old", "tiles": []}]}
    (tmp_path / "regions.json").write_text(json.dumps(old))
    cuts = split((40, 60), TAMPA_BOX, target_cells=40)
    ground = np.zeros((40, 60))
    export.write_index([(cut, Grid(ground[cut.rows, cut.cols], cut.bbox, 3.0, 3.0)) for cut in cuts])
    areas = json.loads((tmp_path / "regions.json").read_text())["areas"]
    assert [a["id"] for a in areas] == ["pinellas", "tampa"]
    assert [t["path"] for t in areas[1]["tiles"]] == ["tampa/r0c0", "tampa/r0c1"]
    assert areas[1]["tiles"][0]["bbox"][2] == areas[1]["tiles"][1]["bbox"][0]
