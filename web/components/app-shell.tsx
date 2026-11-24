"use client";

import { useCallback, useEffect, useState } from "react";
import { onBootDone } from "@/components/boot/boot-signal";
import { FloodCamera } from "@/components/camera/flood-camera";
import { EmptyAddressIllustration } from "@/components/illustrations";
import { MapView, RAMP } from "@/components/map/map-view";
import { fetchGauges, type Gauge } from "@/components/map/gauges";
import { StormControls } from "@/components/map/storm-controls";
import { OnboardingScreen } from "@/components/onboarding/onboarding-screen";
import { forgetProfile, saveProfile, useProfile } from "@/components/onboarding/profile";
import { AskPelican } from "@/components/pelican/ask-pelican";
import { recordContribution } from "@/components/rewards/contributions";
import { RewardsPanel } from "@/components/rewards/rewards-panel";
import { AddressSearch } from "@/components/report-card/address-search";
import { notCoveredText, useCoveredPlaces } from "@/components/report-card/not-covered";
import { ValidationPanel } from "@/components/report-card/validation-panel";
import { AfterPanel } from "@/components/stages/after-panel";
import { BeforePanel } from "@/components/stages/before-panel";
import { DuringPanel } from "@/components/stages/during-panel";
import { Icon, ListRow, type Place } from "@/components/stages/shared";
import { STAGES, StageControl, type Stage } from "@/components/stages/stage-control";
import { motion, useReducedMotion } from "motion/react";
import { PEEK_PX, SHEET_HALF_EVENT, Sheet, useNarrow } from "@/components/ui/sheet";
import { Logo, LogoMark, PelicanMark } from "@/components/ui/logo";
import { STORM_WORDS } from "@/components/ui/storm-words";
import { clockLabel } from "@/components/map/storm-controls";
import { depthAtBuilding } from "@/lib/data";
import { WeatherCard, WeatherChip } from "@/components/weather/weather-card";
import { HelpPanel } from "@/components/help/help-panel";
import { WeeklyHighlight } from "@/components/help/weekly-highlight";
import { Group } from "@/components/ui/surface";
import { ICONS, Shortcuts, type Tab } from "@/components/ui/tab-bar";
import { loadGold } from "@/lib/data";
import { reverseGeocode } from "@/lib/address";
import { gradeFor } from "@/lib/grade";
import type { AddressMatch, GradeResult, Hour, LayerName, LngLat, Manifest, PumpState, Scenario } from "@/lib/types";

// Wording from prep/04-depth-model-and-routing.md section 5.3. Shown on every card.
const SAFETY_FOOTNOTE =
  "Screening estimate from a simplified model. It leaves out storm sewers, storm surge, river flooding and groundwater, and is checked against one storm. Not a FEMA flood determination, and not for insurance, lending or purchase decisions. In a storm, follow Hillsborough County Emergency Management and the National Weather Service. Never drive or walk into floodwater.";

// ponytail: hourZeroByScenario is in the real manifest but not yet in the Manifest type (note left for Hansika).
type ManifestWithClocks = Manifest & { hourZeroByScenario?: Partial<Record<Scenario, string>> };

/** Drainage network layers shown by the map's Drainage button. */
const DRAINAGE: LayerName[] = ["storm-pipes", "ponds", "drains", "outfalls", "pump-stations"];

/** Where each stage card sits across the row: the reveal circle grows from there. */
const STAGE_X: Record<Stage, string> = { before: "17%", during: "50%", after: "83%" };

const LETTER_BG: Record<string, string> = { A: "bg-safe", B: "bg-safe", C: "bg-warn", D: "bg-late", F: "bg-late" };

/** Weather for the USF area until an address is chosen. */
const USF_AREA: LngLat = [-82.4139, 28.0587];

/** Longest the map waits for the boot intro before flying in anyway. */
const INTRO_FALLBACK_MS = 6000;

const COVER_WORDS: Record<string, string> = {
  nfip: "Flood insurance through the NFIP",
  private: "A private flood policy",
  none: "No flood insurance",
  unsure: "Not sure about flood insurance",
};

const TITLES: Record<Tab, string> = { home: "Home", live: "Live", ask: "Ask Pelican", help: "Food & help", rewards: "Your impact", weather: "Weather", you: "You" };

type Graded = { place: Place; grade: GradeResult };

