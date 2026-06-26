"use client";

import * as React from "react";

import { primeLoadingMomentPayload } from "./client-cache";

/**
 * Warms the Loading Moment cache from a STABLE screen (mounted on the home
 * page), off the critical path, so a later loading screen can read it
 * synchronously (B-LOADING-MOMENT-01, C-1). Renders nothing. Primes once per
 * session via requestIdleCallback (a timeout fallback) so it never competes
 * with the home page's own render/data work.
 */
export function LoadingMomentPrimer() {
  React.useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void primeLoadingMomentPayload();
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
    };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(run);
    } else {
      window.setTimeout(run, 200);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
