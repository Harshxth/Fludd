# Regions: how Fludd grows past the USF box

Status: design approved 2026-11-23. Step 1 is built and step 2 is built except the road files; the rest is planned. This page is also the guide for adding a city.

## Why

Fludd started as one 4 x 4 mile box around USF, about 67 MB of data in the repo. The goal is all of Tampa, then Clearwater and St Petersburg, then more of Florida, at the same 3 m detail, on hosting that costs nothing.

## Words

| Word | Meaning |
|---|---|
| Area | One metro, modelled in a single run so water spills correctly across it. `tampa` is the first |
| Tile | One piece of an area, about the size of the USF box (roughly 2,100 x 2,100 cells at 3 m). The browser loads one tile at a time |
| Index | `regions.json` at the data root: every area, its tiles, each tile's box and folder |

## The index (built)

`web/public/data/regions.json`, and a copy for the toy fixture:

```json
{ "areas": [ { "id": "tampa", "name": "Tampa", "tiles": [
  { "id": "usf", "name": "USF and the University Area", "bbox": [-82.4467, 28.0297, -82.3811, 28.0877], "path": "" }
] } ] }
```

- `bbox` is `[west, south, east, north]` in degrees and must equal the `bbox` in that tile's `manifest.json` (a test checks this).
- `path` is the tile's folder under the data root. `""` is the root itself, which is where the USF tile lives so no file had to move.
- Tiles do not overlap. A point on a shared edge belongs to the first tile listed.

Code: `web/lib/regions/index.ts` (`parseRegions`, `findTile`, `coveredPlaces`, `loadRegions`). An address is "inside" when some tile holds it. Outside every tile the interface says the place is not covered yet and lists what is.

## Each tile folder (built in the pipeline, same files as today)

`manifest.json`, `ground.png`, `bowls.png`, `bowls.json`, `levels/`, `layers/`, `parcels.json`, `validation.json`, in the formats in `docs/contracts.md`. Two rules are new:

- **Bowl ids are local to the tile.** `bowls.png` stores an id in 16 bits (65,535 at most). The USF box alone has 8,612 bowls, so an area needs more ids than fit. The pipeline renumbers the bowls that own a cell in each tile, and that tile's `levels/` files carry only those bowls. In `bowls.json`, `spillsTo` and `parent` are null when the other bowl is outside the tile (the app reads neither).
- **A tile is cut from the area run.** Bowls are found and filled over the whole area first, then cut. A tile is never modelled on its own, because a bowl on the edge would lose the water arriving from next door. A test checks that a tile's files give every cell the same water, hour by hour, as the area run (`pipeline/tests/test_tiles.py`).

Code: `pipeline/gold/tiles.py` cuts, `pipeline/gold/export.py` writes. Map layers are filtered to the features whose box meets the tile; homes are filed under the tile that holds them; `validation.json` is written once per area, in the area folder.

## Roads (planned)

A route can cross tiles, so the road graph is one per area (`graph.bin`, `graph.json` in the area folder). Today the browser works out when each road closes from the water levels of the bowls it crosses. With many tiles that would mean loading every tile's levels to plan one route, so the pipeline will write the closing hour of every road, per storm and vehicle, and the browser reads that instead.

Tradeoff: closing hours become fixed pipeline output, so a new vehicle limit means a pipeline run, not a code change.

## Where the data lives (planned)

Git and Vercel will not hold it: one tile is 67 MB, Tampa is about 9 tiles (roughly 600 MB), and all of Florida at 3 m is roughly 3,400 tiles and over 200 GB (rough estimates from the USF tile's size). The plan is object storage with free egress (Cloudflare R2; its free allowance is to be confirmed before we depend on it), with one env variable for the data root. The USF tile stays in the repo so a fresh clone runs with no setup.

Tradeoff: a second service to keep alive, in exchange for a repo people can clone.

## Storm surge (planned, required before any coastal tile ships)

The model fills low ground with rain. It knows nothing about the bay. Downtown Tampa, South Tampa, Clearwater and St Petersburg flood mainly from surge, so a rain-only grade there could read A on a street that goes under. Before a coastal tile ships, the grade is capped by NOAA's public surge maps, the same way a nearby Milton damage point caps it today. A capped grade says why, in plain words.

## Honest limits per area

- The 52.3% Milton check (286 of 547 damage points) covers the USF tile only. Each new area gets its own check against real damage records, or the site says plainly that the area has not been checked against a real storm.
- Pinellas County (Clearwater, St Petersburg) has its own parcel, address and drainage services. Nothing from Hillsborough's carries over.
- Pump stations are modelled by hand (Duck Pond). Other areas start with no pumps and say so.
- Storm sizes are NOAA's figures at USF, used for every area for now. They differ by a few percent across Tampa, and an area outside Hillsborough needs its own.

## Build order

1. **Index and lookup, USF as the only tile.** Built. Nothing changes for a visitor except the "not covered yet" wording.
2. **Pipeline by area and tile:** config takes an area box, the model runs over it, gold export cuts tiles and writes the index. Built. Still to do: the per-area road files with closing hours (`graph/build.py` works for the USF area only).
3. **Browser switches tiles:** loaders read from the tile that holds the address; the map draws that tile's water.
4. **Tampa:** run it, check it against Milton damage records across the city, add the surge cap, publish.
5. **Pinellas**, then further areas the same way.

## Adding a city

1. Add the area to `AREAS` in `pipeline/config.py` (a name and a box; the box must fit one USGS elevation request, 8000 x 8000 cells at 3 m, about 15 x 15 miles) and its data sources to `pipeline/ingest/`.
2. Run the pipeline with `FLUDD_AREA=<area>`. Downloads go to `pipeline/data/<area>/`. The tile folders go to `pipeline/data/gold/<area>/<tile>/` and the area is added to `pipeline/data/gold/regions.json`. None of this is in git. (The `usf` area is the exception: one tile, written to `web/public/data`.)
3. Run the area's check against real flood records and put the result in the area's `validation.json`.
4. Upload the tile folders to the data store and open a pull request with the index change and the sources.

Code is MIT. The data comes from public agencies and OpenStreetMap (ODbL) and keeps their terms; see the README.
