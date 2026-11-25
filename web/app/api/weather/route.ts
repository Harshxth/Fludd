// Active National Weather Service alerts at a point. NWS requires a User-Agent, which the browser cannot set,
// hence this proxy. Coordinates are rounded to 4 decimals (NWS rejects more).
import { apiError } from "@/lib/api";
import { serverConfig } from "@/lib/config";

interface NwsAlerts {
  features?: { properties?: { event?: string; headline?: string | null; severity?: string; ends?: string | null; expires?: string | null } }[];
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat"));
  const lng = Number(q.get("lng"));
  if (!q.get("lat") || !q.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return apiError(400, "bad_request", "lat and lng must be numbers in range");
  }
  const point = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${point}`, {
      headers: { "User-Agent": serverConfig().nwsUserAgent, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return apiError(502, "upstream_error", `The weather service answered ${res.status}`);
    const body = (await res.json()) as NwsAlerts;
    const alerts = (body.features ?? [])
      .map((f) => f.properties ?? {})
      .filter((p) => typeof p.event === "string" && p.event.length > 0)
      // `ends` is when the hazard ends; NWS leaves it empty for some alerts, and then the alert's expiry stands in.
      .map((p) => ({ event: p.event as string, headline: p.headline ?? p.event ?? "", severity: p.severity ?? "Unknown", ends: p.ends ?? p.expires ?? null }));
    return Response.json({ alerts });
  } catch {
    return apiError(502, "upstream_error", "The weather service could not be reached");
  }
}
