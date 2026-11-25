"""Cut an area run into tiles (docs/regions.md).

Bowls are found and filled over the whole area. A tile is a rectangle of that grid, about
the size of the USF box, with its own bowl numbering: bowls.png holds an id in 16 bits, and
an area has more bowls than that. The browser only ever asks "which bowl is this cell in,
and how high is that bowl's water", so a tile needs just the bowls that own a cell in it.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np
from numpy.typing import NDArray

TILE_CELLS = 2100  # about the USF box at 3 m
MAX_BOWLS = 65_535  # the largest id bowls.png can hold

Box = tuple[float, float, float, float]  # west, south, east, north


@dataclass(frozen=True)
class Cut:
    name: str  # "r0c0": row counted from the north, column from the west
    rows: slice
    cols: slice
    bbox: Box


def _edges(cells: int, target: int) -> list[int]:
    return [int(e) for e in np.linspace(0, cells, max(1, round(cells / target)) + 1).round()]


def _between(a: float, b: float, i: int, n: int) -> float:
    # exact at both ends, so the outer tiles keep the area's own box
    return a if i == 0 else b if i == n else a + (b - a) * i / n


def split(shape: tuple[int, int], bbox: Box, target_cells: int = TILE_CELLS) -> list[Cut]:
    """Rectangles of about target_cells a side that cover the grid once (north row first)."""
    height, width = shape
    west, south, east, north = bbox
    cuts = []
    for r, (r0, r1) in enumerate(pairwise(_edges(height, target_cells))):
        for c, (c0, c1) in enumerate(pairwise(_edges(width, target_cells))):
            box = (_between(west, east, c0, width), _between(north, south, r1, height),
                   _between(west, east, c1, width), _between(north, south, r0, height))
            cuts.append(Cut(f"r{r}c{c}", slice(r0, r1), slice(c0, c1), box))
    return cuts


def local_bowls(node: NDArray[np.integer[Any]]) -> tuple[NDArray[np.uint16], NDArray[np.int64]]:
    """A tile's bowl ids from the area's bowl per cell (-1 = drains away).

    Returns the id per cell for bowls.png (0 = drains away, else 1..k) and, for id i, the
    area bowl behind it at [i - 1]. Order is kept, so a tile holding every bowl is unchanged.
    """
    nodes = np.unique(node[node >= 0])
    if nodes.size > MAX_BOWLS:
        raise RuntimeError(f"{nodes.size} bowls in one tile, and bowls.png holds {MAX_BOWLS}: cut smaller tiles")
    ids = np.where(node >= 0, np.searchsorted(nodes, node) + 1, 0)
    return ids.astype(np.uint16), nodes.astype(np.int64)


def touches(geometry: dict[str, Any], bbox: Box) -> bool:
    """True when a GeoJSON geometry's own box meets the tile's box (a map layer feature to keep)."""

    def points(coords: Any) -> Any:
        if coords and isinstance(coords[0], (int, float)):
            yield coords
        else:
            for part in coords:
                yield from points(part)

    pts = list(points(geometry["coordinates"]))
    if not pts:
        return False
    west, south, east, north = bbox
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs) <= east and max(xs) >= west and min(ys) <= north and max(ys) >= south
