"""Download helpers shared by every ingest file.

- `get_with_retry`: HTTP GET/POST with exponential backoff (public GIS hosts drop connections).
- `fetch_arcgis_layer`: all features of one ArcGIS layer inside the study box, as GeoJSON.
  Asks for the object ids first, then fetches them in chunks, so it works on services
  that do not support paging. A chunk the server fails on is split in half and asked again.
- `record`: appends one entry to the bronze manifest (source, URL, filter, count, time).

Files already downloaded are never fetched again; delete the file to re-fetch.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import config

USER_AGENT = "fludd-pipeline (HackJam 2026 student project)"
CHUNK = 500


def chunks(items: Sequence[int], size: int) -> Iterator[Sequence[int]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def get_with_retry(
    url: str,
    params: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    attempts: int = 5,
    timeout: float = 120,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            if data is None:
                response = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT})
            else:
                response = requests.post(url, data=data, timeout=timeout, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            last_error = error
            wait = 2**attempt
            print(f"   retry {attempt + 1}/{attempts} in {wait}s: {error}")
            time.sleep(wait)
    raise RuntimeError(f"Failed after {attempts} attempts: {url}") from last_error


def _box_params() -> dict[str, str]:
    xmin, ymin, xmax, ymax = config.STUDY_BOX_WGS84
    return {
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
    }


def _arcgis_json(response: requests.Response) -> dict[str, Any]:
    body: dict[str, Any] = response.json()
    if "error" in body:
        raise RuntimeError(f"ArcGIS error: {body['error']}")
    return body


def features_of(query_url: str, id_field: str, batch: Sequence[int], out_fields: str) -> list[dict[str, Any]]:
    """The features with these ids. A batch the server fails on is asked again in halves: FEMA's
    flood zone service returns an error when one answer holds too many large shapes."""
    try:
        body = _arcgis_json(
            get_with_retry(
                query_url,
                # `where id IN (...)` rather than `objectIds=`: the county parcel service rejects the latter.
                data={
                    "where": f"{id_field} IN ({','.join(str(i) for i in batch)})",
                    "outFields": out_fields,
                    "outSR": "4326",
                    "f": "geojson",
                },
            )
        )
    except RuntimeError:
        if len(batch) == 1:
            raise
        half = len(batch) // 2
        print(f"   {len(batch)} features failed together, asking for each half")
        return features_of(query_url, id_field, batch[:half], out_fields) + features_of(query_url, id_field, batch[half:], out_fields)
    features: list[dict[str, Any]] = body.get("features", [])
    return features


def fetch_arcgis_layer(
    name: str,
    layer_url: str,
    where: str = "1=1",
    out_fields: str = "*",
) -> Path:
    """Download every feature of `layer_url` inside the study box to bronze/<name>.geojson."""
    path = config.BRONZE_DIR / f"{name}.geojson"
    if path.exists():
        print(f"== {name}: already downloaded, skipping")
        return path

    print(f"== {name}: {layer_url}")
    query_url = f"{layer_url}/query"
    ids_body = _arcgis_json(
        get_with_retry(query_url, params={"where": where, "returnIdsOnly": "true", "f": "json", **_box_params()})
    )
    id_field: str = ids_body.get("objectIdFieldName", "OBJECTID")
    ids: list[int] = sorted(ids_body.get("objectIds") or [])

    features: list[dict[str, Any]] = []
    for batch in chunks(ids, CHUNK):
        features.extend(features_of(query_url, id_field, batch, out_fields))

    if len(features) != len(ids):
        raise RuntimeError(f"{name}: asked for {len(ids)} features, got {len(features)}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    record(name, layer_url, path, count=len(features), extra={"where": where, "id_field": id_field, "out_fields": out_fields})
    print(f"   {len(features)} features -> {path.name}")
    return path


def record(name: str, url: str, path: Path, count: int | None = None, extra: dict[str, Any] | None = None) -> None:
    """Append (or replace) the manifest entry for `name` in bronze/manifest.json."""
    manifest_path = config.BRONZE_DIR / "manifest.json"
    entries: dict[str, Any] = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    entries[name] = {
        "url": url,
        "file": path.name,
        "count": count,
        "bytes": path.stat().st_size,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **(extra or {}),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(entries, indent=2))
