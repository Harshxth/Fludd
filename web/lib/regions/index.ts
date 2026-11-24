// The region index (docs/regions.md): every area Fludd covers and the tiles it is cut into.
// regions.json sits at the data root. A position is covered when some tile's box holds it.
import { z } from "zod";
import { DATA_BASE } from "@/lib/config";
import { DataContractError } from "@/lib/data/validate";
import type { LngLat, Manifest } from "@/lib/types";

export interface Tile {
  id: string;
  name: string;
  /** [west, south, east, north] in degrees; equals the bbox of the manifest in `path`. */
  bbox: Manifest["bbox"];
  /** Folder under the data root. "" is the root itself. */
  path: string;
}
export interface Area {
  id: string;
  name: string;
  tiles: Tile[];
}
export interface RegionIndex {
  areas: Area[];
}

const num = z.number().refine(Number.isFinite, "must be a finite number");
const id = z.string().regex(/^[a-z0-9-]+$/, "must be lower-case letters, digits and dashes");
const tile = z.object({
  id,
  name: z.string().min(1),
  bbox: z.tuple([num, num, num, num]).refine(([w, s, e, n]) => w < e && s < n, "must be [west, south, east, north] with west < east and south < north"),
  // Folder names only: the path is joined onto the data root in the browser and on the server.
  path: z.string().regex(/^([a-z0-9-]+(\/[a-z0-9-]+)*)?$/, "must be a folder under the data root, or empty"),
});
const regions = z.object({
  areas: z.array(z.object({ id, name: z.string().min(1), tiles: z.array(tile).min(1) })).min(1),
});

/** Checks raw JSON against the index format. Throws DataContractError naming the file and the field. */
export function parseRegions(raw: unknown, file: string): RegionIndex {
  const parsed = regions.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DataContractError(file, issue?.path.join(".") || "(root)", issue?.message ?? "is invalid");
  }
  const seen = new Set<string>();
  for (const t of parsed.data.areas.flatMap((a) => a.tiles)) {
    if (seen.has(t.id)) throw new DataContractError(file, "areas.tiles.id", `repeats tile id "${t.id}"`);
    seen.add(t.id);
  }
  return parsed.data;
}

/** The tile whose box holds the position (edges count), with its area. null when no tile does. */
export function findTile(index: RegionIndex, [lng, lat]: LngLat): { area: Area; tile: Tile } | null {
  for (const area of index.areas) {
    for (const tile of area.tiles) {
      const [west, south, east, north] = tile.bbox;
      if (lng >= west && lng <= east && lat >= south && lat <= north) return { area, tile };
    }
  }
  return null;
}

/** One line per tile for "what we cover" text, e.g. "USF and the University Area (Tampa)". */
export function coveredPlaces(index: RegionIndex): string[] {
  return index.areas.flatMap((a) => a.tiles.map((t) => `${t.name} (${a.name})`));
}

let cache: Promise<RegionIndex> | null = null;

/** Loads regions.json once per session (browser). A failed load is retried on the next call. */
export function loadRegions(): Promise<RegionIndex> {
  cache ??= fetch(`${DATA_BASE}/regions.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`regions.json failed to load from ${DATA_BASE} (HTTP ${res.status})`);
      return parseRegions((await res.json()) as unknown, "regions.json");
    })
    .catch((err: unknown) => {
      cache = null;
      throw err;
    });
  return cache;
}
