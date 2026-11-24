# Fludd contracts

The boundary between the interface (Harshith) and the logic (Hansika). Changes need both of us, said out loud, then written here by Harshith.

| | |
|---|---|
| Live URL | to be set (Vercel deploy pending) |
| Toy fixture | `web/public/data/toy/`, written by `node web/scripts/make-toy-fixture.mjs`, checked by `web/tests/contract/toy-fixture.test.ts` |
| Real data | `web/public/data/` (pipeline gold output) |
| Data-folder switch | `NEXT_PUBLIC_DATA_SET` = `toy` (default) or `real`. Read only in `web/lib/config.ts` |
| Types | `web/lib/types.ts` is the code form of this page |
| Product focus | Storm-day flood report card, as PLAN.md. Real-estate items (better options nearby, remedies) are extras, built after the core gates |

## Decisions from the 11:00 talk

Agreed with Hansika 12:05, updated 12:20.

1. Function names and shapes: the table "Exact names" below. Agreed
2. Scenario names: `10yr`, `25yr`, `100yr`, `500yr`, `milton`. Pump `on` / `off`. Level files `levels/<scenario>-pump-<on|off>.json`. Low and high variants for the grade range: `<scenario>-low` and `<scenario>-high`, grade-only, not in the manifest list
3. Hours: integer steps from hour zero; `manifest.hours` = **48 for every scenario**. Design storms: 24 h rain + 24 h draining from `manifest.hourZero` (today 08:00 local). Milton's own start is `manifest.hourZeroByScenario.milton` = `2024-10-09T12:00:00-04:00`; use `hourZeroByScenario[scenario]` for clock labels. Toy fixture: 25 hours from 08:00
4. Depth at a building: 90th percentile over cells within 3 cells (about 9 m at 3 m cells). Milton "nearby" cap: 100 m
5. Grade answer: `Grade` in `types.ts`. Before low/high variants exist, `range` equals `[letter, letter]` and `lowConfidence` is false
6. Error shape: `{ "error": { "code": string, "message": string } }` with a 4xx/5xx status (`web/lib/api.ts`). Shortcut upload to `POST /api/reports`: multipart fields `photo`, `lat`, `lng`, `source` (`gps` | `pin`), `takenAt`
7. Data-folder switch: `NEXT_PUBLIC_DATA_SET`, above
8. Stub replaced: Hansika adds a line under "Notes for my teammate" in `prep/HACKER-HANSIKA.md` and says it out loud. Stubs are marked `STUB` at the top of each file

## Field notes (12:20)

- **FEMA zones:** real `fema-zones` features carry FEMA's fields `FLD_ZONE`, `ZONE_SUBTY`, `SFHA_TF`, `STATIC_BFE`. The toy fixture uses `zone`. The grade reads both
- **Routing special values:** `lastHour`, `untilHour`, `moveByHour` = the last whole hour still open. `-1` = already too late at hour 0. `moveByHour: -1, parking: null` = no dry parking reachable. `moveByHour: null, parking: null` = no move needed. Parking is named "High ground at junction N" (there is no parking layer)
- **Gemini:** guidance answers `{ text }`, remedies `{ sentences }`. Request bodies are in `web/lib/gemini/schemas.ts`; remedies takes `letter`, `depthByStorm`, `femaZone`, `miltonPointNearby`, `pumpDependent`, `depthAtBuilding100yrM`. Response header `x-fludd-text-source` = `gemini` / `fallback` / `off`
- **Pump stations:** Duck Pond East has `approximate: true` (the county record says it needs GPS)
- **Extra loader:** `depthAtBuilding` in `lib/data`, alongside `depthAt`

## Contract change (14:45)

New map layers `storm-pipes` (LineStrings; `kind` pipe | culvert | channel, `diameterIn`, `heightIn`, `material`, `shape`, `owner`) and `outfalls` (points). Agreed by Harshith as lead while Hansika was out of usage; added to `LAYER_NAMES` and the toy fixture. 4,604 lines and 943 outfalls on real data.

## Contract change (2026-11-23, after the event)

Region index, approved by Harshith; design in `docs/regions.md`. New file `regions.json` at the data root (and in the toy fixture): areas, their tiles, each tile's `bbox` and `path`. Code in `web/lib/regions`. `AddressMatch.inside` now means "inside some tile of the index" instead of "inside the one manifest box"; with one tile the answer is the same. No other name or shape changed.

## Stub status (14:20)

