/**
 * Forced preview states for the Loading Moment dev preview
 * (B-LOADING-MOMENT-01 Phase 4). Pure data + a resolver so the cycler and its
 * tests share one source of truth. Each state crafts a single-card payload and
 * runs it through the REAL selector, so the preview shows true selector output
 * (not hand-mocked copy) and the test can assert the surface end-to-end.
 */

import { selectLoadingMoment } from "@/components/loading-moment/selectLoadingMoment";
import type {
  LoadingMomentPayload,
  ResolvedLoadingMoment,
} from "@/components/loading-moment/types";

/** Fixed clock so previews are deterministic (the payloads are always "fresh"). */
export const PREVIEW_NOW = 1_700_000_000_000;

export type PreviewState = {
  key: string;
  label: string;
  /** The crafted payload; `null` forces the plain / cached-miss state. */
  payload: LoadingMomentPayload | null;
};

export const PREVIEW_STATES: PreviewState[] = [
  {
    key: "deepest-territory",
    label: "1 · Deepest territory",
    payload: { generatedAt: PREVIEW_NOW, deepestTerritory: { subcategory: "Italian Renaissance" } },
  },
  {
    key: "rare-knowledge",
    label: "2 · Rare knowledge (deferred)",
    // Deferred this build — forced here only so reviewers can see the copy.
    payload: { generatedAt: PREVIEW_NOW, rareKnowledge: { subcategory: "Byzantine sigillography" } },
  },
  {
    key: "turnaround",
    label: "3 · A wrong answer turned around",
    payload: { generatedAt: PREVIEW_NOW, turnaround: { subcategory: "Tudor England" } },
  },
  {
    key: "deepest-cut",
    label: "4 · The deepest cut",
    payload: {
      generatedAt: PREVIEW_NOW,
      deepestCut: { questionStem: "Which doge commissioned the Bucintoro?" },
    },
  },
  {
    key: "overlap",
    label: "5 · Who shares this with you",
    payload: { generatedAt: PREVIEW_NOW, overlap: { friendName: "Maya", subcategory: "Baroque opera" } },
  },
  {
    key: "waiting-discovery",
    label: "6 · A question waiting for you",
    payload: {
      generatedAt: PREVIEW_NOW,
      waitingDiscovery: { friendName: "Sam", subcategory: "Norse mythology" },
    },
  },
  {
    key: "sparse",
    label: "Sparse / cold-start fallback",
    payload: { generatedAt: PREVIEW_NOW },
  },
  {
    key: "plain",
    label: "Plain state (no card / cached-miss)",
    payload: null,
  },
];

/** Resolve a preview state's moment through the real selector. */
export function resolvePreviewState(state: PreviewState): ResolvedLoadingMoment | null {
  return selectLoadingMoment(state.payload, { now: PREVIEW_NOW });
}
