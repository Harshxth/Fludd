"""Sanity checks on the pipeline settings."""

import importlib

import pytest

import config


def test_study_box_is_ordered() -> None:
    xmin, ymin, xmax, ymax = config.STUDY_BOX_WGS84
    assert xmin < xmax
    assert ymin < ymax


def test_storms_grow_with_return_period() -> None:
    totals = [config.STORM_TOTALS_IN[k] for k in ("10yr", "25yr", "100yr", "500yr")]
    assert totals == sorted(totals)


def test_gold_dir_is_web_public_data() -> None:
    assert config.GOLD_DIR.parts[-3:] == ("web", "public", "data")


def test_the_default_area_is_the_usf_box_in_the_repo() -> None:
    assert config.AREA == "usf"
    assert config.STUDY_BOX_WGS84 == (-82.4467, 28.0297, -82.3811, 28.0877)
    assert config.elevation_size(config.AREAS["usf"]) == (2146, 2125)


def test_elevation_size_gives_about_three_metre_cells_in_one_request() -> None:
    width, height = config.elevation_size(config.AREAS["tampa"])
    west, south, east, north = config.AREAS["tampa"].box
    assert 2.9 < (north - south) * 110_574 / height < 3.1
    assert 2.9 < (east - west) * 111_320 * 0.883 / width < 3.1
    assert max(width, height) <= 8000  # the most the USGS service returns in one image


def test_other_areas_keep_their_files_apart_and_out_of_the_web_folder(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLUDD_AREA", "tampa")
    try:
        importlib.reload(config)
        assert config.STUDY_BOX_WGS84 == config.AREAS["tampa"].box
        assert config.BRONZE_DIR.parts[-2:] == ("tampa", "bronze")
        assert "web" not in config.GOLD_DIR.parts
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_an_unknown_area_is_refused_by_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLUDD_AREA", "atlantis")
    try:
        with pytest.raises(KeyError, match="atlantis"):
            importlib.reload(config)
    finally:
        monkeypatch.undo()
        importlib.reload(config)
