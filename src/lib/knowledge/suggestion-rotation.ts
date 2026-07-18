import { domainKey } from '@/lib/knowledge/domain-key';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// Shared across every "Add a topic" surface (Home, the manage page, the
// /knowledge block) — one localStorage key, so rotation feels continuous
// across the whole app in a session, not siloed per surface.
const STORAGE_KEY = 'topic_suggestions_recently_shown';

// Read-only — safe to call during render (a stable snapshot, same shape on
// server (always empty, guarded below) and on first client render, so no
// hydration mismatch). The actual persistence is a separate write call the
// caller fires from an effect; keeping read and write apart means the
// picking logic below has no side effect of its own and can live in a
// plain useMemo.
export function readRecentlyShownSuggestions(): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    // localStorage can be unavailable (private mode) — rotation just resets
    // every visit rather than persisting, which is a harmless degrade.
    return new Set();
  }
}

export function rememberShownSuggestions(keys: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Same graceful degrade as above.
  }
}

/**
 * Pick up to `limit` suggestions from `pool` (already shuffled by the
 * caller), preferring ones NOT in `recentlyShown` — so a reload doesn't
 * surface the identical set, even when the underlying candidate pool (the
 * knowledge tree's direct unheld siblings, plus a handful of hard-coded
 * adjacency rules) is small enough that everything would otherwise always
 * be visible regardless of shuffle order. Falls back to the recently-shown
 * items only if there aren't enough fresh ones to fill `limit`. Pure — no
 * localStorage access itself; the caller persists the result (via
 * rememberShownSuggestions) as the new "recently shown" set for next time.
 */
export function pickRotatedSuggestions(
  pool: readonly NearbyTerritory[],
  limit: number,
  recentlyShown: ReadonlySet<string>,
): NearbyTerritory[] {
  const fresh = pool.filter((territory) => !recentlyShown.has(domainKey(territory.domain)));
  const stale = pool.filter((territory) => recentlyShown.has(domainKey(territory.domain)));
  return [...fresh, ...stale].slice(0, limit);
}
