/**
 * Anti-repeat rotation memory for the Loading Moment (C-5).
 *
 * Resolved Q4: rotation state lives in CLIENT SESSION only — never persisted
 * server-side, so there is no write on the loading path (honors C-1/C-3).
 * A module-level singleton is the lightest possible store: it is in-memory,
 * resets on a fresh page load (acceptable per the resolution), and costs no I/O.
 *
 * This file deliberately holds no React; the loading component reads it through
 * `resolveLoadingMomentWithRotation` when it mounts.
 */

import {
  selectLoadingMoment,
  type SelectLoadingMomentOptions,
} from "./selectLoadingMoment";
import type {
  LoadingMomentKind,
  LoadingMomentPayload,
  ResolvedLoadingMoment,
} from "./types";

let lastShownKind: LoadingMomentKind | null = null;

export function getLastShownKind(): LoadingMomentKind | null {
  return lastShownKind;
}

export function recordShownKind(kind: LoadingMomentKind | null): void {
  lastShownKind = kind;
}

/** Reset rotation memory — used by tests and the dev preview. */
export function resetLoadingMomentRotation(): void {
  lastShownKind = null;
}

/**
 * Resolve the Loading Moment using (and then updating) the client-session
 * rotation memory. The "write" here is a single in-memory assignment — no
 * network, no storage, no DB — so it does not violate the no-write-on-the-
 * loading-path rule.
 */
export function resolveLoadingMomentWithRotation(
  payload: LoadingMomentPayload | null | undefined,
  options: Omit<SelectLoadingMomentOptions, "lastShownKind"> = {},
): ResolvedLoadingMoment | null {
  const resolved = selectLoadingMoment(payload, {
    ...options,
    lastShownKind,
  });
  // Record real cards and the sparse default so the next load can rotate off
  // them; record `null` for the plain state so it never blocks the next card.
  lastShownKind = resolved?.kind ?? null;
  return resolved;
}
