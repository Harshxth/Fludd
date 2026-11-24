// The region index (docs/regions.md): which tile holds a position, and what to say when none does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coveredPlaces, findTile, parseRegions, type RegionIndex } from "@/lib/regions";
import type { Manifest } from "@/lib/types";

const index: RegionIndex = {
  areas: [
    {
      id: "tampa",
      name: "Tampa",
      tiles: [
        { id: "usf", name: "USF", bbox: [-82.45, 28.03, -82.38, 28.09], path: "" },
        { id: "downtown", name: "Downtown", bbox: [-82.48, 27.93, -82.43, 27.97], path: "tiles/downtown" },
      ],
    },
    { id: "pinellas", name: "Pinellas", tiles: [{ id: "clearwater", name: "Clearwater", bbox: [-82.82, 27.94, -82.74, 28.0], path: "tiles/clearwater" }] },
  ],
};

describe("findTile", () => {
  it("returns the tile and area that hold a position", () => {
    const hit = findTile(index, [-82.45, 27.95]);
    expect(hit?.tile.id).toBe("downtown");
    expect(hit?.area.id).toBe("tampa");
    expect(findTile(index, [-82.8, 27.97])?.area.id).toBe("pinellas");
  });

  it("counts the box edges as inside", () => {
    expect(findTile(index, [-82.45, 28.03])?.tile.id).toBe("usf");
    expect(findTile(index, [-82.38, 28.09])?.tile.id).toBe("usf");
  });

  it("returns null outside every tile", () => {
    expect(findTile(index, [-81.38, 28.54])).toBeNull(); // Orlando
    expect(findTile(index, [-82.45, 28.0])).toBeNull(); // between the two Tampa tiles
  });
});

describe("coveredPlaces", () => {
  it("names every tile with its area", () => {
    expect(coveredPlaces(index)).toEqual(["USF (Tampa)", "Downtown (Tampa)", "Clearwater (Pinellas)"]);
  });
});

describe("parseRegions", () => {
  it("accepts a sound index", () => {
    expect(parseRegions(index, "regions.json")).toEqual(index);
  });

  it.each([
    ["no areas", { areas: [] }],
    ["a box with west east of east", { areas: [{ id: "a", name: "A", tiles: [{ id: "t", name: "T", bbox: [1, 0, 0, 1], path: "" }] }] }],
    ["a path that climbs out of the data folder", { areas: [{ id: "a", name: "A", tiles: [{ id: "t", name: "T", bbox: [0, 0, 1, 1], path: "../x" }] }] }],
    ["an absolute path", { areas: [{ id: "a", name: "A", tiles: [{ id: "t", name: "T", bbox: [0, 0, 1, 1], path: "/etc" }] }] }],
    [
      "two tiles with one id",
      { areas: [{ id: "a", name: "A", tiles: [{ id: "t", name: "T", bbox: [0, 0, 1, 1], path: "" }, { id: "t", name: "U", bbox: [2, 2, 3, 3], path: "tiles/u" }] }] },
    ],
  ])("rejects %s, naming the file", (_, bad) => {
    expect(() => parseRegions(bad, "regions.json")).toThrow(/regions\.json/);
  });
});

describe.each([["real", "../../public/data"], ["toy", "../../public/data/toy"]])("%s regions.json", (_, rel) => {
  const dir = join(__dirname, rel);
  const read = (p: string): unknown => JSON.parse(readFileSync(join(dir, p), "utf8"));

  it("lists tiles whose box equals the manifest in their folder", () => {
    const regions = parseRegions(read("regions.json"), "regions.json");
    const tiles = regions.areas.flatMap((a) => a.tiles);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      const manifest = read(join(t.path, "manifest.json")) as Manifest;
      expect(t.bbox, `tile ${t.id}`).toEqual(manifest.bbox);
    }
  });
});