export function AppShell() {
  const covered = useCoveredPlaces();
  const profile = useProfile();
  const [tab, setTab] = useState<Tab>("home");
  const [stage, setStage] = useState<Stage>("before");
  // Live is the default: no flood is happening, so the map shows real feeds; the stages play a simulated storm.
  const [live, setLive] = useState(true);
  const [gauges, setGauges] = useState<Gauge[] | null>(null);
  const [alerts, setAlerts] = useState<string[] | null>(null);
  const narrow = useNarrow();
  const reduceMotion = useReducedMotion();
  const [scenario, setScenario] = useState<Scenario>("100yr");
  const [pump, setPump] = useState<PumpState>("on");
  const [hour, setHour] = useState<Hour>(14);
  const [manifest, setManifest] = useState<ManifestWithClocks | null>(null);
  const [searched, setSearched] = useState<Place | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    let stale = false;
    const load = () => fetchGauges().then((g) => !stale && setGauges(g), () => !stale && setGauges([]));
    void load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => {
      stale = true;
      window.clearInterval(t);
    };
  }, []);
  // Phones: the floating search and chips own the top edge, so the map's locate button moves below them.
  useEffect(() => {
    const ctrl = document.querySelector<HTMLElement>(".maplibregl-ctrl-top-right");
    if (ctrl) ctrl.style.top = narrow ? "calc(env(safe-area-inset-top) + 6.5rem)" : "";
  }, [narrow, arrived]);
  const [drainage, setDrainage] = useState(false);
  const [route, setRoute] = useState<LngLat[] | null>(null);
  const onError = useCallback((m: string) => setError(m), []);

  // The flood data loads once the intro is out of the way, so parsing it never freezes the intro film.
  useEffect(() => {
    if (!arrived) return;
    loadGold().then((g) => setManifest(g.manifest), (e: unknown) => onError(e instanceof Error ? e.message : "The flood data failed to load"));
  }, [arrived, onError]);

  // The intro hands over (or was never shown); never wait longer than the fallback.
  useEffect(() => {
    const go = () => setArrived(true);
    const off = onBootDone(go);
    const t = setTimeout(go, INTRO_FALLBACK_MS);
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);

  // The place on the card: what was searched, else the saved home.
  const place: Place | null = searched ?? profile?.home ?? null;
  const placeKey = place ? place.position.join(",") : null;

  useEffect(() => {
    if (!place || !arrived) return;
    let stale = false;
    gradeFor(place.position).then(
      (grade) => !stale && setGraded({ place, grade }),
      (e: unknown) => !stale && setError(e instanceof Error ? e.message : "The grade failed to load"),
    );
    return () => {
      stale = true;
    };
    // placeKey stands for place: a new object with the same position needs no new grade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, arrived]);

  function onPick(match: AddressMatch | null, err?: string) {
    setError(null);
    if (err) return setError(err);
    if (!match) return setError("We couldn't find that address. Try the street number and name.");
    setSearched({ label: match.label, position: match.position });
    setRoute(null);
  }

  // A tap on the map: that building becomes the place on the card, named by its street address when there is one.
  async function selectSpot(position: LngLat) {
    setError(null);
    setRoute(null);
    setTab("home");
    window.dispatchEvent(new Event(SHEET_HALF_EVENT));
    const label = await Promise.race([
      reverseGeocode(position).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
    setSearched({ label: label ?? "Selected building", position });
  }

  // The live meter: water at the place on the card for the storm and hour on the map.
  const [meter, setMeter] = useState<{ key: string; depthM: number | null } | null>(null);
  const meterKey = place ? `${placeKey}|${scenario}|${pump}|${hour}` : null;
  useEffect(() => {
    if (!place || !arrived || !meterKey) return;
    let stale = false;
    depthAtBuilding(place.position, scenario, pump, hour).then(
      (r) => !stale && setMeter({ key: meterKey, depthM: r.kind === "ok" ? r.depthM : null }),
      () => !stale && setMeter({ key: meterKey, depthM: null }),
    );
    return () => {
      stale = true;
    };
    // meterKey stands for place, scenario, pump and hour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meterKey, arrived]);

  // Weather Service alerts for the place on the card (or USF), for the live view and the meter.
  const alertAt = (place?.position ?? USF_AREA).join(",");
  useEffect(() => {
    let stale = false;
    const [lng, lat] = alertAt.split(",");
    fetch(`/api/weather?lat=${lat}&lng=${lng}`)
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((j: { alerts?: { event: string }[] }) => !stale && setAlerts([...new Set((j.alerts ?? []).map((a) => a.event))]))
      .catch(() => !stale && setAlerts([]));
    return () => {
      stale = true;
    };
  }, [alertAt]);

  const hours = manifest?.hours ?? 48;
  const safeHour = Math.min(hour, hours - 1);
  const hourZero = manifest?.hourZeroByScenario?.[scenario] ?? manifest?.hourZero ?? null;
  const current = graded && place && graded.place.position.join(",") === placeKey ? graded : null;
  const ok = current?.grade.kind === "ok" ? { place: current.place, grade: current.grade } : null;
  const onboarding = profile !== null && !profile.done;
  const controls = {
    scenario, pump, hour: safeHour, hours, hourZero,
    // A suggested route belongs to one storm, pump state and hour: drop it when they change.
    onScenario: (s: Scenario) => { setScenario(s); setRoute(null); },
    onPump: (p: PumpState) => { setPump(p); setRoute(null); },
    onHour: (h: Hour) => { setHour(h); setRoute(null); },
  };

  const placeState = (
    <>
      {error && (
        <Group>
          <p role="alert" className="px-4 py-3 text-subhead">{error}</p>
        </Group>
      )}
      {!place && (
        <Group>
          <div className="flex flex-col items-center px-4 py-5 text-center">
            <EmptyAddressIllustration size={120} className="mb-3" />
            <p className="text-headline font-semibold">No address yet</p>
            <p className="mt-1 text-subhead text-label-2">Search for one, or set up your home.</p>
            {profile && !profile.home && (
              <button type="button" onClick={() => saveProfile({ done: false })} className="mt-3 min-h-11 text-subhead font-medium text-tint">
                Set up your home
              </button>
            )}
          </div>
        </Group>
      )}
      {place && !current && (
        <Group>
          <p className="px-4 py-5 text-center text-subhead text-label-2">Checking {place.label.split(",")[0]}…</p>
        </Group>
      )}
      {current?.grade.kind === "outside" && (
        <Group>
          <div className="px-4 py-4">
            <p className="text-headline font-semibold">Not covered yet</p>
            <p className="mt-1 text-subhead text-label-2">
              {notCoveredText(current.place.label, covered)}
            </p>
          </div>
        </Group>
      )}
    </>
  );

  // Home shows your home again: drop a searched address if there is a home to go back to.
  // Before, during and after a flood at one address. The stage sets the map too: After replays Milton at its peak.
  const pickStage = (s: Stage) => {
    setStage(s);
    setRoute(null);
    if (s === "after") {
      setScenario("milton");
      setPump("on");
      setHour(24);
    } else if (scenario === "milton" && s === "before") setScenario("100yr");
  };
  // Phone chips: show one stage of the place's report, keeping whatever place is on the card.
  const showStage = (s: Stage) => {
    window.dispatchEvent(new Event(SHEET_HALF_EVENT));
    setTab("home");
    setLive(false);
    pickStage(s);
  };
  const showLive = () => {
    window.dispatchEvent(new Event(SHEET_HALF_EVENT));
    setTab("home");
    setRoute(null);
    setLive(true);
  };
  const open = (t: Tab) => {
    // Every shortcut shows its content: raise the sheet off peek.
    window.dispatchEvent(new Event(SHEET_HALF_EVENT));
    // Live is the During stage of Home.
    if (t === "live") {
      setTab("home");
      pickStage("during");
      return;
    }
    if (t === "home") {
      if (profile?.home) setSearched(null);
      setStage("before");
    }
    setTab(t);
  };

  // Maps-style: a search field with your avatar, round shortcuts under it; a section opens as a card with a close button.
  const letter = ok?.grade.letter ?? null;
  const section =
    tab === "home" && narrow ? (
      // Phone, like Google Maps: search and chips float at the top; the resting sheet is one line and the weather.
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(SHEET_HALF_EVENT))}
        className="flex w-full items-center gap-3 px-4 pb-3 text-left"
      >
        {letter && (
          <span className={`grid size-10 shrink-0 place-items-center rounded-full text-headline font-bold text-white ${LETTER_BG[letter] ?? "bg-late"}`}>
            {letter}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-headline font-semibold">{place ? (ok ? `Flood grade ${letter}` : "Checking this place…") : "Explore Tampa"}</span>
          <span className="block truncate text-subhead text-label-2">{place ? place.label.split(",")[0] : "Search a place, or tap any building"}</span>
        </span>
        <WeatherChip position={place?.position ?? USF_AREA} />
      </button>
    ) : tab === "home" ? (
      <>
        <div className="flex items-start gap-2 px-4">
          <div className="min-w-0 flex-1">
            <AddressSearch onPick={onPick} />
          </div>
          <button
            type="button"
            aria-label="You"
            onClick={() => open("you")}
            className="pressable mt-3 grid size-11 shrink-0 place-items-center rounded-full bg-fill text-tint"
          >
            {ICONS.you}
          </button>
        </div>
        <Shortcuts tab={tab === "home" && stage === "during" ? "live" : tab} onOpen={open} homeLetter={!searched && ok ? ok.grade.letter : null} />
      </>
    ) : (
      <div className="flex items-center justify-between gap-3 pb-2 pl-5 pr-2 pt-1">
        <h1 className="text-title font-bold">{TITLES[tab]}</h1>
        <button type="button" aria-label="Close" onClick={() => open("home")} className="pressable grid size-11 place-items-center">
          <span className="grid size-[1.875rem] place-items-center rounded-full bg-fill text-label-2" aria-hidden>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m2 2 8 8M10 2l-8 8" />
            </svg>
          </span>
        </button>
      </div>
    );
  // Wide screens: the brand sits at the top of the sidebar. Phones keep it as a chip on the map.
  const header = (
    <>
      <p translate="no" className="hidden px-5 pb-1 pt-2 md:block">
        <Logo size={26} />
      </p>
      {section}
    </>
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/* Phone: floating search with the mark and your avatar, chips underneath, like Google Maps. */}
      <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 md:hidden">
        <div className="material-glass relative z-10 flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 shadow-[0_4px_16px_rgb(0_0_0/0.14)]">
          <LogoMark size={26} />
          <div className="min-w-0 flex-1">
            <AddressSearch onPick={onPick} floating />
          </div>
          <button type="button" aria-label="You" onClick={() => open("you")} className="pressable grid size-10 shrink-0 place-items-center rounded-full bg-fill text-tint">
            {ICONS.you}
          </button>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {[
            { label: "Now", on: tab === "home" && live, act: showLive, icon: null },
            { label: "Plan a move", on: tab === "home" && !live && stage === "before", act: () => showStage("before"), icon: STAGES[0].icon },
            { label: "Storm mode", on: tab === "home" && !live && stage === "during", act: () => showStage("during"), icon: STAGES[1].icon },
            { label: "After a flood", on: tab === "home" && !live && stage === "after", act: () => showStage("after"), icon: STAGES[2].icon },
            { label: "Weather", on: tab === "weather", act: () => open("weather"), icon: ICONS.weather },
            { label: "Food & help", on: tab === "help", act: () => open("help"), icon: ICONS.help },
            { label: "Your impact", on: tab === "rewards", act: () => open("rewards"), icon: ICONS.rewards },
            { label: "Drainage", on: drainage, act: () => setDrainage((d) => !d), icon: null },
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={c.on}
              onClick={c.act}
              className={`pressable flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-subhead font-medium shadow-[0_2px_8px_rgb(0_0_0/0.12)] [&_svg]:size-4
                ${c.on ? "bg-tint text-white" : "material-glass text-label"}`}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {/* Key for the floodwater colours: shallow to deep. Lakes stay the basemap's pale blue. */}
      <div
        aria-label="Floodwater depth: 6 inches to over 4 feet"
        role="img"
        className="material-glass pointer-events-none fixed left-3 top-[calc(env(safe-area-inset-top)+3.4rem)] z-10 hidden rounded-[0.75rem] px-2.5 py-1.5 md:left-[412px] md:top-4 md:block"
      >
        <p className="text-[0.6875rem] font-semibold text-label-2">Floodwater</p>
        <div className="mt-1 flex h-2 w-28 overflow-hidden rounded-full">
          {[1, 2, 3, 4, 5].map((k) => (
            <span key={k} className="flex-1" style={{ background: `rgb(${RAMP[k - 1].slice(1).join(" ")})` }} />
          ))}
        </div>
        <div className="mt-0.5 flex w-28 justify-between text-[0.625rem] tabular-nums text-label-2">
          <span>6 in</span>
          <span>2 ft</span>
          <span>4 ft+</span>
        </div>
      </div>
      {/* First open: full-screen onboarding, after the intro has handed over so it never sits under the video. */}
      {arrived && onboarding && (
        <OnboardingScreen
          onFinish={() => {
            setSearched(null);
            recordContribution("onboarded");
          }}
        />
      )}
      <MapView
        scenario={scenario}
        pump={pump}
        hour={safeHour}
        focus={searched?.position ?? profile?.home?.position ?? null}
        pins={{ home: profile?.home?.position ?? null, car: profile?.car?.position ?? null }}
        arrived={arrived}
        overlays={drainage ? DRAINAGE : []}
        water={!live}
        gauges={live ? gauges ?? [] : []}
        route={route}
        onSelect={selectSpot}
        onError={onError}
      />
      <button
        type="button"
        aria-pressed={drainage}
        onClick={() => setDrainage((d) => !d)}
        className={`pressable fixed right-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-10 hidden h-11 rounded-full px-4 text-subhead font-semibold md:block
          ${drainage ? "bg-tint text-white" : "material-glass text-label"}`}
      >
        Drainage
      </button>

      {/* Always on the map, above the resting sheet: the live flood meter (left) and Ask Pelican (right). */}
      {place && (
        <button
          type="button"
          onClick={() => open("live")}
          aria-label="Flood meter: open the storm"
          className="material-glass pressable fixed bottom-[calc(var(--peek)+env(safe-area-inset-bottom)+0.75rem)] left-3 z-10 flex items-center gap-2.5 rounded-[1rem] py-2 pl-2 pr-3 text-left md:bottom-4 md:left-[412px]"
          style={{ ["--peek" as string]: `${PEEK_PX}px` }}
        >
          <MeterBar depthM={live ? 0 : meter?.key === meterKey ? meter.depthM : null} />
          <span>
            <span className="block text-[0.6875rem] font-semibold text-label-2">{place === profile?.home ? "Water at home" : "Water here"}</span>
            <span className="block text-headline font-semibold tabular-nums">
              {live ? (alerts?.length ? "Alert" : "Dry") : meter?.key === meterKey && meter.depthM !== null ? meterWords(meter.depthM) : "…"}
            </span>
            <span className="block text-[0.6875rem] text-label-2">
              {live ? (alerts?.length ? alerts[0] : "Live · no flood alerts") : STORM_WORDS[scenario].short}
              {!live && hourZero ? ` · ${clockLabel(hourZero, safeHour)}` : ""}
            </span>
          </span>
        </button>
      )}
      {/* Pelican floats over everything, sheet included, so it is always one tap away (hidden while it is open). */}
      <button
        type="button"
        hidden={tab === "ask"}
        onClick={() => open("ask")}
        aria-label="Ask Pelican"
        className="pressable fixed bottom-[calc(var(--peek)+env(safe-area-inset-bottom)+0.75rem)] right-3 z-30 grid size-14 place-items-center rounded-full bg-[#fbfaf6] shadow-[0_6px_20px_rgb(0_0_0/0.18)] ring-1 ring-black/5 md:bottom-4 md:right-4"
        style={{ ["--peek" as string]: `${PEEK_PX}px` }}
      >
        <PelicanMark size={40} />
      </button>

      <Sheet header={header} scrollKey={`${tab}-${stage}`} className={arrived ? "surface-arrive surface-shine" : "opacity-0"}>
        <div key={tab} id="tab-panel" role="region" aria-label={TITLES[tab]} className="tab-enter" aria-live="polite">
          {tab === "home" && (
            <>
              {!narrow && (
                <div className="px-4 pt-1">
                  <button
                    type="button"
                    aria-pressed={live}
                    onClick={showLive}
                    className={`pressable mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] text-subhead font-semibold ${live ? "bg-tint text-white" : "bg-group text-label"}`}
                  >
                    <span className={`size-2 rounded-full ${live ? "bg-white" : "bg-safe"}`} aria-hidden />
                    Now: live conditions
                  </button>
                </div>
              )}
              {!narrow && (
                <StageControl
                  stage={stage}
                  onChange={(s) => {
                    setLive(false);
                    pickStage(s);
                  }}
                />
              )}
              {/* Switching stage: the new content opens in a circle from the card that was tapped. */}
              <motion.div
                key={stage}
                id="stage-panel"
                initial={reduceMotion ? false : { clipPath: `circle(0% at ${STAGE_X[stage]} 0%)` }}
                animate={{ clipPath: `circle(150% at ${STAGE_X[stage]} 0%)` }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
              {placeState}
              {live && ok && (
                <Group>
                  <button type="button" onClick={() => showStage("before")} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-full text-headline font-bold text-white ${LETTER_BG[ok.grade.letter] ?? "bg-late"}`}>
                      {ok.grade.letter}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-headline font-semibold">Flood grade {ok.grade.letter}</span>
                      <span className="block truncate text-subhead text-label-2">{ok.place.label.split(",")[0]} · tap for the full report</span>
                    </span>
                  </button>
                </Group>
              )}
              {live && (
                <LivePanel
                  alerts={alerts}
                  gauges={
                    gauges &&
                    // Nearest first, by a flat-earth distance (fine at city scale).
                    [...gauges].sort((a, b) => {
                      const [x, y] = place?.position ?? USF_AREA;
                      const d = (g: Gauge) => (g.position[0] - x) ** 2 * 0.78 + (g.position[1] - y) ** 2;
                      return d(a) - d(b);
                    })
                  }
                />
              )}
              {!narrow && (live || stage !== "after") && <WeatherCard position={place?.position ?? USF_AREA} />}
              {!narrow && (live || stage === "before") && <WeeklyHighlight onOpen={() => open("rewards")} />}
              {!live && stage === "before" && ok && <BeforePanel key={placeKey} place={ok.place} grade={ok.grade} onPick={(p) => setSearched(p)} />}
              {!live && stage === "during" &&
                (ok ? (
                  <DuringPanel key={placeKey} place={ok.place} car={profile?.car ?? null} vehicle={profile?.vehicle ?? "car"} grade={ok.grade} controls={controls} />
                ) : (
                  <Group title="Storm">
                    <StormControls {...controls} />
                  </Group>
                ))}
              {!live && stage === "after" && ok && (
                <AfterPanel
                  key={`after-${placeKey}`}
                  place={ok.place}
                  grade={ok.grade}
                  onReplay={() => {
                    controls.onScenario("milton");
                    setPump("on");
                    setHour(24);
                    setStage("during");
                  }}
                />
              )}
              {!live && stage === "before" && <ValidationPanel />}
              </motion.div>
              {searched && profile?.home && (
                <div className="px-5 pt-3">
                  <button type="button" onClick={() => setSearched(null)} className="min-h-11 text-subhead font-medium text-tint">
                    Back to your home
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "ask" && (
            <Group>
              <AskPelican
                key={`${placeKey}-${scenario}-${pump}-${safeHour}`}
                from={profile?.car?.position ?? place?.position ?? null}
                vehicle={profile?.vehicle ?? "car"}
                scenario={scenario}
                pump={pump}
                hour={safeHour}
                hourZero={hourZero}
                onRoute={setRoute}
              />
            </Group>
          )}

          {tab === "rewards" && <RewardsPanel />}

          {tab === "weather" && <WeatherCard position={place?.position ?? USF_AREA} />}

          {tab === "help" && <HelpPanel position={place?.position ?? USF_AREA} />}

          {tab === "you" && profile && (
            <>
              <Group title="Your places">
                <ListRow icon={Icon.home} label="Home" value={profile.home?.label.split(",")[0] ?? "Not set"} />
                <ListRow
                  icon={Icon.car}
                  label="Car"
                  value={profile.car ? profile.car.label : "Not set"}
                  detail={profile.vehicle === "suv" ? "SUV or pickup: roads close for it at about 12 in" : profile.vehicle === "car" ? "Car: roads close for it at about 6 in" : undefined}
                  last
                />
              </Group>
              <Group title="Insurance">
                <ListRow
                  icon={Icon.wrench}
                  label="Flood cover"
                  value={profile.insurance.flood ? COVER_WORDS[profile.insurance.flood] : "Not answered"}
                  detail={
                    [profile.insurance.carrier, profile.insurance.policyNumber && `Policy ${profile.insurance.policyNumber}`, profile.insurance.renewal && `Renews ${profile.insurance.renewal}`]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  last
                />
              </Group>
              <Group title="Flood camera">
                <FloodCamera home={profile.home?.position ?? null} />
              </Group>
              <div className="space-y-1 px-5 pt-3">
                <button type="button" onClick={() => saveProfile({ done: false })} className="block min-h-11 text-subhead font-medium text-tint">
                  Redo setup
                </button>
                <button type="button" onClick={forgetProfile} className="block min-h-11 text-subhead text-late">
                  Forget my home, car and insurance on this device
                </button>
              </div>
            </>
          )}

          <details className="group px-5 pt-5 text-footnote text-label-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span>Screening estimate. Never drive or walk into floodwater.</span>
              <span className="shrink-0 font-medium text-tint group-open:hidden">About</span>
            </summary>
            <p className="max-w-[65ch] text-pretty pb-2 text-label-3">{SAFETY_FOOTNOTE}</p>
          </details>
        </div>
      </Sheet>
    </main>
  );
}

/** Depth for the meter: "Dry", "7 in", "1.5 ft". */
function meterWords(m: number): string {
  if (m < 0.02) return "Dry";
  const inches = m * 39.37;
  return inches < 12 ? `${Math.max(1, Math.round(inches))} in` : `${Math.round((inches / 12) * 2) / 2} ft`;
}

/** A small gauge: fills to 4 ft, coloured by the floodwater ramp. */
function MeterBar({ depthM }: { depthM: number | null }) {
  const d = depthM ?? 0;
  const k = RAMP.findIndex(([max]) => d < max);
  const [, r, g, b] = RAMP[k < 0 ? RAMP.length - 1 : k];
  const fill = d < 0.02 ? 0 : Math.min(1, Math.max(0.08, d / 1.22));
  return (
    <span className="relative block h-11 w-3 overflow-hidden rounded-full bg-fill" aria-hidden>
      <span
        className="absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-500 ease-out"
        style={{ height: `${fill * 100}%`, background: `rgb(${r} ${g} ${b})` }}
      />
    </span>
  );
}

/** The default view: what is true right now. No flood model runs live, so this shows real feeds only. */
function LivePanel({ gauges, alerts }: { gauges: Gauge[] | null; alerts: string[] | null }) {
  return (
    <>
      <Group title="Right now">
        <div className="px-4 py-3">
          <p className="flex items-center gap-2 text-headline font-semibold">
            <span className={`size-2.5 rounded-full ${alerts?.length ? "bg-late" : "bg-safe"}`} aria-hidden />
            {alerts === null ? "Checking the Weather Service…" : alerts.length ? alerts.join(", ") : "No flood or storm alerts"}
          </p>
          <p className="mt-1 text-subhead text-label-2">
            {alerts?.length
              ? "Follow official instructions. Never drive or walk into floodwater."
              : "No flood is happening here now. Tap Storm mode to see what a storm would do."}
          </p>
        </div>
      </Group>
      <Group title="Rivers and creeks now">
        {gauges === null ? (
          <div className="space-y-2 px-4 py-3" aria-busy>
            <div className="shimmer h-5 w-3/4 rounded-md" />
            <div className="shimmer h-5 w-2/3 rounded-md" />
          </div>
        ) : gauges.length === 0 ? (
          <p className="px-4 py-3 text-subhead text-label-2">River gauges are unavailable right now.</p>
        ) : (
          gauges.slice(0, 6).map((g, i, all) => (
            <div key={g.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i < all.length - 1 ? "border-b border-separator" : ""}`}>
              <span className="min-w-0">
                <span className="block truncate text-body">{g.name}</span>
                <span className="block text-footnote text-label-2">{g.flowCfs !== null ? `${g.flowCfs.toLocaleString()} cfs · ` : ""}{g.at}</span>
              </span>
              <span className="shrink-0 text-headline font-semibold tabular-nums">{g.heightFt.toFixed(1)} ft</span>
            </div>
          ))
        )}
      </Group>
      <p className="px-5 pt-2 text-footnote text-label-3">Gauge heights from USGS, read live; each gauge has its own zero, so compare a gauge with itself over time.</p>
    </>
  );
}