Everything in "Exact names" is real. Routing runs on the real OSM road graph (6,481 junctions, 9,064 segments). `findBetterOptions` works on real data only and throws on the toy set. `/api/weather` proxies NWS active alerts; `/api/health` returns the manifest version (both finished by Harshith's session at 14:15 while Hansika was out of usage).

**Validation (`validation.json`):** the model catches 286 of 547 Milton damage points (52.3%), including 136 of the 207 that sit outside FEMA high-risk zones. FEMA's zones hold 62% but cover 9.07 km² against the model's 3.54 km².

---

## From PLAN.md section 5 (verbatim)

Written as descriptions, not code. Copy this section into `docs/contracts.md` at 11:05. The lead also creates a **toy fixture** at 11:10: a tiny synthetic area with two bowls, one spill point, one pump and a dozen road segments, in exactly these formats, so every lane can build and test before real data lands. In the same step Harshith's session writes stub versions of every function in "What the interface can call" below, and placeholder routes, so the interface can be built before Hansika's real ones land.

### Gold files in `web/public/data/`

| File | Contents | Produced by | Used by |
|---|---|---|---|
| `manifest.json` | Version, study box corners, grid width, height and cell size, list of scenarios, units, data sources with dates | Pipeline | Everything |
| `ground.png` | Ground height per cell, packed into image channels so the browser can read it as a texture. Height range recorded in the manifest | Pipeline | Water layer, grade |
| `bowls.png` | Bowl id per cell, same grid. Zero means "drains away" | Model | Water layer, grade |
| `bowls.json` | Per bowl: id, lowest point, spill height, where it spills to, parent bowl, pump present, storage at spill | Model | Grade, method page |
| `levels/<scenario>.json` | Per hour, per bowl: water surface height. One file each for the 10, 25, 100 and 500-year storms and the Milton replay, each with pump on and pump off | Model | Water layer, routing, grade |
| `graph.bin` + `graph.json` | Road graph as flat arrays: node positions, segment ends, length, speed class; index layout described in the json | Graph | Routing |
| `segments.json` | Per road segment: the bowls it crosses and its lowest ground height inside each | Graph | Routing (closure times) |
| `layers/*.geojson` | FEMA zones, pump stations, drains, ponds, fire stations, hospitals, Milton damage points, known-flooding parcels | Pipeline | Map |
| `validation.json` | Hit rate on Milton points, false-alarm area, the FEMA baseline, counts, the date computed | Model | Validation panel, README |

### Derived values (same definition everywhere)

| Value | Definition |
|---|---|
| Depth at a cell | Water level of the cell's bowl minus ground height, never below zero |
| Depth at a building | 90th percentile of depth in the ring of cells around the address point |
| A road segment closes for a vehicle class | First hour when depth at its lowest point reaches that class's limit |
| Vehicle limits | On foot 0.30 m, car 0.15 m, SUV or pickup 0.30 m, fire engine 0.25 m, high-water vehicle 0.75 m. Sources in `04`, section 3 |

### Server routes

| Route | Takes | Returns |
|---|---|---|
| `POST /api/reports` | Photo, position (phone GPS or dropped pin), time | Report id, Gemini reading, status "waiting" |
| `GET /api/reports?status=approved` | Nothing | Approved reports with street-level position, depth, age, source |
| `POST /api/reports/:id/moderate` | Decision (approve, edit depth, reject); admin only | Updated report |
| `POST /api/gemini/guidance` | The numbers for one address and hour | Two or three sentences of plain guidance |
| `GET /api/weather` | A point | Active NWS alerts for it |
| `GET /api/health` | Nothing | Status and the data manifest version |

Every route returns the same error shape and never crashes the page.

### What the interface can call

This is the whole boundary between Harshith's components and Hansika's logic. Functions are exported from `web/lib/`; routes are the table above. Described in words; exact names are fixed in `docs/contracts.md` during the first 15 minutes and do not change when a stub becomes real.

| What | Takes | Gives back |
|---|---|---|
| Load the gold files | Nothing. A data-folder setting chooses the toy fixture or real data | Manifest, scenario list, ground and bowl grids ready for the water layer, the bowl table; a clear error if a file breaks the contract |
| Load a scenario's levels | Scenario, pump on or off | Water surface height per bowl per hour |
| Load a map layer | Layer name | Its features, validated |
| Depth at a point | Position, scenario, pump state, hour | Depth in metres, never below zero; "outside validated area" off the grid |
| Find an address | Typed text; then a chosen suggestion | Suggestions; then the position and whether it is inside the validated area |
| Grade for an address | Position | Letter, range, low-confidence flag, reasons (base rule, notches, caps), depth band per storm size, the "official map says" and "we found" facts, the action paired with a low grade; or "outside validated area" |
| Closing hours | Scenario, pump state | For each road segment, the hour it closes for each vehicle class |
| Best route now | From, to, vehicle class, scenario, pump state, start hour | Route line and travel time, or "no route" |
| Cut-off time | Position, vehicle class, scenario, pump state | The latest hour any route to dry ground still exists |
| Rescue reach | Position, vehicle class, scenario, pump state | Until what hour a fire station can still reach the position; and the roads reachable at a given hour |
| Latest safe departure | Position, scenario, pump state | The "move your car by" hour and the dry parking place it leads to |
| Approved reports feed | Nothing | Current approved reports and a notice when one is added or changed. Routing applies them itself |
| Admin sign-in and queue | Sign-in details; then nothing | Whether the user is an admin; waiting reports with photo link, exact position, AI reading and model depth |
| Calibration figures | Nothing (admin only) | Pairs of model depth and confirmed depth, and the running error |
| Validation figures | Nothing | The contents of `validation.json` |
| Server routes | See the table above | Fetched by the interface, never imported |

### Reports table

| Field | Meaning |
|---|---|
| id, created time | |
| position (exact) | Stored, visible to admins only |
| position (public) | Snapped to the nearest road segment midpoint; this is what the map shows |
| position source | Phone GPS or dropped pin |
| photo path | Private storage; embedded metadata stripped on upload |
| AI reading | Water present, depth range, reference object used, confidence |
| model depth at that place and hour | Recorded at submission for calibration |
| status | Waiting, approved, rejected |
| final depth | The admin's confirmed figure |
| moderation log | Who decided what, when (append-only) |

---

