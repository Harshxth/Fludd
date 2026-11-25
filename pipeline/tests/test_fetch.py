"""Tests for the shared download helpers (no network)."""

from pathlib import Path

import pytest

import config
from ingest import fetch


def test_chunks_cover_every_item_once() -> None:
    items = list(range(1203))
    batches = list(fetch.chunks(items, 500))
    assert [len(b) for b in batches] == [500, 500, 203]
    assert [i for b in batches for i in b] == items


def test_existing_file_is_not_fetched_again(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "BRONZE_DIR", tmp_path)
    (tmp_path / "layer.geojson").write_text("{}")

    def fail(*args: object, **kwargs: object) -> None:
        raise AssertionError("network was called")

    monkeypatch.setattr(fetch, "get_with_retry", fail)
    assert fetch.fetch_arcgis_layer("layer", "https://example.invalid/0") == tmp_path / "layer.geojson"


def test_record_writes_manifest_entry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "BRONZE_DIR", tmp_path)
    data = tmp_path / "x.geojson"
    data.write_text("abc")
    fetch.record("x", "https://example.invalid", data, count=3)
    import json

    entry = json.loads((tmp_path / "manifest.json").read_text())["x"]
    assert entry["count"] == 3
    assert entry["bytes"] == 3
    assert entry["file"] == "x.geojson"


def test_a_batch_the_server_fails_on_is_asked_again_in_halves(monkeypatch: pytest.MonkeyPatch) -> None:
    """FEMA's flood zone service returns an error when one answer holds too many large shapes."""
    asked: list[int] = []

    class Answer:
        def __init__(self, ids: list[str]) -> None:
            self.ids = ids

        def json(self) -> dict[str, object]:
            return {"features": [{"id": int(i)} for i in self.ids]}

    def fake(url: str, params: object = None, data: dict[str, str] | None = None, **kwargs: object) -> Answer:
        assert data is not None
        ids = data["where"].split("(")[1].rstrip(")").split(",")
        asked.append(len(ids))
        if len(ids) > 2:
            raise RuntimeError("Failed after 5 attempts")
        return Answer(ids)

    monkeypatch.setattr(fetch, "get_with_retry", fake)
    features = fetch.features_of("https://example.invalid/0/query", "OBJECTID", list(range(8)), "*")
    assert [f["id"] for f in features] == list(range(8))
    assert asked == [8, 4, 2, 2, 4, 2, 2]


def test_a_single_feature_the_server_fails_on_stops_the_download(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("Failed after 5 attempts")

    monkeypatch.setattr(fetch, "get_with_retry", fail)
    with pytest.raises(RuntimeError, match="Failed after"):
        fetch.features_of("https://example.invalid/0/query", "OBJECTID", [7], "*")
