"""Every pipeline setting lives here: areas and their boxes, storm sizes, vehicle limits, file paths.

No other pipeline file hard-codes a setting; they import it from this module.
"""

import math
import os
from dataclasses import dataclass
from pathlib import Path

Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class Area:
    """One metro, modelled in a single run and then cut into tiles (docs/regions.md)."""

    name: str
    box: Box  # WGS84 (xmin, ymin, xmax, ymax)
    elevation_size: tuple[int, int] | None = None  # pixels asked of USGS; None: about CELL_M cells, from the box
    in_repo: bool = False  # True: one tile written straight into web/public/data, kept in git


AREAS: dict[str, Area] = {
    # 4 x 4 miles around USF. Source: prep/02-flood-and-elevation-data.md, "Study area"; pixel size from B2.
    "usf": Area("USF and the University Area", (-82.4467, 28.0297, -82.3811, 28.0877), (2146, 2125), in_repo=True),
    # City of Tampa, about 12 x 12 miles. Holds the USF box.
    "tampa": Area("Tampa", (-82.56, 27.92, -82.36, 28.10)),
}
# Which area this run is for. Every folder and the study box below follow from it.
AREA = os.environ.get("FLUDD_AREA", "usf")
STUDY_BOX_WGS84: Box = AREAS[AREA].box

CELL_M = 3.0  # ground cell asked for when an area gives no pixel size (native 3DEP lidar is about 3 m)


def elevation_size(area: Area) -> tuple[int, int]:
    """Width and height in pixels of the elevation image for an area."""
    if area.elevation_size:
        return area.elevation_size
    west, south, east, north = area.box
    width_m = (east - west) * 111_320 * math.cos(math.radians((south + north) / 2))
    return round(width_m / CELL_M), round((north - south) * 110_574 / CELL_M)


# Working projection: UTM zone 17N, so grid cells are in metres.
WORK_CRS = "EPSG:26917"

# ponytail: one set of storm numbers (taken at USF) for every area. NOAA Atlas 14 differs by a few
# percent across Tampa; give each area its own tables before running one outside Hillsborough.
# 24-hour rainfall totals at USF in inches, NOAA Atlas 14.
# Source: prep/PLAN.md section 6. Confirm the duration mapping on NOAA's page before quoting.
STORM_TOTALS_IN: dict[str, float] = {
    "10yr": 6.6,
    "25yr": 8.4,
    "100yr": 11.9,
    "500yr": 17.2,
}

# Scenario names and time steps, as agreed in docs/contracts.md (2026-11-21).
SCENARIOS: tuple[str, ...] = ("10yr", "25yr", "100yr", "500yr", "milton")
PUMP_STATES: tuple[str, ...] = ("on", "off")
# 48 hourly steps for every scenario (the contract has one `hours` for all). Design storms:
# 24 h of rain then 24 h draining, clock from DESIGN_HOUR_ZERO. Milton: from 2024-10-09 12:00
# EDT, covering the Duck Pond outage (about 03:00 Oct 10 to 10:00 Oct 11).
HOURS: dict[str, int] = {"10yr": 48, "25yr": 48, "100yr": 48, "500yr": 48, "milton": 48}
DESIGN_HOUR_ZERO = "2026-11-21T08:00:00-05:00"
MILTON_HOUR_ZERO = "2024-10-09T12:00:00-04:00"

# Rainfall depth (inches) by duration (hours) at USF, NOAA Atlas 14, from
# prep/04-depth-model-and-routing.md section 5. Used to shape the hourly design storms.
DEPTH_DURATION_IN: dict[str, dict[int, float]] = {
    "10yr": {1: 2.94, 2: 3.66, 3: 4.06, 6: 4.74, 12: 5.49, 24: 6.60},
    "25yr": {1: 3.38, 2: 4.24, 3: 4.77, 6: 5.73, 12: 6.84, 24: 8.40},
    "100yr": {1: 4.03, 2: 5.12, 3: 5.90, 6: 7.48, 12: 9.44, 24: 11.9},
    "500yr": {1: 4.75, 2: 6.13, 3: 7.30, 6: 9.89, 12: 13.3, 24: 17.2},
}
RAIN_HOURS = 24  # design storms rain for 24 h, then drain until HOURS ends

# Low and high variants for the grade range: NOAA Atlas 14 90% confidence interval of the
# 24-hour depth (research 04 section 5.1). The whole storm is scaled by bound / central.
RAIN_INTERVAL_24H_IN: dict[str, tuple[float, float]] = {
    "10yr": (5.69, 7.72),
    "25yr": (7.13, 10.6),
    "100yr": (9.33, 15.5),
    "500yr": (12.2, 23.6),
}

# Milton replay. 10.7 in is the county-reported University Area total (research 01 3.2,
# 04 2.1); the North Tampa figure was 13.8 in. Worst rain 8 pm to midnight Oct 9.
MILTON_TOTAL_IN = 10.7
MILTON_PEAK_HOUR = 10  # hours after MILTON_HOUR_ZERO (22:00 Oct 9)
# Duck Pond outage, about 03:00 Oct 10 to 10:00 Oct 11, in hours after MILTON_HOUR_ZERO.
MILTON_PUMP_OFF_HOURS = (15, 46)

# Model assumptions (stated in the README; not calibrated to Milton).
CURVE_NUMBER = 85  # wet urban ground; research 04 section 1.2 suggests the wet end for hurricanes
BACKGROUND_DRAIN_IN_PER_HOUR = 0.25  # storm sewers, one global knob; true value unknown
# Duck Pond East pump station (county layer; position flagged "STATION NEED GPS").
DUCK_POND_PUMP_LNGLAT = (-82.43053936666412, 28.05883506339908)
DUCK_POND_PUMP_CFS = 70.0  # county quoted 50 to 90 cfs (unverified); midpoint
CFS_TO_M3_PER_HOUR = 0.028316846592 * 3600

# Grade geometry, as agreed in docs/contracts.md.
BUILDING_RING_CELLS = 3  # radius around the address point, ~9 m at 3 m cells
MILTON_NEARBY_M = 100.0  # a Milton flood point this close caps the grade at C

# Depth in metres at which a road closes for each vehicle class. Source: PLAN.md section 5.
VEHICLE_LIMITS_M: dict[str, float] = {
    "foot": 0.30,
    "car": 0.15,
    "suv": 0.30,
    "fire_engine": 0.25,
    "high_water": 0.75,
}

# "Wet" at a building for the grade. Source: PLAN.md section 6.
WET_THRESHOLD_M = 0.15

# Paths. Raw downloads (bronze) and intermediate files (silver) stay out of git.
PIPELINE_DIR = Path(__file__).resolve().parent
REPO_DIR = PIPELINE_DIR.parent
DATA_DIR = PIPELINE_DIR / "data" / AREA
BRONZE_DIR = DATA_DIR / "bronze"
SILVER_DIR = DATA_DIR / "silver"
QUARANTINE_DIR = DATA_DIR / "quarantine"
# The data root the app reads. Areas that are not kept in the repo are staged under pipeline/data/gold,
# laid out as they will sit in the data store: regions.json, then <area>/<tile>/.
GOLD_DIR = REPO_DIR / "web" / "public" / "data" if AREAS[AREA].in_repo else PIPELINE_DIR / "data" / "gold"
