// The storm screen for a place Fludd does not grade yet: live alerts, safety steps, official links. No grade, no depth.
import { describe, expect, it } from "vitest";
import { alertUntil, stormLinks } from "@/lib/storm";

describe("stormLinks", () => {
  it("points the Weather Service forecast at the place itself", () => {
    const nws = stormLinks([-80.19181, 25.76172]).find((l) => l.href.startsWith("https://forecast.weather.gov/"));
    expect(nws?.href).toBe("https://forecast.weather.gov/MapClick.php?lat=25.7617&lon=-80.1918");
  });

  it("lists only official sources over https", () => {
    const links = stormLinks([-80.19, 25.76]);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const l of links) {
      const host = new URL(l.href).hostname;
      expect(new URL(l.href).protocol).toBe("https:");
      expect(host.endsWith(".gov") || host.endsWith("floridadisaster.org") || host.endsWith("fl511.com"), host).toBe(true);
    }
  });
});

describe("alertUntil", () => {
  const now = new Date("2026-11-24T15:00:00-05:00");

  it("says the day and time the alert runs until, in Florida time", () => {
    expect(alertUntil("2026-11-26T01:00:00-05:00", now)).toBe("until Thu 1 AM");
  });

  it("says nothing when the end is unknown or bad", () => {
    expect(alertUntil(null, now)).toBe("");
    expect(alertUntil("soon", now)).toBe("");
  });

  it("says today for an alert that ends today", () => {
    expect(alertUntil("2026-11-24T20:00:00-05:00", now)).toBe("until 8 PM today");
  });
});
