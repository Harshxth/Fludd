"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { saveProfile } from "@/components/onboarding/profile";
import { rangeWords } from "@/components/report/depth-words";
import { recordContribution } from "@/components/rewards/contributions";
import { Paused } from "@/components/ui/paused";
import { AI_ON } from "@/lib/config";
import type { LngLat, QueueItem } from "@/lib/types";

type AiReading = QueueItem["aiReading"];

type Phase =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "checking" }
  | { kind: "result"; reading: AiReading | null; at: Date }
  | { kind: "error"; message: string };

const HOUR_MS = 60 * 60 * 1000;
const MAX_WIDTH = 1280;

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();

/**
 * A spare phone as a flood camera. Prop it in a window; this screen takes one still when asked, or every hour
 * while it stays open, and sends it through the same photo report route a person would use. Nothing is recorded
 * or streamed, and a reviewer checks every reading before it reaches the map.
 *
 * Security cameras are left out on purpose: Ring and Nest give other apps no way in, and cameras with a
 * snapshot link are plain http on the home network, which a secure page is not allowed to fetch.
 */
export function FloodCamera({ home }: { home: LngLat | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "off" });
  const [hourly, setHourly] = useState(false);
  const [nextAt, setNextAt] = useState<Date | null>(null);
  const on = phase.kind !== "off" && phase.kind !== "starting" && phase.kind !== "error";

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void wake.current?.release().catch(() => undefined);
    wake.current = null;
    setHourly(false);
    setNextAt(null);
    setPhase({ kind: "off" });
  }

  // Leaving the tab must switch the camera off.
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      void wake.current?.release().catch(() => undefined);
    },
    [],
  );

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ kind: "error", message: "This browser can't use the camera. Try Safari or Chrome on the phone." });
      return;
    }
    setPhase({ kind: "starting" });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      saveProfile({ camera: { optIn: true, snapshotUrl: "" } });
      setPhase({ kind: "live" });
    } catch {
      setPhase({ kind: "error", message: "Fludd needs the camera for this. Allow camera access for this site, then try again." });
    }
  }

  async function check() {
    const v = video.current;
    if (!v || !stream.current || !v.videoWidth) return;
    if (!home) {
      setPhase({ kind: "error", message: "Set your home first, so Fludd knows where this camera is looking." });
      return;
    }
    setPhase({ kind: "checking" });
    try {
      const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("The camera gave no picture. Try again.");
      const form = new FormData();
      form.append("photo", new File([blob], "flood-camera.jpg", { type: "image/jpeg" }));
      form.append("lat", String(home[1]));
      form.append("lng", String(home[0]));
      form.append("source", "pin");
      form.append("takenAt", new Date().toISOString());
      const res = await fetch("/api/reports", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { aiReading?: AiReading | null; error?: { message?: string } } | null;
      if (!res.ok) throw new Error(body?.error?.message ?? `The picture could not be sent (${res.status}).`);
      recordContribution("camera", home);
      setPhase({ kind: "result", reading: body?.aiReading ?? null, at: new Date() });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "The picture could not be sent." });
    }
  }

  // Hourly checks run only while this screen is open; the phone is asked to stay awake where it can.
  useEffect(() => {
    if (!hourly) return;
    const id = window.setInterval(() => {
      void check();
      setNextAt(new Date(Date.now() + HOUR_MS));
    }, HOUR_MS);
    return () => window.clearInterval(id);
    // check reads refs and the saved home; restarting the timer on every render would never let it fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourly, home]);

  async function toggleHourly(value: boolean) {
    setHourly(value);
    setNextAt(value ? new Date(Date.now() + HOUR_MS) : null);
    if (value) {
      const lock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      wake.current = (await lock?.request("screen").catch(() => null)) ?? null;
    } else {
      void wake.current?.release().catch(() => undefined);
      wake.current = null;
    }
  }

  return (
    <div className="px-4 py-4">
      <p className="text-headline font-semibold">Turn a spare phone into a flood camera</p>
      <p className="mt-1 text-subhead text-label-2">
        Prop an old phone in a window facing the street and open this screen on it. Fludd takes one photo when you ask, or once an hour{AI_ON ? ", and reads how deep the water is" : ", and sends it to a reviewer"}.
      </p>
      {!AI_ON && <Paused what="Automatic depth reading" className="mt-1" />}

      <div className={`relative mt-3 overflow-hidden rounded-[var(--radius-control)] bg-fill ${on ? "swap-in" : "hidden"}`}>
        <video ref={video} muted playsInline className="block aspect-video w-full object-cover" aria-label="Live view from this phone's camera" />
        {phase.kind === "checking" && (
          <p className="rise-in absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-footnote text-white">
            {AI_ON ? "Reading the water…" : "Sending the photo…"}
            <span className="typing ml-2 align-middle" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        )}
      </div>

      <div aria-live="polite">
        {phase.kind === "result" && (
          <div className="pop-in mt-3 rounded-[var(--radius-control)] bg-fill px-3 py-3">
            <p className="text-headline font-semibold">
              {phase.reading ? (phase.reading.waterPresent ? `About ${rangeWords(phase.reading.depthRangeM)} of water` : "No standing water seen") : "Photo sent"}
            </p>
            <p className="rise-in mt-0.5 text-footnote text-label-2" style={{ "--i": 2 } as CSSProperties}>
              Checked at {clock(phase.at)}. A reviewer looks at it before it goes on the map.
            </p>
          </div>
        )}
        {phase.kind === "error" && (
          <p role="alert" className="nudge mt-3 text-subhead text-late">
            {phase.message}
          </p>
        )}
      </div>

      {!on ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={phase.kind === "starting"}
          className="pressable mt-3 min-h-12 w-full rounded-[var(--radius-control)] bg-tint px-4 text-body font-semibold text-white disabled:opacity-60"
        >
          {phase.kind === "starting" ? "Starting the camera…" : "Start the camera"}
        </button>
      ) : (
        <div className="swap-in">
          <button
            type="button"
            onClick={() => void check()}
            disabled={phase.kind === "checking"}
            className="pressable mt-3 min-h-12 w-full rounded-[var(--radius-control)] bg-tint px-4 text-body font-semibold text-white disabled:opacity-60"
          >
            {phase.kind === "checking" ? "Checking…" : "Check the water now"}
          </button>
          <label className="mt-2 flex min-h-12 items-center justify-between gap-4">
            <span className="text-body">
              Check every hour
              <span className="block text-footnote text-label-2">
                {nextAt ? `Next check about ${clock(nextAt)}. Keep this screen open.` : "Only while this screen stays open."}
              </span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={hourly} aria-checked={hourly} onChange={(e) => void toggleHourly(e.target.checked)} />
          </label>
          <button type="button" onClick={stop} className="pressable min-h-11 text-subhead font-medium text-late">
            Turn the camera off
          </button>
        </div>
      )}

      <details className="mt-2">
        <summary className="pressable min-h-11 cursor-pointer py-2.5 text-subhead font-medium text-tint">Have a doorbell or security camera?</summary>
        <p className="rise-in pb-1 text-subhead text-label-2">
          CCTV and IP cameras that give a video address or a snapshot link can send stills too: a few lines on a computer at home take one still and send it
          here, so the camera&apos;s address and password stay in your house. This page can&apos;t reach a camera on your Wi-Fi itself, because browsers block
          that from a secure site. Ring and Google Nest keep their video inside their own apps, so Fludd can&apos;t use those yet.
        </p>
      </details>
      <p className="text-footnote text-label-3">Nothing is recorded or streamed. One still photo is sent each time, and you can turn it off here.</p>
    </div>
  );
}
