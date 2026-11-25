"use client";

import { useEffect, useState } from "react";
import { Group } from "@/components/ui/surface";
import { alertUntil, stormLinks } from "@/lib/storm";
import type { LngLat } from "@/lib/types";

interface Alert {
  event: string;
  headline: string;
  severity: string;
  ends: string | null;
}
const LOUD = new Set(["Extreme", "Severe"]);
const row = "flex min-h-14 items-center justify-between gap-3 border-b border-separator px-4 py-2.5 last:border-b-0";

/**
 * For a place no tile holds: what the National Weather Service says right now, what to do, and where to look.
 * No grade and no depth, because Fludd has not modelled this place.
 */
export function StormHere({ position }: { position: LngLat }) {
  const key = position.join(",");
  const [alerts, setAlerts] = useState<{ key: string; list: Alert[] | null } | null>(null);
  useEffect(() => {
    let stale = false;
    const [lng, lat] = key.split(",");
    fetch(`/api/weather?lat=${lat}&lng=${lng}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ alerts?: Alert[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => !stale && setAlerts({ key, list: j.alerts ?? [] }))
      .catch(() => !stale && setAlerts({ key, list: null }));
    return () => {
      stale = true;
    };
  }, [key]);
  const now = alerts?.key === key ? alerts : null;

  return (
    <>
      <Group title="Weather alerts here now">
        {now === null ? (
          <p className="px-4 py-3 text-subhead text-label-2">Checking the National Weather Service…</p>
        ) : now.list === null ? (
          <p className="px-4 py-3 text-subhead text-label-2">The National Weather Service could not be reached. Use the forecast link below.</p>
        ) : now.list.length === 0 ? (
          <p className="px-4 py-3 text-subhead text-label-2">No weather alerts here right now.</p>
        ) : (
          now.list.map((a, i) => (
            <div key={`${a.event}-${i}`} className={row}>
              <span>
                <span className={`block text-body font-semibold ${LOUD.has(a.severity) ? "text-late" : ""}`}>
                  {a.event} {alertUntil(a.ends) && <span className="font-normal text-label-2">{alertUntil(a.ends)}</span>}
                </span>
                {a.headline && a.headline !== a.event && <span className="block text-footnote text-label-2">{a.headline}</span>}
              </span>
            </div>
          ))
        )}
      </Group>

      <Group title="Stay safe">
        <ul className="px-4 py-3 text-subhead">
          <li>Never drive or walk through flood water. Turn around.</li>
          <li className="mt-2">If water is rising around you, move to higher ground.</li>
          <li className="mt-2">Follow your county&rsquo;s orders, including evacuation.</li>
        </ul>
        <a href="tel:911" className={`pressable ${row} border-t`}>
          <span><span className="block text-body font-semibold text-late">911</span><span className="block text-footnote text-label-2">Water rising inside, or someone in danger</span></span>
        </a>
      </Group>

      <Group title="Official sources">
        {stormLinks(position).map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={`pressable ${row}`}>
            <span><span className="block text-body font-semibold">{l.label}</span><span className="block text-footnote text-label-2">{l.detail}</span></span>
            <span className="text-tint" aria-hidden>↗</span>
          </a>
        ))}
      </Group>
    </>
  );
}
