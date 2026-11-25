// Address and place search: the Hillsborough County address locator, plus ArcGIS World for named places. fetch mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAddress, reverseGeocode, suggestAddresses } from "@/lib/address";
import { clearDataCache } from "@/lib/data";
import { diskFetch } from "../data/fixture-fetch";

const LOCATOR = "https://maps.hillsboroughcounty.org/arcgis/rest/services/Geocoding/Composite_Address_Locator_Overall/GeocodeServer";
const WORLD = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

/** County calls only, in order. World calls are kept apart so the county assertions read as before. */
let calls: string[] = [];
let worldCalls: string[] = [];
function mockCounty(handler: (url: URL) => unknown, status = 200, world: (url: URL) => unknown = () => ({ suggestions: [], candidates: [] }), worldStatus = 200) {
  vi.stubGlobal("fetch", diskFetch((u) => {
    const url = new URL(u);
    if (url.host === "geocode.arcgis.com") {
      worldCalls.push(u);
      return new Response(JSON.stringify(world(url)), { status: worldStatus });
    }
    calls.push(u);
    return new Response(JSON.stringify(handler(url)), { status });
  }));
}

beforeEach(() => {
  calls = [];
  worldCalls = [];
  clearDataCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("suggestAddresses", () => {
  it("calls the county suggest endpoint and maps text to label", async () => {
    mockCounty(() => ({
      suggestions: [
        { text: "4202 E Fowler Ave, Tampa", magicKey: "KEY1", isCollection: false },
        { text: "4202 E Fowler Ave, Thonotosassa", magicKey: "KEY2", isCollection: false },
      ],
    }));
    const s = await suggestAddresses("4202 E Fowl");
    const url = new URL(calls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${LOCATOR}/suggest`);
    expect(url.searchParams.get("text")).toBe("4202 E Fowl");
    expect(url.searchParams.get("f")).toBe("json");
    expect(s.map((x) => x.label)).toEqual(["4202 E Fowler Ave, Tampa", "4202 E Fowler Ave, Thonotosassa"]);
    expect(new Set(s.map((x) => x.id)).size).toBe(2);
  });

  it("returns nothing for blank text without calling the server", async () => {
    mockCounty(() => ({ suggestions: [] }));
    expect(await suggestAddresses("   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("adds named places from ArcGIS World after the county's addresses, from anywhere in Florida", async () => {
    mockCounty(
      () => ({ suggestions: [{ text: "13700 Avalon Heights Blvd, Tampa", magicKey: "C1", isCollection: false }] }),
      200,
      () => ({
        suggestions: [
          { text: "Avalon Heights, Tampa, FL, USA", magicKey: "W1", isCollection: false },
          { text: "13700 Avalon Heights Blvd, Tampa, FL, 33613, USA", magicKey: "W2", isCollection: false },
        ],
      }),
    );
    const s = await suggestAddresses("Avalon Heights");
    expect(s.map((x) => x.label)).toEqual(["13700 Avalon Heights Blvd, Tampa", "Avalon Heights, Tampa, FL, USA"]);
    const w = new URL(worldCalls[0]);
    expect(`${w.origin}${w.pathname}`).toBe(`${WORLD}/suggest`);
    // Florida, so a Miami address is found and told about its storm, even though it gets no grade.
    const [west, south, east, north] = (w.searchParams.get("searchExtent") ?? "").split(",").map(Number);
    expect(west < -87.5 && east > -80.1 && south < 24.6 && north > 31).toBe(true);
    expect(w.searchParams.get("countryCode")).toBe("USA");
  });

  it("still offers places when the county locator is down", async () => {
    mockCounty(() => ({}), 503, () => ({ suggestions: [{ text: "University Square, Tampa, FL, USA", magicKey: "W1", isCollection: false }] }));
    expect((await suggestAddresses("University Square")).map((x) => x.label)).toEqual(["University Square, Tampa, FL, USA"]);
  });

  it("throws a clear error when the locator fails", async () => {
    mockCounty(() => ({}), 503, undefined, 503);
    await expect(suggestAddresses("4202")).rejects.toThrow(/address suggest.*503/i);
  });

  it("throws when the locator answers with an ArcGIS error body", async () => {
    mockCounty(() => ({ error: { code: 400, message: "Invalid" } }), 200, () => ({ error: { code: 400, message: "Invalid" } }));
    await expect(suggestAddresses("4202")).rejects.toThrow(/Invalid/);
  });
});

describe("resolveAddress", () => {
  it("sends the suggestion text and magicKey, returns the best candidate in lng/lat, inside the toy box", async () => {
    mockCounty((url) => url.pathname.endsWith("/suggest")
      ? { suggestions: [{ text: "4202 E Fowler Ave, Tampa", magicKey: "KEY1", isCollection: false }] }
      : {
        spatialReference: { wkid: 4326 },
        candidates: [
          { address: "4202 E Fowler Ave, Tampa, 33620 (low)", location: { x: -82.5, y: 28.1 }, score: 80 },
          { address: "4202 E Fowler Ave, Tampa, 33620", location: { x: -82.4139475455857, y: 28.061936669896859 }, score: 100 },
        ],
      });
    const [s] = await suggestAddresses("4202 E Fowl");
    const m = await resolveAddress(s.id);
    const url = new URL(calls[1]);
    expect(`${url.origin}${url.pathname}`).toBe(`${LOCATOR}/findAddressCandidates`);
    expect(url.searchParams.get("magicKey")).toBe("KEY1");
    expect(url.searchParams.get("SingleLine")).toBe("4202 E Fowler Ave, Tampa");
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("f")).toBe("json");
    expect(m).toEqual({ label: "4202 E Fowler Ave, Tampa, 33620", position: [-82.4139475455857, 28.061936669896859], inside: true });
  });

  it("marks a match outside the manifest bbox as not inside", async () => {
    mockCounty(() => ({ candidates: [{ address: "1 Far Rd", location: { x: -82.5, y: 28.1 }, score: 100 }] }));
    expect(await resolveAddress("KEY9|1 Far Rd")).toEqual({ label: "1 Far Rd", position: [-82.5, 28.1], inside: false });
  });

  it("resolves a named place through ArcGIS World", async () => {
    mockCounty(
      () => ({ suggestions: [] }),
      200,
      (url) => url.pathname.endsWith("/suggest")
        ? { suggestions: [{ text: "University Square, Tampa, FL, USA", magicKey: "W1", isCollection: false }] }
        : { candidates: [{ address: "University Square", location: { x: -82.4139475455857, y: 28.061936669896859 }, score: 100 }] },
    );
    const [s] = await suggestAddresses("University Square");
    const m = await resolveAddress(s.id);
    const url = new URL(worldCalls[1]);
    expect(`${url.origin}${url.pathname}`).toBe(`${WORLD}/findAddressCandidates`);
    expect(url.searchParams.get("magicKey")).toBe("W1");
    expect(m).toEqual({ label: "University Square", position: [-82.4139475455857, 28.061936669896859], inside: true });
  });

  it("returns null when there is no candidate", async () => {
    mockCounty(() => ({ candidates: [] }));
    expect(await resolveAddress("KEY9|Nowhere")).toBeNull();
  });
});

describe("reverseGeocode", () => {
  it("asks ArcGIS World for the street address at a point", async () => {
    mockCounty(() => ({}), 200, () => ({ address: { Match_addr: "4202 E Fowler Ave, Tampa, Florida, 33620" } }));
    expect(await reverseGeocode([-82.4139, 28.0619])).toBe("4202 E Fowler Ave, Tampa, Florida, 33620");
    const url = new URL(worldCalls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${WORLD}/reverseGeocode`);
    expect(url.searchParams.get("location")).toBe("-82.4139,28.0619");
  });

  it("returns null where there is no address", async () => {
    mockCounty(() => ({}), 200, () => ({}));
    expect(await reverseGeocode([-82.4, 28.0])).toBeNull();
  });
});

describe("a locator that never answers", () => {
  it("gives up with an error the person can act on, instead of waiting for ever", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")))),
      );
      const lookup = reverseGeocode([-82.41, 28.06]);
      const caught = expect(lookup).rejects.toThrow(/did not answer/);
      await vi.advanceTimersByTimeAsync(10_000);
      await caught;
    } finally {
      vi.useRealTimers();
    }
  });
});
