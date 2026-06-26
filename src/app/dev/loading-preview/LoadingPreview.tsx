"use client";

import * as React from "react";

import LoadingScreen from "@/components/LoadingScreen";
import { selectLoadingMoment } from "@/components/loading-moment/selectLoadingMoment";
import type {
  LoadingMomentPayload,
  ResolvedLoadingMoment,
} from "@/components/loading-moment/types";

/**
 * Dev-only forced preview of the Loading Moment surface (B-LOADING-MOMENT-01).
 * Cycles every card type plus the sparse / cold-start fallback and the plain
 * state, with NO real load. Each sample is run through the real
 * `selectLoadingMoment` selector (from a crafted single-card payload) so the
 * preview shows true selector output, not hand-mocked copy.
 *
 * Preview-only: this never touches the real loading path. Gated to admins by
 * the /dev route layout.
 */

const NOW = 1_700_000_000_000;

type PreviewState = {
  key: string;
  label: string;
  resolve: () => ResolvedLoadingMoment | null;
};

function fromPayload(payload: LoadingMomentPayload | null): ResolvedLoadingMoment | null {
  return selectLoadingMoment(payload, { now: NOW });
}

const PREVIEW_STATES: PreviewState[] = [
  {
    key: "deepest-territory",
    label: "1 · Deepest territory",
    resolve: () =>
      fromPayload({ generatedAt: NOW, deepestTerritory: { subcategory: "Italian Renaissance" } }),
  },
  {
    key: "rare-knowledge",
    label: "2 · Rare knowledge (deferred)",
    resolve: () =>
      // Deferred this build — forced here only so reviewers can see the copy.
      fromPayload({ generatedAt: NOW, rareKnowledge: { subcategory: "Byzantine sigillography" } }),
  },
  {
    key: "turnaround",
    label: "3 · A wrong answer turned around",
    resolve: () => fromPayload({ generatedAt: NOW, turnaround: { subcategory: "Tudor England" } }),
  },
  {
    key: "deepest-cut",
    label: "4 · The deepest cut",
    resolve: () =>
      fromPayload({
        generatedAt: NOW,
        deepestCut: { questionStem: "Which doge commissioned the Bucintoro?" },
      }),
  },
  {
    key: "overlap",
    label: "5 · Who shares this with you",
    resolve: () =>
      fromPayload({
        generatedAt: NOW,
        overlap: { friendName: "Maya", subcategory: "Baroque opera" },
      }),
  },
  {
    key: "waiting-discovery",
    label: "6 · A question waiting for you",
    resolve: () =>
      fromPayload({
        generatedAt: NOW,
        waitingDiscovery: { friendName: "Sam", subcategory: "Norse mythology" },
      }),
  },
  {
    key: "sparse",
    label: "Sparse / cold-start fallback",
    resolve: () => fromPayload({ generatedAt: NOW }),
  },
  {
    key: "plain",
    label: "Plain state (no card / cached-miss)",
    resolve: () => fromPayload(null),
  },
];

export function LoadingPreview({ initialKey }: { initialKey?: string }) {
  const initialIndex = Math.max(
    0,
    PREVIEW_STATES.findIndex((s) => s.key === initialKey),
  );
  const [index, setIndex] = React.useState(initialIndex);
  const state = PREVIEW_STATES[index];
  const moment = state.resolve();

  return (
    <div className="relative min-h-screen w-full">
      <LoadingScreen fullScreen messages={["Crafting your bespoke questions"]} loadingMoment={moment} />

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
