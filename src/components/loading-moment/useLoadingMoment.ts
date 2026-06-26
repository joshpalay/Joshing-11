"use client";

import * as React from "react";

import { readCachedLoadingMomentPayload } from "./client-cache";
import { resolveLoadingMomentWithRotation } from "./rotation";
import type { ResolvedLoadingMoment } from "./types";

/**
 * Resolve the Loading Moments to interleave into an active long wait, reading
 * cached-only data.
 *
 * Returns an array (empty until resolved) suitable for `LoadingScreen`'s
 * `loadingMoments` interleave. Reading the cache is synchronous — no fetch on
 * the loading path (C-1). A cold/stale cache resolves to an empty array, so the
 * loader just rotates the plain craft phrases (C-3). The interleave is
 * craft-first, so a wait shorter than one rotation cycle never reaches a card
 * (long-waits-only, C-7) — no extra delay needed here.
 *
 * `active` should be true only while a qualifying long wait is in progress
 * (e.g. session generation); pass false on short waits.
 */
export function useLoadingMoments(active: boolean): ResolvedLoadingMoment[] {
  const [moments, setMoments] = React.useState<ResolvedLoadingMoment[]>([]);

  React.useEffect(() => {
    if (!active) return;
    // Resolve just after mount (not in the effect body) so the sequence is built
    // before the first rotation tick, and the cache read stays off render.
    const id = window.setTimeout(() => {
      const payload = readCachedLoadingMomentPayload();
      const resolved = resolveLoadingMomentWithRotation(payload);
      setMoments(resolved ? [resolved] : []);
    }, 0);
    return () => {
      window.clearTimeout(id);
      setMoments([]);
    };
  }, [active]);

  return moments;
}
