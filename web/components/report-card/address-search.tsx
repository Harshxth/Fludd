"use client";

import { useEffect, useId, useState } from "react";
import { resolveAddress, suggestAddresses } from "@/lib/address";
import { resolveCommunity, suggestCommunities } from "@/components/report-card/communities";
import type { AddressMatch, AddressSuggestion } from "@/lib/types";
import { SHEET_HALF_EVENT } from "@/components/ui/sheet";

const DEBOUNCE_MS = 250;

/** `floating`: sits inside the phone's top search bar, so the field is borderless and the list drops below the bar. */
export function AddressSearch({ onPick, floating = false }: { onPick: (match: AddressMatch | null, error?: string) => void; floating?: boolean }) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  // The text the current suggestions answer, so "nothing found" is only said once a search has come back.
  const [answered, setAnswered] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (text.trim().length < 3) return;
    let stale = false;
    const t = setTimeout(() => {
      // Community names first (a local list, instant), then street addresses and other places.
      Promise.all([suggestCommunities(text), suggestAddresses(text).catch(() => [] as AddressSuggestion[])]).then(([named, found]) => {
        if (stale) return;
        const have = new Set(named.map((n) => n.label.toLowerCase()));
        setSuggestions([...named, ...found.filter((f) => !have.has(f.label.split(",")[0].trim().toLowerCase()))].slice(0, 6));
        setActive(-1);
        setAnswered(text.trim());
      });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [text]);

  async function pick(s: AddressSuggestion) {
    setText(s.label);
    setOpen(false);
    // Back down to half so the map shows the place (no-op outside the sheet).
    window.dispatchEvent(new Event(SHEET_HALF_EVENT));
    try {
      onPick(resolveCommunity(s.id) ?? (await resolveAddress(s.id)));
    } catch (e) {
      onPick(null, e instanceof Error ? e.message : "The address lookup failed");
    }
  }

  // Fewer than 3 letters: show nothing, without clearing state inside the effect.
  const shown = text.trim().length >= 3 ? suggestions : [];
  const showList = open && shown.length > 0;
  const nothing = open && text.trim().length >= 3 && shown.length === 0 && answered === text.trim();

  return (
    <form
      role="search"
      className={floating ? "relative" : "relative mt-3"}
      onSubmit={(e) => {
        e.preventDefault();
        const s = shown[active >= 0 ? active : 0];
        if (s) void pick(s);
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">Search an address, place or ZIP code</label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Search an address, place or ZIP"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          if (e.key === "Escape") setOpen(false);
        }}
        className={`w-full rounded-[var(--radius-control)] text-body text-label ${floating ? "h-10 bg-transparent px-1" : "h-11 bg-fill px-3.5"}
          placeholder:text-label-3 outline-none focus-visible:ring-2 focus-visible:ring-tint`}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={`overflow-hidden rounded-[var(--radius-group)] bg-group ${floating ? "absolute -left-10 -right-12 top-full z-40 mt-3 shadow-[0_8px_24px_rgb(0_0_0/0.18)]" : "mt-2"}`}
        >
          {shown.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault(); // keep focus; commit on release
              }}
              onClick={() => void pick(s)}
              className={`pressable flex min-h-11 cursor-default items-center border-b border-separator px-3.5 text-subhead last:border-b-0
                ${i === active ? "bg-fill" : ""} active:bg-fill`}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {nothing && (
        <p role="status" className="rise-in mt-2 rounded-[var(--radius-group)] bg-group px-3.5 py-3 text-subhead text-label-2">
          Nothing called &ldquo;{text.trim()}&rdquo; in the area Fludd covers. Try its street address.
        </p>
      )}
    </form>
  );
}
