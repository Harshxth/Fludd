"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { StepIllustration } from "@/components/illustrations";
import { AddressSearch } from "@/components/report-card/address-search";
import { notCoveredText, useCoveredPlaces } from "@/components/report-card/not-covered";
import { TourButton } from "./tour-button";
import { LogoMark, WORDMARK_CLASS } from "@/components/ui/logo";
import { motion, useReducedMotion } from "motion/react";
import {
  currentPosition,
  EMPTY_PROFILE,
  saveProfile,
  useProfile,
  type DriveHabit,
  type Vehicle,
  type FloodCover,
  type HomeType,
  type Profile,
  type Tenure,
} from "./profile";
import "./onboarding-screen.css";

type ScreenId =
  | "welcome" | "tenure" | "type" | "floor" | "address" | "park" | "drive"
  | "flood" | "contents" | "policy" | "camera" | "done";

/** The screens this person sees, in order. Follow-up questions appear only when an earlier answer calls for them. */
function screensFor(p: Profile): ScreenId[] {
  const s: ScreenId[] = ["welcome", "tenure", "type"];
  if (p.housing.type === "apartment" || p.housing.type === "condo") s.push("floor");
  s.push("address", "park");
  if (p.drives !== "no_car") s.push("drive");
  s.push("flood");
  if (p.housing.tenure === "rent") s.push("contents");
  s.push("policy");
  if (p.housing.tenure === "own" && (p.housing.type === "house" || p.housing.type === "townhouse")) s.push("camera");
  s.push("done");
  return s;
}

const TENURE: { key: Tenure; label: string }[] = [
  { key: "own", label: "I own my home" },
  { key: "rent", label: "I rent" },
];
const HOME_TYPES: { key: HomeType; label: string }[] = [
  { key: "house", label: "House" },
  { key: "apartment", label: "Apartment" },
  { key: "condo", label: "Condo" },
  { key: "townhouse", label: "Townhouse" },
  { key: "mobile_home", label: "Mobile home" },
];
const FLOORS: { key: number; label: string }[] = [
  { key: 1, label: "Ground floor" },
  { key: 2, label: "2nd floor" },
  { key: 3, label: "3rd floor" },
  { key: 4, label: "4th floor or higher" },
];
const VEHICLES: { key: Vehicle; label: string; hint: string }[] = [
  { key: "car", label: "Car or minivan", hint: "Sits low: about 6 in of water can stall it" },
  { key: "suv", label: "SUV or pickup truck", hint: "Higher: we close roads for it at about 12 in" },
];
const DRIVES: { key: DriveHabit; label: string; hint: string }[] = [
  { key: "daily", label: "Every day", hint: "We'll warn you early, before the roads close" },
  { key: "weekly", label: "A few times a week", hint: "We'll tell you when to move the car" },
  { key: "rarely", label: "Rarely", hint: "Your car mostly sits, so where it's parked matters most" },
];
const FLOOD: { key: FloodCover; label: string }[] = [
  { key: "nfip", label: "Yes, through the NFIP" },
  { key: "private", label: "Yes, a private policy" },
  { key: "none", label: "No" },
  { key: "unsure", label: "Not sure" },
];
const YES_NO: { key: "yes" | "no"; label: string }[] = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

/** Place in the step's entrance stagger: picture 0, heading 1, helper text 2, answers 3, buttons 4. */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

const FLOOD_WORDS: Record<FloodCover, string> = {
  nfip: "Flood policy through the NFIP",
  private: "Private flood policy",
  none: "No flood policy",
  unsure: "Not sure about flood cover",
};

