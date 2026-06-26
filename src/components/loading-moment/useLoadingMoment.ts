"use client";

import * as React from "react";

import { readCachedLoadingMomentPayload } from "./client-cache";
import { resolveLoadingMomentWithRotation } from "./rotation";
import type { ResolvedLoadingMoment } from "./types";

/**
 * The minimum wait before a Loading Moment is allowed to appear (C-7): short
 * waits never earn a moment. Session generation routinely runs longer than
 * this, so a real generation wait surfaces a card while a fast one stays plain.
 */
export const LOADING_MOMENT_MIN_WAIT_MS = 900;

/**
 * Resolve a Loading Moment for an active long wait, reading cached-only data.
 *
 * Returns null until the wait has lasted `LOADING_MOMENT_MIN_WAIT_MS` (so a
 * short wait never flashes a card), then resolves exactly one moment from the
 * cached payload + client-session rotation. Reading the cache is synchronous —
 * no fetch on the loading path (C-1). A cold/stale cache resolves to null, and
 * the plain loading state renders unchanged (C-3).
 *
 * `active` should be true only while a qualifying long wait is in progress
 * (e.g. session generation); pass false on short waits so no moment is gated in.
 */
export function useLoadingMoment(active: boolean): ResolvedLoadingMoment | null {
  const [moment, setMoment] = React.useState<ResolvedLoadingMoment | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      const payload = readCachedLoadingMomentPayload();
      setMoment(resolveLoadingMomentWithRotation(payload));
    }, LOADING_MOMENT_MIN_WAIT_MS);
    // Clear the timer and reset on deactivation/unmount, so a finished wait
    // never leaves a stale card mounted and the next wait re-resolves fresh.
    return () => {
      window.clearTimeout(id);
      setMoment(null);
    };
  }, [active]);

  return moment;
}
