"use client";

import { STORM_WORDS } from "@/components/ui/storm-words";

// Ask Pelican: type where you need to go; get a route on roads the model keeps open at the chosen storm hour.
// The server only reads the request and looks up real places; every route and time comes from bestRoute
// on the road graph, here in the browser. Pelican never calls a road safe.
import { useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { aboutTime } from "@/components/stages/shared";
import { Paused } from "@/components/ui/paused";
import { AI_ON } from "@/lib/config";
import { bestRoute } from "@/lib/routing";
import { OpenInMaps } from "./open-in-maps";
import type { LngLat, PumpState, Scenario } from "@/lib/types";

export const SAFETY_LINE = "Never drive into floodwater. Turn around if you see water on the road.";

type Category = "grocery" | "pharmacy" | "hospital" | "gas" | "shelter" | "school" | "work_other";

interface PelicanAnswer {
  intent: { kind: "category" | "address" | "unclear"; category?: Category; addressText?: string; vehicle: "car" | "foot" };
  places: { name: string; position: LngLat; distanceM: number }[];
  addressMatch?: { label: string; position: LngLat };
}

interface Option {
  name: string;
  line: LngLat[];
  minutes: number;
}

type Reply =
  | { kind: "routes"; best: Option; others: Option[]; mode: string; when: string; note?: string }
  | { kind: "text"; text: string };

interface Turn {
  id: number;
  ask: string;
  reply: Reply | null;
}

const CATEGORY_WORDS: Record<Category, string> = {
  grocery: "grocery store",
  pharmacy: "pharmacy",
  hospital: "hospital",
  gas: "gas station",
  shelter: "shelter",
  school: "school",
  work_other: "place like that",
};

const CHIPS: { label: string; text: string }[] = [
  { label: "Groceries", text: "I need groceries" },
  { label: "Pharmacy", text: "Get me to a pharmacy" },
  { label: "Hospital", text: "Get me to the hospital" },
];

const mins = (m: number) => Math.max(1, Math.round(m));
/** Place in a staggered entrance, read by the motion kit classes. Always set, so nothing inherits a parent's place. */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

function errorText(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: { message?: unknown } }).error;
    if (typeof e?.message === "string") return e.message;
  }
  return "Pelican could not answer right now. Try again in a minute.";
}

