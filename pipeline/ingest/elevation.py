"""Ground elevation for the study box from the USGS 3DEP image service.

About 3 m lidar flown 2011 (1/9 arc-second, northern Hillsborough). Requested in
UTM 17N (EPSG:26917) so pixels are metres. Source: prep/02-flood-and-elevation-data.md B2.
"""

from __future__ import annotations

import numpy as np
import rasterio

import config
from ingest.fetch import get_with_retry, record

URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
MAX_PIXELS = 8000  # the service's maxImageWidth and maxImageHeight
NODATA = -9999.0


def download() -> None:
    path = config.BRONZE_DIR / "elevation_3dep.tif"
    if path.exists():
        print("== elevation: already downloaded, skipping")
    else:
        xmin, ymin, xmax, ymax = config.STUDY_BOX_WGS84
        width, height = config.elevation_size(config.AREAS[config.AREA])
        if max(width, height) > MAX_PIXELS:
            raise RuntimeError(f"elevation: {width} x {height} px is more than one request returns ({MAX_PIXELS}); make the area smaller")
        params = {
            "bbox": f"{xmin},{ymin},{xmax},{ymax}",
            "bboxSR": "4326",
            "imageSR": "26917",
            "size": f"{width},{height}",
            "format": "tiff",
            "pixelType": "F32",
            "noData": str(NODATA),
            "interpolation": "RSP_BilinearInterpolation",
            "f": "image",
        }
        print(f"== elevation: {URL}")
        response = get_with_retry(URL, params=params, timeout=300)
        if not response.content.startswith((b"II*\x00", b"MM\x00*")):
            raise RuntimeError(f"elevation: not a TIFF: {response.content[:200]!r}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(response.content)
        record(
            "elevation_3dep",
            URL,
            path,
            extra={
                "params": params,
                "source": "USGS 3DEP dynamic elevation, 1/9 arc-second lidar flown 2011",
                "licence": "US public domain",
            },
        )
    check(path)


def check(path: object) -> None:
    """Fail loudly if the raster is empty or has gaps."""
    with rasterio.open(path) as src:
        band = src.read(1)
        gaps = int(np.count_nonzero(band == NODATA) + np.count_nonzero(~np.isfinite(band)))
        print(f"   {src.width} x {src.height} px, crs {src.crs}, pixel {src.res[0]:.2f} x {src.res[1]:.2f} m")
        valid = band[band != NODATA]
        print(f"   height {valid.min():.2f} to {valid.max():.2f} m, gaps {gaps}")
        if gaps:
            raise RuntimeError(f"elevation: {gaps} empty cells")


if __name__ == "__main__":
    download()
