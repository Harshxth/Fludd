# Fludd

**What the flood map doesn't tell you about your address.**

Type any address near USF and get a flood report card: a letter grade, where the water goes hour by hour, when to move your car, whether a fire truck can still reach you, and what to fix. Built at HackJam '26 (SHPE USF, an MLH event) on November 21, 2026 by Harshith and Hansika.

**Live:** [fludd.app](https://fludd.app) · **Guided demos:** [fludd.app/demo](https://fludd.app/demo)

![A flood grade for one address: grade F on the map, with the model's water around it](docs/img/grade.jpg)

| | | |
|---|---|---|
| ![Storm mode: water at the door hour by hour, pump stations on or off](docs/img/storm.jpg) **Storm mode.** Play the water hour by hour; switch the pump stations off. | ![Ask Pelican finds a pharmacy on roads the model keeps open](docs/img/pelican.jpg) **Ask Pelican.** A route that only uses roads the model keeps open. | ![Two homes on the same street, both Zone X: grade A and grade F](docs/img/two-homes.jpg) **Same street, same zone.** One home grades A, the other F. |
| ![Simulated neighbour reports arriving on the real map](docs/img/reports.jpg) **Neighbours report.** Each reading set against the model (demo, simulated reports). | ![A camera at a kerb reading the water depth](docs/img/camera.jpg) **Camera as a gauge.** A camera you own reads the water at your kerb (demo, simulated camera). | ![The validation panel: 52.3% of Milton's damage points](docs/img/validation.jpg) **Checked against Milton.** 286 of 547 damage points. |

**Fludd is four things in one map:**

| | For | What it does |
|---|---|---|
| **Before you move** | Renters and buyers | A flood grade for any building (search it or tap it on the map): what the official map says against what we found, Milton damage nearby, drainage, fixes |
| **Weather** | Everyone, every day | Weather now, when it will rain in the next 12 hours, air quality, National Weather Service alerts; also as a one-tap iPhone Shortcut widget |
| **During a flood** | Residents and drivers | Floodwater hour by hour (press Play), a live meter for water at your home, when to move your car, and Ask Pelican routes that avoid flooded roads |
| **Help each other** | Neighbours | Photo reports checked by a person, food banks and shelters nearby, 911 and 211, and a weekly note on how many neighbours your reports reached |

## What makes it different

1. **A depth model built around bowls, spill points and pumps.** It fills low ground the way the University Area flooded in Hurricane Milton, bowl by bowl, spilling into the next one. A pump station is a real object you can switch off.
2. **Routing that understands depth and time.** Every road segment closes at its own hour for a car, a truck and a fire engine, so the app can say "move your car before about 6 pm" and "fire trucks can reach you until about 9 pm".
3. **It checks itself against Milton.** Hillsborough County recorded 547 flood-damage points inside our study box. The model, never tuned to those points, puts water at **286 of them (52.3%)**, including **136 of the 207 that sat outside FEMA's high-risk zones**. FEMA's zones held 62% of the points but cover 9.07 km², against the model's 3.54 km² of predicted water. The app shows these numbers next to every grade.

## How it works

- **Depth model** (`pipeline/model/`, Python): 3 m lidar elevation, runoff per storm (NOAA Atlas 14 at USF: 10, 25, 100 and 500-year 24-hour storms, plus a Milton replay), a sweep that finds 8,612 bowls and their spill points, then water moved between bowls hour by hour with pumps on or off. It writes compact files the browser draws directly.
- **Grade** (`web/lib/grade/`): the letter comes from the smallest storm that puts 6 in or more of water at the building. Notches and caps (pump dependence, deep water at the floor, Milton damage within 100 m) can only lower it. A range and "low confidence" come from rainfall at the edges of the NOAA confidence interval.
- **Routing** (`web/lib/routing/`, TypeScript in a web worker): the real OpenStreetMap road graph (6,481 junctions, 9,064 segments). Closing hours per vehicle class, time-aware best route, cut-off time (widest-path search), rescue reach (multi-source search from fire stations) and latest safe departure.
- **Interface** (`web/app/`, `web/components/`): one map, one surface. Before, during and after a flood:
  - **Before:** grade, flood history nearby, drainage network, steps that fit your home (own or rent, floor) and similar homes nearby with a better grade. For an address you do not live at yet, a checklist for buying, renting or building there, made from the same report.
  - **During:** water at the door hour by hour, move-your-car time, fire truck reach, last way out, live National Weather Service alerts, and "Ask Pelican" for a trip that avoids roads the model closes.
  - **After:** what Milton did at the address, what the pumps changed, and resident photo reports checked by a person before they appear.
- **Guided demos** (`/demo`): four short walks on the real map and model. Neighbours' reports landing on the map and set against the model (the reports are simulated and labelled so on screen); two real addresses compared for someone moving or building; a camera at a parking spot used as a water gauge (the camera readings are simulated and labelled). The fourth walks through food sharing after a flood (restaurants offering meals, neighbours asking without a name): the offers are simulated and the portals it shows are designed in `docs/food-share.md`, not built. Model values in the demos are read from the model at run time.
- **Tour video:** the welcome screen has a "Watch the 30-second tour" button. The video is a screen recording of the live app made during the event, driven by a Playwright script and captioned with Remotion (both written by Claude Code). It follows a renter from a lease decision to a storm night.
- **Cameras you already own:** besides a spare phone, a CCTV or IP camera can be the gauge. A short script on the home network takes one still and posts it to the same report route (`docs/camera-bridge.md`). Cloud-only doorbells (Ring, Nest) are not supported.
- **Privacy:** your home, car spot, insurance details and camera link stay in your browser (localStorage). They are never sent to our server. Reports carry no identity and photos are stripped of metadata; see `docs/privacy.md`.

## Data sources

Map and model data were fetched on 2026-11-21, with no keys required. Weather, alerts, search and food distributions are asked for live. Full list with filters and counts in `web/public/data/manifest.json`.

| Data | Source |
|---|---|
| Elevation, 3 m lidar (2011) | USGS 3DEP |
| Flood zones | FEMA National Flood Hazard Layer |
| Milton flood-damage points | Hillsborough County damage assessments 2024 |
| Known-flooding parcels, inlets, detention areas, open drains, pump stations | City of Tampa stormwater open data |
| Pump stations, catch basins, channels, ponds, storm pipes | Hillsborough County stormwater GIS |
| Street-flooding reports | City of Tampa flooding spots |
| Parcels (value, beds, baths; no owner fields) | Hillsborough County parcels |
| Fire stations, hospitals | Hillsborough County |
| Roads; places for Ask Pelican | OpenStreetMap via Overpass |
| Community names for search (52 apartment communities, halls and neighbourhoods) | OpenStreetMap via Overpass |
| Named places in search, the address of a tapped building, and places for Ask Pelican when Overpass is busy | Esri ArcGIS World Geocoder (keyless) |
| Address search | Hillsborough County address locator |
| Weather alerts | National Weather Service API |
| Weather now, rain in the next 12 hours, air quality | Open-Meteo forecast and air-quality APIs (keyless) |
| Food distributions | Web pages found by Gemini with Google Search grounding, shown with their sources; nothing is shown when the search is unavailable |
| Basemap | OpenFreeMap "liberty" (OpenStreetMap data) |

## Frameworks and libraries

- **Web:** Next.js 16.4, React 19.3, TypeScript (strict), Tailwind CSS 4.3, MapLibre GL JS 6.17, Motion 14, Zod 4, Supabase JS 2 and `@supabase/ssr`, Google Gen AI SDK (`@google/genai`) 3.6.
- **Pipeline:** Python 3.11 with uv, NumPy, SciPy, Numba, Rasterio, Pillow, Requests.
- **Tests:** Vitest, pytest, Playwright.
- **Backend:** Supabase (Postgres, storage, auth, realtime). Hosting on Vercel.
- **Boot animation:** drawn live in the browser as SVG from React; no video.

## How AI was used

We used AI throughout and say so plainly, because the rules require it and because it is true.

**Tools.** Claude Code (Anthropic) for planning, research and code generation, including several Claude Code agents working in parallel on separate folders. ChatGPT Codex (OpenAI), used by Hansika for code generation on her side of the project. Google Gemini inside the product.

**What we decided ourselves.**
- **Both of us:** the idea, the product framing, what to cut, and the before, during and after structure.
- **Hansika:** the bowl-and-spill depth model instead of a simple fill, the grading rules and every threshold (6 in "wet", 1 ft floor, the vehicle depth limits, the 100 m Milton cap), and how to validate against Milton without tuning to it.
- **Harshith:**
  - **Design direction:** the map is the content, one surface, one tint colour.
  - **Onboarding and privacy:** what onboarding asks; keeping personal data on the device.
  - **Ask Pelican's safety design:** the language model only reads the request and never invents routes or times.
  - **Features:** the optional camera opt-in, and that a camera someone already owns should work, not only a spare phone; the boot animation's story, and that it is drawn live rather than played as a video; storms named in plain words instead of return periods; rewards shown as homes a person's reports reach; the buying, renting or building checklist; the three guided demos and what each must show.

**What AI generated.** Claude Code wrote most of the code under our direction, and we reviewed, ran and corrected it:
- **Directed by Hansika:** `pipeline/`, `web/lib/`, `web/app/api/`, `supabase/`.
- **Directed by Harshith:** `web/app/` pages, `web/components/`, `docs/`, `design/`, `.github/` and the root files.
- **Written by Harshith's sessions inside Hansika's folders:** when Hansika's session hit its usage limit, they finished `/api/weather`, `/api/health`, `/api/pelican` and the storm-pipe layer. Later, at Harshith's request, they added named-place search and reverse lookup in `web/lib/address`, the weather brief (`web/lib/forecast`, `/api/brief`), the food finder (`web/lib/food`, `/api/food-campaigns`), an optional vehicle on the latest-departure search, and the community-name list (`pipeline/ingest/communities.py`). Hansika reviewed these when she came back.

**Before the event (before 11:00).** Research and planning only, with Claude Code: the notes in `prep/` (plan, research, team guides) and public Claude Code skills (kept on our machines, removed from the repo at the end of the event; they are in the git history). No code, no design assets and no data were prepared before 11:00. One thing to disclose: an intermediate rendered intro, made and removed during the event, was built with the paper-cut tools from Harshith's own earlier video project and carried that project's paper-grain texture. It is in the git history only. The intro that ships is new code with a grain texture generated today.

**Boot animation.** Designed with an AI design tool. The final paper-cut version was written by Claude Code and is drawn live in the browser (`web/components/boot/boot-film.tsx`), under our direction. Earlier rendered versions (Blender, `design/boot/build_boot.py`, then a Remotion film) were replaced because a phone can refuse to autoplay video.

**Inside the product.**
- **Gemini's jobs:** it reads resident flood photos (water present, depth range, reference object), writes plain-language guidance and remedies from our numbers, turns an "Ask Pelican" request into a destination type, and searches the web for food distributions (Google Search grounding), listing only what it found with the source of each.
- **Guards:** every Gemini answer is checked so it cannot add numbers we did not give it. With Gemini off, the app falls back to fixed text and still works: the grade, map, storm timeline and routing never need it. When the food search is unavailable (it was over its quota during judging day), the panel says so and points to 211; it never shows made-up events.
- **Off by default since the event:** the public site now runs with Gemini switched off so it costs nothing to host. Where a Gemini feature would be, the interface says it is paused. Anyone hosting their own copy turns it on with `AI_PROVIDER=gemini` and a key (see `.env.example`).
- **Not Gemini:** the weather brief, the buying, renting or building checklist and the guided demos are written from fixed rules and our own numbers, with no language model.

## Tradeoffs we chose

- **3 m lidar from 2011** instead of the 2025 county lidar (published 2026-11-05): faster to fetch and process today; the newer data is the first upgrade.
- **No storm sewer flow model.** Pipes are shown on the map but water is not routed through them, so the model is pessimistic where drains work and optimistic where they clog.
- **One calibration storm (Milton).** The 52.3% hit rate is one check against one storm, not a guarantee.
- **Water drawn on the CPU per hour**, not animated on the GPU: simpler and reliable, less smooth.
- **Personal data only in the browser:** private by default, but it does not follow you to a second device.

## Limits and safety

Fludd is a screening estimate from a simplified model. It leaves out storm sewers, storm surge, river flooding and groundwater, and is checked against one storm. It is not a FEMA flood determination, and not for insurance, lending or purchase decisions. In a storm, follow Hillsborough County Emergency Management and the National Weather Service. Never drive or walk into floodwater. The app never tells anyone a flooded road is safe.

## Run it

```bash
cd web
cp ../.env.example .env.local   # fill in the keys you have; the app runs without them
npm ci
npm run dev                     # http://localhost:3000
```

Set `NEXT_PUBLIC_DATA_SET=real` to use the real data in `web/public/data/` (the default is the small toy fixture). The pipeline: `cd pipeline && uv run python run.py`. It runs the USF area unless `FLUDD_AREA` names another one from `pipeline/config.py` (see `docs/regions.md`).

## Tests

```bash
cd web && npm run lint && npm run typecheck && npm test     # 450+ tests
cd pipeline && uv run pytest -q                              # 84 tests
```

CI runs lint, typecheck, both test suites and a secret scan on every push.

## Repo guide

- `pipeline/`: data download, depth model, road graph, gold export (Python).
- `web/`: the Next.js app. `lib/` holds the logic, `components/` the display, `app/api/` the server routes.
- `supabase/`: reports table, private photo storage, access rules.
- `docs/contracts.md`: the boundary between the logic and the interface.
- `docs/camera-bridge.md`: sending stills from a security camera you already have.
- `docs/privacy.md`: what is collected, how reports stay anonymous, GDPR-style rights, and rules for public-safety cameras.
- `docs/shortcut.md`: the "Report flooding" and "Flood brief" iPhone Shortcuts, and Home Screen widget options.
- `docs/demo-script.md`: the 3-minute judging walkthrough.
- `docs/food-share.md`: design for restaurants giving food to neighbours during a flood (giver and receiver portals, anonymous by design). Not built yet.
- `prep/`: planning and research notes written before the event. They contain no code.
- `design/boot/`: the boot animation's references and the earlier Blender build. The shipped intro is `web/components/boot/`.

## License

The code is released under the [MIT License](LICENSE).

The data is not ours to license. The files in `web/public/data/` are derived from the public sources listed under "Data sources" and stay under those sources' own terms; road and place data from OpenStreetMap is © OpenStreetMap contributors under the Open Database License (ODbL).