export function AskPelican({
  from, vehicle: ownVehicle = "car", scenario, pump, hour, hourZero, onRoute,
}: {
  from: LngLat | null;
  /** What the resident drives (from setup); walking requests still route on foot. */
  vehicle?: "car" | "suv";
  scenario: Scenario;
  pump: PumpState;
  hour: number;
  hourZero: string | null;
  onRoute: (line: LngLat[] | null) => void;
}) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);

  const when = hourZero ? aboutTime(hourZero, hour) : `hour ${hour} of the storm`;

  async function answer(ask: string): Promise<Reply> {
    if (!from) return { kind: "text", text: "Set your home or tap the locate button first." };
    const res = await fetch("/api/pelican", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: ask, position: from }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !body) return { kind: "text", text: errorText(body) };
    const { intent, places, addressMatch } = body as PelicanAnswer;

    if (intent.kind === "unclear") {
      return { kind: "text", text: "I can find groceries, a pharmacy, a hospital, gas, a shelter or a street address. Try asking for one of those." };
    }
    const targets = intent.kind === "address"
      ? (addressMatch ? [{ name: addressMatch.label, position: addressMatch.position }] : [])
      : places;
    const what = intent.kind === "address" ? "that address" : `a ${CATEGORY_WORDS[intent.category ?? "work_other"]}`;
    if (targets.length === 0) {
      return {
        kind: "text",
        text: intent.kind === "address"
          ? "I could not find that address inside the map area. Check the spelling or pick it from the search box."
          : `I could not find ${what} inside the map area.`,
      };
    }

    const vehicle = intent.vehicle === "foot" ? "foot" : ownVehicle;
    // "failed" (the router broke) is not the same as "closed" (the model floods every way there).
    const routesAt = async (h: number) => {
      let failed = 0;
      const results = await Promise.all(
        targets.map(async (t) => {
          try {
            const r = await bestRoute(from, t.position, vehicle, scenario, pump, h);
            return r.kind === "ok" ? { name: t.name, line: r.line, minutes: r.minutes } : null;
          } catch {
            failed++;
            return null;
          }
        }),
      );
      return { open: results.filter((r): r is Option => r !== null).sort((a, b) => a.minutes - b.minutes), failed };
    };
    const mode = vehicle === "foot" ? "on foot" : "by car";
    const noun = intent.kind === "address" ? "that address" : `a ${CATEGORY_WORDS[intent.category ?? "work_other"]}`;
    const atHour = await routesAt(hour);
    if (atHour.open.length > 0) {
      onRoute(atHour.open[0].line);
      return { kind: "routes", best: atHour.open[0], others: atHour.open.slice(1, 3), mode, when };
    }
    if (atHour.failed === targets.length) {
      onRoute(null);
      return { kind: "text", text: "Routes are unavailable right now. Try again in a moment, and follow official instructions." };
    }
    // Every way is closed in the simulated storm at this hour. No flood is happening now, so give today's route too.
    const now = hour > 0 ? await routesAt(0) : { open: [], failed: 0 };
    if (now.open.length > 0) {
      onRoute(now.open[0].line);
      return {
        kind: "routes",
        best: now.open[0],
        others: now.open.slice(1, 3),
        mode,
        when: "the start of the storm, before the rain builds",
        note: `In the simulated ${STORM_WORDS[scenario].name.toLowerCase()} at ${when}, every route to ${noun} is flooded: go before then, or stay put.`,
      };
    }
    onRoute(null);
    return { kind: "text", text: `Every route to ${noun} is flooded in this storm. Stay put and follow official instructions.` };
  }

  async function send(ask: string) {
    const q = ask.trim().slice(0, 300);
    if (!q || busy) return;
    const id = nextId.current++;
    setTurns((t) => [...t.slice(-3), { id, ask: q, reply: null }]);
    setText("");
    setBusy(true);
    let reply: Reply;
    try {
      reply = await answer(q);
    } catch {
      reply = { kind: "text", text: "Pelican could not answer right now. Try again in a minute." };
    }
    setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, reply } : turn)));
    setBusy(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  return (
    <section aria-label="Ask Pelican" className="rise-in flex flex-col gap-3 rounded-group bg-group p-3" style={at(0)}>
      {turns.length > 0 && (
        <ol className="flex flex-col gap-2" aria-live="polite">
          {turns.map((turn) => (
            <li key={turn.id} className="flex flex-col gap-2">
              <p className="rise-in max-w-[85%] self-end rounded-[18px] bg-tint px-3.5 py-2 text-body text-white" style={at(0)}>
                {turn.ask}
              </p>
              {/* The wrapper brings Pelican's bubble in once. The bubble itself only moves to nudge when it has to say no. */}
              <div className="rise-in max-w-[92%] self-start" style={at(2)}>
                <div className={`rounded-[18px] bg-fill px-3.5 py-2 text-body text-label ${turn.reply?.kind === "text" ? "nudge" : ""}`}>
                  {turn.reply === null ? (
                    <p className="text-label-2" role="status">
                      <span className="sr-only">Pelican is checking the roads…</span>
                      <span className="typing" aria-hidden>
                        <i />
                        <i />
                        <i />
                      </span>
                    </p>
                  ) : turn.reply.kind === "text" ? (
                    <>
                      <p>{turn.reply.text}</p>
                      <p className="mt-1.5 text-footnote text-label-2">{SAFETY_LINE}</p>
                    </>
                  ) : (
                    <RouteReply reply={turn.reply} onRoute={onRoute} />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">Ask Pelican where you need to go</label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Where do you need to go?"
          className="h-11 min-w-0 flex-1 rounded-control bg-fill px-3 text-body text-label placeholder:text-label-3 outline-none focus-visible:ring-2 focus-visible:ring-tint"
          autoComplete="off"
          enterKeyHint="go"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="pressable h-11 shrink-0 rounded-control bg-tint px-4 text-headline font-semibold text-white active:bg-tint-pressed disabled:opacity-40"
        >
          Ask
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        {CHIPS.map((c, i) => (
          <button
            key={c.label}
            type="button"
            disabled={busy}
            onClick={() => void send(c.text)}
            className="pop-in pressable min-h-11 rounded-control px-3 text-subhead font-medium text-tint active:bg-fill disabled:opacity-40"
            style={at(i + 2)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!AI_ON && (
        <Paused what="Understanding longer questions" className="px-3">
          Short requests such as &ldquo;pharmacy&rdquo; or a street address still work.
        </Paused>
      )}
    </section>
  );
}

function RouteReply({ reply, onRoute }: { reply: Extract<Reply, { kind: "routes" }>; onRoute: (line: LngLat[]) => void }) {
  const { best, others, mode, when } = reply;
  // The route the person picked (best by default); "Open in Maps" hands over this one.
  const [chosen, setChosen] = useState<Option>(best);
  const pick = (o: Option) => {
    setChosen(o);
    onRoute(o.line);
  };
  return (
    <>
      <p className="rise-in" style={at(0)}>
        <button type="button" onClick={() => pick(best)} className="pressable text-left font-semibold">
          {best.name}
        </button>
        , about {mins(best.minutes)} min {mode}, on roads the model keeps open at {when}.
      </p>
      {reply.note && <p className="rise-in mt-1.5 text-subhead font-medium text-late">{reply.note}</p>}
      {others.length > 0 && (
        <div className="rise-in mt-2 overflow-hidden rounded-control bg-group" style={at(1)}>
          <p className="px-3 pt-2 text-footnote text-label-2">Other open routes</p>
          {others.map((o, i) => (
            <button
              key={`${o.name}-${i}`}
              type="button"
              onClick={() => pick(o)}
              className={`rise-in pressable flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left active:bg-fill ${i < others.length - 1 ? "border-b border-separator" : ""}`}
              style={at(i + 2)}
            >
              <span className="min-w-0 truncate text-subhead text-label">{o.name}</span>
              <span className="shrink-0 text-subhead text-label-2">about {mins(o.minutes)} min</span>
            </button>
          ))}
        </div>
      )}
      <OpenInMaps key={chosen.name + chosen.minutes} to={chosen.name} line={chosen.line} vehicle={mode === "on foot" ? "foot" : "car"} />
      {/* The warning arrives with the route, never after it. */}
      <p className="rise-in mt-1.5 text-footnote text-label-2" style={at(0)}>
        {SAFETY_LINE}
      </p>
    </>
  );
}
