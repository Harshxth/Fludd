"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { recordContribution } from "@/components/rewards/contributions";
import { Paused } from "@/components/ui/paused";
import { Group } from "@/components/ui/surface";
import { AI_ON } from "@/lib/config";
import type { ApiError, QueueItem } from "@/lib/types";
import { percent, rangeWords } from "./depth-words";

type AiReading = QueueItem["aiReading"];

type Phase =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "uploading" }
  | { kind: "done"; aiReading: AiReading | null }
  | { kind: "error"; message: string };

interface UploadAnswer {
  id: string;
  status: "waiting";
  aiReading: AiReading | null;
}

const LOCATION_DENIED =
  "Fludd needs your location to place the report. Allow location for this site in your browser settings, then try again.";
const LOCATION_FAILED = "Your phone could not find its position. Step outside or wait a moment, then try again.";

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error(LOCATION_FAILED));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? LOCATION_DENIED : LOCATION_FAILED)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}

function isApiError(v: unknown): v is ApiError {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const e = (v as { error: unknown }).error;
  return typeof e === "object" && e !== null && typeof (e as { message?: unknown }).message === "string";
}

async function sendReport(photo: File, position: GeolocationPosition): Promise<UploadAnswer> {
  const form = new FormData();
  form.append("photo", photo);
  form.append("lat", String(position.coords.latitude));
  form.append("lng", String(position.coords.longitude));
  form.append("source", "gps");
  if (photo.lastModified) form.append("takenAt", new Date(photo.lastModified).toISOString());

  let res: Response;
  try {
    res = await fetch("/api/reports", { method: "POST", body: form });
  } catch {
    throw new Error("The report could not be sent. Check your connection and try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(isApiError(body) ? body.error.message : `The report could not be sent (${res.status}).`);
  return body as UploadAnswer;
}

/** A resident reports flooding: one photo, the phone's position, then a person checks it. */
export function ReportFlow({ onClose }: { onClose: () => void }) {
  const inputId = useId();
  const [chosen, setChosen] = useState<{ photo: File; preview: string } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const photo = chosen?.photo ?? null;
  const preview = chosen?.preview ?? null;

  // Free the preview's memory when it is replaced or the flow closes.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const busy = phase.kind === "locating" || phase.kind === "uploading";

  async function submit() {
    if (!photo || busy) return;
    setPhase({ kind: "locating" });
    let position: GeolocationPosition;
    try {
      position = await currentPosition();
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : LOCATION_FAILED });
      return;
    }
    setPhase({ kind: "uploading" });
    try {
      const answer = await sendReport(photo, position);
      recordContribution("report", [position.coords.longitude, position.coords.latitude]);
      setPhase({ kind: "done", aiReading: answer.aiReading });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "The report could not be sent." });
    }
  }

  return (
    <div className="pb-2">
      <header className="flex items-center justify-between gap-3 px-4 pt-3">
        <h2 className="px-3 text-headline font-semibold">Report flooding</h2>
        <button
          type="button"
          onClick={onClose}
          className="pressable min-h-11 rounded-[var(--radius-control)] px-3 text-subhead font-medium text-tint"
        >
          {phase.kind === "done" ? "Done" : "Cancel"}
        </button>
      </header>

      {phase.kind === "done" ? (
        <Done key="done" aiReading={phase.aiReading} />
      ) : (
        <>
          <Group title="Photo">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, nothing to optimise
              <img
                key={preview}
                src={preview}
                alt="The photo you chose"
                className="swap-in aspect-[4/3] w-full rounded-t-[var(--radius-group)] object-cover"
              />
            )}
            <label
              htmlFor={inputId}
              className={`pressable flex min-h-11 cursor-pointer items-center px-4 text-subhead font-medium text-tint ${preview ? "border-t border-separator" : ""}`}
            >
              {photo ? "Choose a different photo" : "Take or choose a photo"}
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setChosen(file ? { photo: file, preview: URL.createObjectURL(file) } : null);
                if (phase.kind === "error") setPhase({ kind: "idle" });
              }}
            />
          </Group>
          <p className="px-7 pt-1.5 text-footnote text-label-2">
            Show the water next to something with a known height, like a curb, a tyre or a mailbox. Location is taken
            from your phone and only an admin sees the exact spot. Never wade or drive into water to take a photo.
          </p>

          {phase.kind === "error" && (
            <p role="alert" className="nudge mx-4 mt-3 rounded-[var(--radius-group)] bg-group px-4 py-3 text-subhead text-late">
              {phase.message}
            </p>
          )}

          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={submit}
              disabled={!photo || busy}
              className="pressable min-h-11 w-full rounded-[var(--radius-control)] bg-tint px-4 text-headline font-semibold text-white active:bg-tint-pressed disabled:opacity-40"
            >
              {/* Keyed by phase so each new label swaps in; the dots only show while the photo is on its way. */}
              <span key={busy ? phase.kind : "send"} className="swap-in inline-flex items-center justify-center">
                {phase.kind === "locating" ? "Finding your position" : phase.kind === "uploading" ? "Sending" : "Send report"}
                {busy && (
                  <span className="typing ml-2" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </span>
            </button>
            <p aria-live="polite" className="sr-only">
              {phase.kind === "locating" ? "Finding your position" : phase.kind === "uploading" ? "Sending the photo" : ""}
            </p>
            {/* Holds the place of the reading while it is on its way. Below the button, so the button never moves. */}
            {busy && (
              <div className="rise-in mt-4" aria-hidden="true">
                <div className="shimmer h-16 rounded-[var(--radius-group)]" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Done({ aiReading }: { aiReading: AiReading | null }) {
  return (
    <div className="swap-in">
      <Group>
        <p role="status" className="px-4 py-3 text-subhead">
          Thanks. A person checks every photo before it appears on the map.
        </p>
      </Group>
      {aiReading && (
        <Group title="First reading of your photo">
          <div className="border-b border-separator px-4 py-2.5">
            <p className="text-footnote text-label-2">Water</p>
            <p className="pop-in origin-left text-subhead">
              {aiReading.waterPresent ? `About ${rangeWords(aiReading.depthRangeM)}` : "No standing water seen"}
            </p>
          </div>
          <div className="rise-in border-b border-separator px-4 py-2.5" style={{ "--i": 2 } as CSSProperties}>
            <p className="text-footnote text-label-2">Judged against</p>
            <p className="text-subhead">{aiReading.reference}</p>
          </div>
          <div className="rise-in px-4 py-2.5" style={{ "--i": 3 } as CSSProperties}>
            <p className="text-footnote text-label-2">Confidence</p>
            <p className="text-subhead">{percent(aiReading.confidence)}</p>
          </div>
        </Group>
      )}
      {!aiReading && !AI_ON && <Paused what="Automatic photo reading" className="px-7 pt-1.5" />}
      <p className="rise-in px-7 pt-1.5 text-footnote text-label-2" style={{ "--i": 4 } as CSSProperties}>
        {aiReading ? "This reading is an estimate from one photo. " : ""}Do not drive or walk through flood water at any depth.
      </p>
    </div>
  );
}
