/**
 * Client-session cache for the Loading Moment payload (B-LOADING-MOMENT-01).
 *
 * The payload is fetched ONCE per session from a stable screen (see
 * `LoadingMomentPrimer`, mounted on the home page) and stored in
 * sessionStorage. The loading screen reads it synchronously — never a fetch on
 * the loading path (C-1). A cold cache simply resolves to the plain state (C-3);
 * the card appears on a later load once the cache is warm.
 *
 * Session-scoped (sessionStorage), matching the rotation memory's "resets on a
 * fresh session is acceptable" stance (resolved Q4).
 */

import { z } from "zod";

import type { LoadingMomentPayload } from "./types";

const STORAGE_KEY = "joshing.loadingMoment.v1";

const payloadSchema = z.object({
  generatedAt: z.number(),
  deepestTerritory: z.object({ subcategory: z.string() }).optional(),
  rareKnowledge: z.object({ subcategory: z.string() }).optional(),
  turnaround: z.object({ subcategory: z.string() }).optional(),
  deepestCut: z.object({ questionStem: z.string() }).optional(),
  overlap: z.object({ friendName: z.string(), subcategory: z.string() }).optional(),
  waitingDiscovery: z.object({ friendName: z.string(), subcategory: z.string() }).optional(),
});

/** Synchronously read the cached payload. Returns null if absent/malformed/SSR. */
export function readCachedLoadingMomentPayload(): LoadingMomentPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = payloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCachedLoadingMomentPayload(payload: LoadingMomentPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may be unavailable (private mode / quota) — non-fatal.
  }
}

let primed = false;

/**
 * Fetch the payload off the critical path and cache it. Fetches at most once per
 * page session (the `primed` guard); resetting on reload is acceptable. Any
 * failure is swallowed — the loader just falls to the plain state.
 */
export async function primeLoadingMomentPayload(): Promise<void> {
  if (typeof window === "undefined" || primed) return;
  primed = true;
  try {
    const res = await fetch("/api/loading-moment", { credentials: "include" });
    if (!res.ok) return;
    const parsed = payloadSchema.safeParse(await res.json());
    if (parsed.success) writeCachedLoadingMomentPayload(parsed.data);
  } catch {
    // Network/parse failure → leave the cache as-is.
  }
}

/**
 * Clear the cached payload and reset the prime guard. Call at every auth
 * boundary (login + logout) so a user can never read a payload cached by a
 * previous user in the same browser tab — sessionStorage outlives a soft
 * logout/login, and the loading screen reads the cache without knowing who the
 * current user is. After this, the next prime re-fetches for the new session.
 */
export function clearCachedLoadingMomentPayload(): void {
  primed = false;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable — non-fatal.
  }
}

/** Test-only: reset the once-per-session prime guard. */
export function resetLoadingMomentPrimeGuard(): void {
  primed = false;
}