/** Full-screen first-run flow. One question per screen, every screen skippable, everything stays on this device. */
export function OnboardingScreen({ onFinish }: { onFinish: () => void }) {
  const p = useProfile() ?? EMPTY_PROFILE;
  const covered = useCoveredPlaces();
  const [current, setCurrent] = useState<ScreenId>("welcome");
  const [history, setHistory] = useState<ScreenId[]>([]);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const screens = screensFor(p);
  const index = Math.max(0, screens.indexOf(current));
  const progress = index / (screens.length - 1);

  useEffect(() => {
    if (current !== "welcome") headingRef.current?.focus({ preventScroll: true });
  }, [current]);

  /** Advance from the current screen; `after` is the profile as it will be once pending saves land. */
  function next(after: Profile = p) {
    const list = screensFor(after);
    const i = list.indexOf(current);
    const to = list[Math.min(list.length - 1, i + 1)];
    setError(null);
    setNudging(false);
    setDir("forward");
    setHistory((h) => [...h, current]);
    setCurrent(to);
  }
  function back() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setError(null);
    setNudging(false);
    setDir("back");
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev);
  }
  function finish() {
    saveProfile({ done: true });
    onFinish();
  }
  function save(patch: Partial<Profile>): Profile {
    saveProfile(patch);
    return { ...p, ...patch };
  }

  async function atMyCar() {
    setLocating(true);
    setError(null);
    try {
      const position = await currentPosition();
      next(save({ car: { label: "Where you parked", position }, drives: p.drives === "no_car" ? null : p.drives }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't get your location.");
    } finally {
      setLocating(false);
    }
  }

  const heading = (text: string, entrance: "rise-in" | "pop-in" = "rise-in") => (
    <h1
      id={titleId}
      ref={headingRef}
      tabIndex={-1}
      style={at(1)}
      className={`${entrance} origin-center text-center text-[2rem] font-bold leading-[1.12] tracking-[-0.025em] text-balance outline-none`}
    >
      {text}
    </h1>
  );
  const lede = (text: ReactNode) => <p style={at(2)} className="rise-in mx-auto mt-3 max-w-[34ch] text-center text-body text-label-2 text-balance">{text}</p>;
  /** The answer block shakes once when Continue is pressed while it is still switched off. */
  const answer = { nudging, onNudgeEnd: () => setNudging(false) };

  let body: ReactNode = null;
  let footer: ReactNode = null;
  const continueBtn = (enabled: boolean, label = "Continue") => (
    <div onPointerDown={enabled ? undefined : () => setNudging(true)}>
      <Primary onClick={() => next()} disabled={!enabled}>{label}</Primary>
    </div>
  );

  switch (current) {
    case "welcome":
      body = (
        // Full-bleed hero: cancels the screen's side padding and header so the navy reaches the edges and the top.
        <div className="-mx-6 -mt-[calc(max(0.5rem,env(safe-area-inset-top))+2.75rem)] flex flex-1 flex-col text-center">
          <div
            className="relative flex min-h-[40dvh] flex-col items-center justify-center overflow-hidden pb-12 pt-[calc(max(0.5rem,env(safe-area-inset-top))+1.5rem)]"
            style={{ background: "radial-gradient(120% 80% at 50% 25%, #3a68ad 0%, #23467f 55%, #182f57 100%)" }}
          >
            <WelcomeRain />
            {/* The mark on its paper tile, like the app icon: the navy wave needs the cream behind it. */}
            <div
              style={at(0)}
              className="pop-in relative grid size-[8.5rem] place-items-center rounded-[2.25rem] bg-[#fbfaf6] shadow-[0_20px_40px_rgb(0_0_0/0.35),inset_0_-3px_0_rgb(0_0_0/0.06)]"
            >
              <LogoMark size={112} />
            </div>
            <TourButton />
            <svg className="absolute inset-x-0 -bottom-px h-12 w-full" viewBox="0 0 400 48" preserveAspectRatio="none" aria-hidden>
              <path d="M0 22 C60 6 120 6 180 20 S300 40 400 16 V48 H0 Z" fill="#5b8fd6" opacity="0.55" />
              <path d="M0 30 C70 16 140 18 200 30 S320 46 400 26 V48 H0 Z" fill="oklch(0.975 0.004 260)" />
            </svg>
          </div>

          <div className="flex flex-1 flex-col items-center px-6 pt-2">
            <p translate="no" style={at(1)} className={`rise-in ${WORDMARK_CLASS} text-[2.75rem] leading-none tracking-[-0.03em]`}>Fludd</p>
            <h1 id={titleId} style={at(2)} className="rise-in mt-2 text-[1.375rem] font-semibold leading-[1.2] tracking-[-0.02em] text-balance">
              Know what the water will do before it does.
            </h1>
            <ul style={at(3)} className="rise-in mt-4 w-full max-w-[22rem] space-y-2 text-left">
              {[
                ["A flood grade for any home in Tampa", "before you rent, buy or move"],
                ["Water on your street, hour by hour", "and when to move your car"],
                ["Routes around flooded roads", "plus food, shelter and help nearby"],
              ].map(([title, detail]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-tint" aria-hidden />
                  <span className="text-subhead leading-snug">
                    <span className="font-semibold">{title}</span> <span className="text-label-2">{detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p style={at(3)} className="rise-in mt-3 text-footnote text-label-3">Setup takes a minute. Everything stays on this device.</p>
          </div>
        </div>
      );
      footer = (
        <>
          <Primary onClick={() => next()}>Get started</Primary>
          <Secondary onClick={finish}>I&apos;ll look around first</Secondary>
        </>
      );
      break;

    case "tenure":
      body = (
        <>
          {heading("Do you own or rent?")}
          {lede("Owners and renters protect different things in a flood.")}
          <Choices
            {...answer}
            labelledBy={titleId}
            options={TENURE}
            value={p.housing.tenure}
            onPick={(tenure) => save({ housing: { ...p.housing, tenure } })}
          />
        </>
      );
      footer = continueBtn(p.housing.tenure !== null);
      break;

    case "type":
      body = (
        <>
          {heading("What kind of home?")}
          <Choices
            {...answer}
            labelledBy={titleId}
            options={HOME_TYPES}
            value={p.housing.type}
            onPick={(type) =>
              save({ housing: { ...p.housing, type, floor: type === "apartment" || type === "condo" ? p.housing.floor : null } })
            }
          />
        </>
      );
      footer = continueBtn(p.housing.type !== null);
      break;

    case "floor":
      body = (
        <>
          {heading("Which floor do you live on?")}
          {lede("Water reaches the ground floor first. Higher up, your car and your way out matter most.")}
          <Choices
            {...answer}
            labelledBy={titleId}
            options={FLOORS}
            value={p.housing.floor === null ? null : Math.min(4, p.housing.floor)}
            onPick={(floor) => save({ housing: { ...p.housing, floor } })}
          />
        </>
      );
      footer = continueBtn(p.housing.floor !== null);
      break;

    case "address":
      body = (
        <>
          {heading("Where do you live?")}
          {lede("Your home gets a flood grade, and we watch the water around it.")}
          <div style={at(3)} className="rise-in mt-6">
            <Nudge {...answer}>
              <AddressSearch
                onPick={(match, err) => {
                  if (err || !match) return setError(err ?? "We couldn't find that address. Try the street number and name.");
                  if (!match.inside) return setError(notCoveredText(match.label, covered));
                  next(save({ home: { label: match.label, position: match.position } }));
                }}
              />
            </Nudge>
          </div>
          {p.home && (
            <p style={at(4)} className="rise-in mt-4 text-subhead text-label-2">
              Saved: <span className="text-label">{p.home.label}</span>
            </p>
          )}
        </>
      );
      footer = continueBtn(p.home !== null);
      break;

    case "park":
      body = (
        <>
          {heading("Where do you park?")}
          {lede("Go stand next to your car, then tap. We'll tell you when to move it before the water gets there.")}
          {p.car && (
            <p style={at(3)} className="rise-in mt-4 text-subhead text-label-2">
              Saved: <span className="text-label">{p.car.label}</span>
            </p>
          )}
        </>
      );
      footer = (
        <>
          <Primary onClick={atMyCar} disabled={locating}>{locating ? "Finding you…" : "I'm at my car"}</Primary>
          {p.home && (
            <Secondary
              onClick={() => {
                if (p.home) next(save({ car: { label: "At home", position: p.home.position }, drives: p.drives === "no_car" ? null : p.drives }));
              }}
            >
              I park at home
            </Secondary>
          )}
          <Secondary onClick={() => next(save({ car: null, drives: "no_car" }))}>I don&apos;t have a car</Secondary>
        </>
      );
      break;

    case "drive":
      body = (
        <>
          {heading("How often do you drive?")}
          <Choices {...answer} labelledBy={titleId} options={DRIVES} value={p.drives} onPick={(drives) => save({ drives })} />
          {/* Ground clearance decides which flooded roads are closed to you, so the routes and "last way out" use it. */}
          <h2 id={`${titleId}-vehicle`} className="rise-in mt-6 px-1 text-headline font-semibold">What do you drive?</h2>
          <div className="mt-2">
            <Choices {...answer} labelledBy={`${titleId}-vehicle`} options={VEHICLES} value={p.vehicle} onPick={(vehicle) => save({ vehicle })} />
          </div>
        </>
      );
      footer = continueBtn(p.drives !== null && p.vehicle !== null);
      break;

    case "flood":
      body = (
        <>
          {heading("Do you have flood insurance?")}
          {lede("Standard home and renters policies don't cover flood damage. It's a separate policy.")}
          <Choices
            {...answer}
            labelledBy={titleId}
            options={FLOOD}
            value={p.insurance.flood}
            onPick={(flood) => save({ insurance: { ...p.insurance, flood } })}
          />
        </>
      );
      footer = continueBtn(p.insurance.flood !== null);
      break;

    case "contents":
      body = (
        <>
          {heading("Do you have renters insurance?")}
          {lede("Renters (contents) insurance covers your belongings, not the building.")}
          <Choices
            {...answer}
            labelledBy={titleId}
            options={YES_NO}
            value={p.insurance.contents === null ? null : p.insurance.contents ? "yes" : "no"}
            onPick={(v) => save({ insurance: { ...p.insurance, contents: v === "yes" } })}
          />
        </>
      );
      footer = continueBtn(p.insurance.contents !== null);
      break;

    case "policy":
      body = (
        <>
          {heading("Save your policy for a flood day")}
          {lede("Saved on this device only. Handy when you need to file a claim.")}
          <div style={at(3)} className="rise-in mt-6 overflow-hidden rounded-[var(--radius-group)] bg-group">
            <Field label="Insurance company" value={p.insurance.carrier} onChange={(carrier) => save({ insurance: { ...p.insurance, carrier } })} />
            <Field label="Policy number" value={p.insurance.policyNumber} onChange={(policyNumber) => save({ insurance: { ...p.insurance, policyNumber } })} />
            <Field label="Renewal date" type="date" value={p.insurance.renewal} onChange={(renewal) => save({ insurance: { ...p.insurance, renewal } })} last />
          </div>
          <p style={at(4)} className="rise-in mt-3 px-1 text-footnote text-label-3">Optional. You can leave these blank.</p>
        </>
      );
      footer = continueBtn(true);
      break;

    case "camera":
      body = (
        <>
          {heading("Have a spare phone?")}
          {lede(
            "Completely optional. Prop an old phone in a window facing the street and Fludd can check how deep the water is during a storm, one still photo at a time. Nothing is recorded, and you set it up later under You.",
          )}
          <div style={at(3)} className="rise-in mt-6 overflow-hidden rounded-[var(--radius-group)] bg-group">
            <label className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
              <span className="text-body">I&apos;d like a flood camera</span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={p.camera.optIn}
                aria-checked={p.camera.optIn}
                onChange={(e) => save({ camera: { optIn: e.target.checked, snapshotUrl: "" } })}
              />
            </label>
          </div>
        </>
      );
      footer = continueBtn(true);
      break;

    case "done":
      body = (
        <>
          {heading("You're set.", "pop-in")}
          {lede("Here's what Fludd saved on this device. You can change it any time.")}
          <dl style={at(3)} className="rise-in mt-6 overflow-hidden rounded-[var(--radius-group)] bg-group">
            <Summary label="Home" value={p.home?.label ?? "Not set"} />
            <Summary label="Car" value={p.drives === "no_car" ? "No car" : (p.car?.label ?? "Not set")} />
            <Summary
              label="Insurance"
              value={p.insurance.flood ? FLOOD_WORDS[p.insurance.flood] : "Not set"}
              detail={p.insurance.carrier ? [p.insurance.carrier, p.insurance.policyNumber].filter(Boolean).join(", ") : undefined}
              last
            />
          </dl>
        </>
      );
      footer = <Primary onClick={finish}>Show me my home</Primary>;
      break;
  }

  const showChrome = current !== "welcome";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="ob-layer fixed inset-0 z-40 flex flex-col overflow-y-auto text-label
        pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]
        pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-6">
        <header className="flex h-11 shrink-0 items-center gap-3">
          <div className="w-11 shrink-0">
            {showChrome && history.length > 0 && (
              <button
                type="button"
                onClick={back}
                aria-label="Back"
                className="pressable -ml-3 grid size-11 place-items-center rounded-full text-tint active:bg-fill"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m15 5-7 7 7 7" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex-1">
            {showChrome && (
              <div
                className="ob-progress h-1 overflow-hidden rounded-full bg-fill"
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={0}
                aria-valuemax={screens.length - 1}
                aria-valuenow={index}
              >
                <span className="block h-full rounded-full bg-tint" style={{ transform: `scaleX(${progress.toFixed(4)})` }} />
              </div>
            )}
          </div>
          <div className="flex w-11 shrink-0 justify-end">
            {showChrome && current !== "done" && (
              <button type="button" onClick={() => next()} className="pressable -mr-2 min-h-11 rounded-[0.625rem] px-2 text-body text-label-2 active:bg-fill">
                Skip
              </button>
            )}
          </div>
        </header>

        <main key={current} className={`flex flex-1 flex-col ${dir === "forward" ? "ob-forward" : "ob-back"}`}>
          <div className={`flex flex-1 flex-col ${current === "welcome" ? "" : "pt-10"}`}>
            {current !== "welcome" && (
              <div style={at(0)} className="rise-in mb-5 flex self-center">
                <StepIllustration step={current} size={132} />
              </div>
            )}
            {body}
            {error && (
              <p role="alert" className="rise-in mt-4 rounded-[var(--radius-control)] bg-group px-4 py-3 text-subhead">
                {error}
              </p>
            )}
          </div>
          <div style={at(4)} className="rise-in mt-8 flex shrink-0 flex-col gap-1">{footer}</div>
        </main>
      </div>
    </div>
  );
}

function Primary({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pressable ob-primary h-[3.25rem] w-full rounded-[0.875rem] bg-tint text-body font-semibold text-white active:bg-tint-pressed disabled:bg-fill disabled:text-label-3"
    >
      {children}
    </button>
  );
}

function Secondary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="pressable min-h-12 w-full rounded-[0.875rem] text-body font-medium text-tint active:bg-fill">
      {children}
    </button>
  );
}

/** Shakes its content once while `nudging` is on, then reports back so the next refusal can shake again. */
function Nudge({ nudging, onNudgeEnd, children }: { nudging: boolean; onNudgeEnd: () => void; children: ReactNode }) {
  return (
    <div
      className={nudging ? "nudge" : undefined}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onNudgeEnd();
      }}
    >
      {children}
    </div>
  );
}

function Choices<K extends string | number>({
  options, value, onPick, labelledBy, nudging, onNudgeEnd,
}: {
  options: { key: K; label: string; hint?: string }[];
  value: K | null;
  onPick: (k: K) => void;
  labelledBy: string;
  nudging: boolean;
  onNudgeEnd: () => void;
}) {
  return (
    <div style={at(3)} className="rise-in mt-7">
      <Nudge nudging={nudging} onNudgeEnd={onNudgeEnd}>
        <div role="radiogroup" aria-labelledby={labelledBy} className="overflow-hidden rounded-[var(--radius-group)] bg-group">
          {options.map((o) => {
            const on = value === o.key;
            return (
              <button
                key={String(o.key)}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(o.key)}
                className="pressable ob-option flex min-h-14 w-full items-center gap-3 border-b border-separator px-4 py-3 text-left last:border-b-0 active:bg-fill"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{o.label}</span>
                  {o.hint && <span className="block text-footnote text-label-2">{o.hint}</span>}
                </span>
                {/* The ring stays put; the filled tick is always mounted so it can scale in and out. */}
                <span
                  aria-hidden
                  className={`relative size-6 shrink-0 rounded-full border-[1.5px] transition-colors duration-150 ${on ? "border-transparent" : "border-label-3/60"}`}
                >
                  <span className={`ob-check absolute -inset-[1.5px] grid place-items-center rounded-full bg-tint text-white ${on ? "ob-check-on" : ""}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Nudge>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", hint, last,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "url";
  hint?: string;
  last?: boolean;
}) {
  const id = useId();
  return (
    <div className={`px-4 py-2.5 ${last ? "" : "border-b border-separator"}`}>
      <label htmlFor={id} className="block text-footnote font-medium text-label-2">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 h-9 w-full bg-transparent text-body text-label outline-none placeholder:text-label-3 focus-visible:underline"
      />
      {hint && <p id={`${id}-hint`} className="text-footnote text-label-3">{hint}</p>}
    </div>
  );
}

function Summary({ label, value, detail, last }: { label: string; value: string; detail?: string; last?: boolean }) {
  return (
    <div className={`px-4 py-3 ${last ? "" : "border-b border-separator"}`}>
      <dt className="text-footnote text-label-2">{label}</dt>
      <dd className="text-body">{value}</dd>
      {detail && <dd className="text-footnote text-label-2">{detail}</dd>}
    </div>
  );
}

/** Light rain over the welcome hero: thin streaks falling on a loop. Still for people who reduce motion. */
function WelcomeRain() {
  const reduce = useReducedMotion();
  const drops = Array.from({ length: 26 }, (_, i) => ({ x: (i * 37) % 400, y: (i * 53) % 300, len: 10 + ((i * 7) % 10) }));
  return (
    <motion.svg
      className="pointer-events-none absolute inset-0 h-[130%] w-full opacity-35"
      viewBox="0 0 400 300"
      preserveAspectRatio="none"
      aria-hidden
      initial={{ y: "-23%" }}
      animate={reduce ? undefined : { y: "0%" }}
      transition={{ duration: 1.8, ease: "linear", repeat: Infinity }}
    >
      {drops.map((d, i) => (
        <line key={i} x1={d.x} y1={d.y} x2={d.x - 3} y2={d.y + d.len} stroke="#cfe2ff" strokeWidth="1.4" strokeLinecap="round" />
      ))}
    </motion.svg>
  );
}
