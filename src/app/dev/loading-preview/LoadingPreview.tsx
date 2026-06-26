"use client";

import * as React from "react";

import LoadingScreen from "@/components/LoadingScreen";

import { PREVIEW_STATES, resolvePreviewState } from "./preview-states";

/**
 * Dev-only forced preview of the Loading Moment surface (B-LOADING-MOMENT-01).
 * Cycles every card type plus the sparse / cold-start fallback and the plain
 * state, with NO real load. Each sample is run through the real selector (see
 * `preview-states`) so the preview shows true selector output, not hand-mocked
 * copy.
 *
 * Preview-only: this never touches the real loading path. Gated to admins by
 * the /dev route layout and the profile Developer-tools section.
 */
export function LoadingPreview({ initialKey }: { initialKey?: string }) {
  const initialIndex = Math.max(
    0,
    PREVIEW_STATES.findIndex((s) => s.key === initialKey),
  );
  const [index, setIndex] = React.useState(initialIndex);
  const state = PREVIEW_STATES[index];
  const moment = resolvePreviewState(state);

  return (
    <div className="relative min-h-screen w-full">
      <LoadingScreen
        fullScreen
        messages={["Crafting your bespoke questions"]}
        loadingMoment={moment}
      />

      {/* Preview chrome — sits above the loader; not part of the surface. */}
      <div className="fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 bg-black/70 px-4 py-3 text-white">
        <p className="font-sans text-xs tracking-wide uppercase opacity-80">
          Loading-moment preview · {state.label}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {PREVIEW_STATES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setIndex(i)}
              className={`rounded px-2 py-1 font-sans text-[11px] ${
                i === index ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/30"
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
