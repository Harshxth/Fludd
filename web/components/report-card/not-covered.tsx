"use client";

import { useEffect, useState } from "react";
import { coveredPlaces, loadRegions } from "@/lib/regions";

/** What to say for a place no tile holds (docs/regions.md). `places` comes from coveredPlaces; empty while unknown. */
export function notCoveredText(label: string, places: string[]): string {
  const where = places.length > 0 ? ` Fludd covers ${new Intl.ListFormat("en", { type: "conjunction" }).format(places)} so far.` : "";
  return `${label.split(",")[0]} is not covered yet, so it gets no grade.${where}`;
}

/** The places Fludd covers, from the region index. Empty until loaded, or if the index fails to load. */
export function useCoveredPlaces(): string[] {
  const [places, setPlaces] = useState<string[]>([]);
  useEffect(() => {
    let stale = false;
    loadRegions().then((r) => !stale && setPlaces(coveredPlaces(r)), () => undefined);
    return () => {
      stale = true;
    };
  }, []);
  return places;
}
