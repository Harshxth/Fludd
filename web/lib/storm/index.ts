// The storm screen for a place Fludd does not grade yet (components/report-card/storm-here.tsx).
// It only passes on what official sources say: no grade, no depth, nothing of ours.
import type { LngLat } from "@/lib/types";

export interface StormLink {
  label: string;
  detail: string;
  href: string;
}

/** Official sources for any place in Florida. Every link checked by hand on 2026-11-24. */
export function stormLinks([lng, lat]: LngLat): StormLink[] {
  return [
    {
      label: "Weather Service forecast for this spot",
      detail: "Every warning in force here, from the National Weather Service",
      href: `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
    },
    { label: "Your county's emergency office", detail: "Shelters, sandbags and orders, from the state's list of counties", href: "https://www.floridadisaster.org/counties/" },
    { label: "Know your evacuation zone", detail: "Florida Division of Emergency Management", href: "https://www.floridadisaster.org/knowyourzone/" },
    { label: "Road closures (FL511)", detail: "Florida Department of Transportation", href: "https://www.fl511.com/" },
  ];
}

// ponytail: Eastern time for all of Florida. The western panhandle is on Central time; say so when an area there is added.
const ZONE = "America/New_York";
const plain = (s: string) => s.replace(/\s/g, " "); // ICU puts a narrow no-break space before AM and PM

/** "until Thu 1 AM", "until 8 PM today", or "" when the end time is missing or unreadable. */
export function alertUntil(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return "";
  const time = plain(end.toLocaleTimeString("en-US", { timeZone: ZONE, hour: "numeric", minute: end.getUTCMinutes() ? "2-digit" : undefined }));
  const sameDay = (d: Date) => d.toLocaleDateString("en-US", { timeZone: ZONE });
  if (sameDay(end) === sameDay(now)) return `until ${time} today`;
  return `until ${end.toLocaleDateString("en-US", { timeZone: ZONE, weekday: "short" })} ${time}`;
}
