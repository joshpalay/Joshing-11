"use client";

import * as React from "react";

import LoadingScreen from "@/components/LoadingScreen";
import type { ResolvedLoadingMoment } from "@/components/loading-moment/types";

import { PREVIEW_STATES, resolvePreviewState } from "./preview-states";

/**
 * Dev-only forced preview of the Loading Moment surface (B-LOADING-MOMENT-01).
 *
 * Two modes:
 *  - "single": inspect one card (or the sparse fallback / plain state), static.
 *  - "interleaved" (preview 2): watch the live rotation — craft phrases woven
 *    with the insight cards, cycling at the same rate as the words.
 *
 * Each sample runs through the real selector (see `preview-states`) so the
 * preview shows true output, not hand-mocked copy. Preview-only: never touches
 * the real loading path. Gated to admins by the /dev layout + profile section.
 */

// The same craft phrases the real session-generation loader rotates.
const CRAFT_MESSAGES = [
  "Crafting your bespoke questions",
  "Finding the right multitudes",
  "Reading the room",
  "Tuning the difficulty",
];

// Every resolvable insight card (excludes the plain state and the sparse
// fallback) — the set woven into the craft phrases in interleaved mode.
const INTERLEAVED_MOMENTS: ResolvedLoadingMoment[] = PREVIEW_STATES.filter(
  (s) => s.key !== "plain" && s.key !== "sparse",
)
  .map(resolvePreviewState)
  .filter((m): m is ResolvedLoadingMoment => m !== null);

export function LoadingPreview({ initialKey }: { initialKey?: string }) {
  const initialIndex = Math.max(
    0,
    PREVIEW_STATES.findIndex((s) => s.key === initialKey),
  );
  const [mode, setMode] = React.useState<"single" | "interleaved">(
    initialKey === "interleaved" ? "interleaved" : "single",
  );
  const [index, setIndex] = React.useState(initialIndex);
  const state = PREVIEW_STATES[index];
  const moment = resolvePreviewState(state);

  return (
    <div className="relative min-h-screen w-full">
      {mode === "interleaved" ? (
        <LoadingScreen
          fullScreen
          messages={CRAFT_MESSAGES}
          loadingMoments={INTERLEAVED_MOMENTS}
        />
      ) : (
        <LoadingScreen
          fullScreen
          messages={["Crafting your bespoke questions"]}
          loadingMoment={moment}
        />
      )}

      {/* Preview chrome — sits above the loader; not part of the surface. */}
      <div className="fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 bg-black/70 px-4 py-3 text-white">
        <p className="font-sans text-xs tracking-wide uppercase opacity-80">
          Loading-moment preview ·{" "}
          {mode === "interleaved" ? "Interleaved rotation (preview 2)" : state.label}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode("interleaved")}
            className={`rounded px-2 py-1 font-sans text-[11px] ${
              mode === "interleaved" ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/30"
            }`}
          >
            ▶ interleaved
          </button>
          {PREVIEW_STATES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setMode("single");
                setIndex(i);
              }}
              className={`rounded px-2 py-1 font-sans text-[11px] ${
                mode === "single" && i === index
                  ? "bg-white text-black"
                  : "bg-white/15 text-white hover:bg-white/30"
              }`}
            >
              {s.key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
