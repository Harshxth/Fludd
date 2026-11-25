import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as weather } from "@/app/api/weather/route";

const req = (q: string) => new Request(`http://localhost/api/weather${q}`);

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/weather", () => {
  it("rejects missing or out-of-range coordinates", async () => {
    expect((await weather(req(""))).status).toBe(400);
    expect((await weather(req("?lat=999&lng=-82.4"))).status).toBe(400);
    expect((await weather(req("?lat=abc&lng=-82.4"))).status).toBe(400);
  });

  it("asks NWS for active alerts at the point, with a User-Agent, and maps them", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        features: [
          { properties: { event: "Flood Watch", headline: "Flood Watch until 8 PM", severity: "Moderate", ends: null, expires: "2026-11-24T20:00:00-05:00" } },
          { properties: { event: "Coastal Flood Statement", headline: "Statement", severity: "Minor", ends: "2026-11-26T07:00:00-05:00" } },
          { properties: { event: "", headline: "dropped: no event" } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await weather(req("?lat=28.058712&lng=-82.413912"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      alerts: [
        // `ends` is when the hazard ends; NWS leaves it empty for some alerts, and then the alert's expiry stands in.
        { event: "Flood Watch", headline: "Flood Watch until 8 PM", severity: "Moderate", ends: "2026-11-24T20:00:00-05:00" },
        { event: "Coastal Flood Statement", headline: "Statement", severity: "Minor", ends: "2026-11-26T07:00:00-05:00" },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.weather.gov/alerts/active?point=28.0587,-82.4139");
    expect(new Headers(init.headers).get("user-agent")).toBeTruthy();
  });

  it("returns 502 in the shared error shape when NWS fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const res = await weather(req("?lat=28.05&lng=-82.41"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "upstream_error" } });
  });
});

