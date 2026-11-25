// Address search through the Hillsborough County composite locator (no key; CORS allowed). Hansika.
// Named places (apartment communities, neighbourhoods, shops) come from ArcGIS World, which the county locator
// does not know; added by Harshith's session at Harshith's request (2026-11-21 15:00).
// See prep/03-drainage-roads-live-data.md section E1. Names and types as in docs/contracts.md.
import { findTile, loadRegions } from "@/lib/regions";
import type { AddressMatch, AddressSuggestion, LngLat } from "@/lib/types";

const LOCATOR =
  "https://maps.hillsboroughcounty.org/arcgis/rest/services/Geocoding/Composite_Address_Locator_Overall/GeocodeServer";

/**
 * A suggestion id carries both the locator's magicKey and the suggestion text, joined by "|":
 * findAddressCandidates returns no candidates for a magicKey without its SingleLine text (checked 2026-11-21).
 */
const SEP = "|";

/** ArcGIS World geocoder: suggest and findAddressCandidates without a key (no stored results). */
const WORLD = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
/** World suggestion ids start with this, so resolveAddress knows which locator to ask. */
const WORLD_PREFIX = "w:";
/** Places anywhere in Florida, biased to USF. Outside the tiles they get the storm screen, not a grade. */
const FLORIDA_EXTENT = "-87.7,24.4,-79.9,31.1";
const USF: LngLat = [-82.4139, 28.0587];
const MAX_SUGGESTIONS = 6;

interface SuggestResponse {
  suggestions?: { text: string; magicKey: string; isCollection?: boolean }[];
  error?: { message?: string };
}
interface Candidate {
  address: string;
  location: { x: number; y: number };
  score: number;
}
interface CandidatesResponse {
  candidates?: Candidate[];
  error?: { message?: string };
}

async function callLocator<T extends { error?: { message?: string } }>(what: string, url: URL): Promise<T> {
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`County ${what} failed (HTTP ${res.status})`);
  const body = (await res.json()) as T;
  if (body.error) throw new Error(`County ${what} failed: ${body.error.message ?? "unknown error"}`);
  return body;
}

async function suggestFrom(base: string, prefix: string, q: string, extra: Record<string, string>): Promise<AddressSuggestion[]> {
  const url = new URL(`${base}/suggest`);
  url.searchParams.set("text", q);
  url.searchParams.set("f", "json");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const body = await callLocator<SuggestResponse>("address suggest", url);
  return (body.suggestions ?? [])
    .filter((s) => !s.isCollection)
    .map((s) => ({ id: `${prefix}${s.magicKey}${SEP}${s.text}`, label: s.text }));
}

/** County addresses first, then named places from ArcGIS World that the county list doesn't already hold. */
export async function suggestAddresses(text: string): Promise<AddressSuggestion[]> {
  const q = text.trim();
  if (!q) return [];
  const [county, world] = await Promise.allSettled([
    suggestFrom(LOCATOR, "", q, {}),
    suggestFrom(WORLD, WORLD_PREFIX, q, {
      location: USF.join(","),
      searchExtent: FLORIDA_EXTENT,
      countryCode: "USA",
      maxSuggestions: String(MAX_SUGGESTIONS),
    }),
  ]);
  // Both down: report the county error, as before. One down: use the other.
  if (county.status === "rejected" && world.status === "rejected") throw county.reason;
  const first = county.status === "fulfilled" ? county.value : [];
  // Same place twice ("Avalon Heights Blvd, Tampa" and "Avalon Heights Blvd, Tampa, FL, 33613, USA"): compare the part before the first comma.
  const head = (label: string) => label.split(",")[0].trim().toLowerCase();
  const seen = new Set(first.map((s) => head(s.label)));
  const places = world.status === "fulfilled" ? world.value.filter((s) => !seen.has(head(s.label))) : [];
  return [...first, ...places].slice(0, MAX_SUGGESTIONS);
}

export async function resolveAddress(suggestionId: string): Promise<AddressMatch | null> {
  const world = suggestionId.startsWith(WORLD_PREFIX);
  const id = world ? suggestionId.slice(WORLD_PREFIX.length) : suggestionId;
  const cut = id.indexOf(SEP);
  const magicKey = cut < 0 ? id : id.slice(0, cut);
  const text = cut < 0 ? "" : id.slice(cut + 1);
  const url = new URL(`${world ? WORLD : LOCATOR}/findAddressCandidates`);
  if (text) url.searchParams.set("SingleLine", text);
  url.searchParams.set("magicKey", magicKey);
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxLocations", "5");
  url.searchParams.set("f", "json");
  const [body, regions] = await Promise.all([callLocator<CandidatesResponse>("address lookup", url), loadRegions()]);
  const best = (body.candidates ?? []).reduce<Candidate | null>((top, c) => (top === null || c.score > top.score ? c : top), null);
  if (!best) return null;
  const position: LngLat = [best.location.x, best.location.y];
  return { label: best.address, position, inside: findTile(regions, position) !== null };
}

/** The street address at a point (a building tapped on the map), from ArcGIS World. null when there is none. */
export async function reverseGeocode([lng, lat]: LngLat): Promise<string | null> {
  const url = new URL(`${WORLD}/reverseGeocode`);
  url.searchParams.set("location", `${lng},${lat}`);
  url.searchParams.set("featureTypes", "PointAddress,StreetAddress");
  url.searchParams.set("f", "json");
  const body = await callLocator<{ address?: { Match_addr?: string }; error?: { message?: string } }>("address lookup", url);
  return body.address?.Match_addr ?? null;
}
