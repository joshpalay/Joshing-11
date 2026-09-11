/**
 * Client-side "mark this ceremony viewed" with retry (B-CEREMONY-VIEWED-RETRY-01).
 *
 * Mounting the ceremony room POSTs /api/ceremony/:id/viewed so
 * getLatestUnviewedCeremony stops returning it — otherwise
 * B-CEREMONY-PLACEMENT-01's forced redirect (src/app/daily/page.tsx) sends the
 * player right back into the same ceremony the next time they finish a day's
 * five. The call used to be pure fire-and-forget with a swallowed `.catch`, so
 * a single transient failure (network blip, cold start) left the ceremony
 * permanently "unviewed" from the server's point of view — production data
 * showed real gaps of 3-33 days between a ceremony firing and getting marked
 * viewed, consistent with the player being redirected into it again on
 * multiple separate days before a retry (i.e. the next day's redirect) finally
 * landed. Retrying a few times with backoff closes that gap for the common
 * transient case, mirroring the pattern already used for answer submission
 * (src/lib/answer-submit.ts).
 */

export const CEREMONY_VIEWED_RETRY_BACKOFF_MS = [800, 2000] as const;
export const CEREMONY_VIEWED_MAX_ATTEMPTS = CEREMONY_VIEWED_RETRY_BACKOFF_MS.length + 1;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type MarkCeremonyViewedOptions = {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  delayImpl?: (ms: number) => Promise<void>;
};

/**
 * POSTs /api/ceremony/:id/viewed, retrying transient failures (network errors,
 * 5xx) with backoff. Resolves `true` once the server confirms the ceremony is
 * marked viewed, `false` once every attempt is spent (or a deterministic 4xx
 * — unauthorized/forbidden/not-found — makes retrying pointless). Never
 * throws: the caller is a best-effort side mount, not something that should
 * block rendering the ceremony itself.
 */
export async function markCeremonyViewed(
  ceremonyId: string,
  options: MarkCeremonyViewedOptions = {},
): Promise<boolean> {
  const fetchFn = options.fetchImpl ?? fetch;
  const delay = options.delayImpl ?? defaultDelay;

  for (let attempt = 1; attempt <= CEREMONY_VIEWED_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchFn(`/api/ceremony/${ceremonyId}/viewed`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) return true;
      // Deterministic failure (unauthorized/forbidden/not-found) — another
      // attempt can never succeed, so stop instead of burning retries.
      if (response.status < 500) return false;
    } catch {
      // Network-level failure — fall through to retry.
    }
    if (attempt < CEREMONY_VIEWED_MAX_ATTEMPTS) {
      await delay(CEREMONY_VIEWED_RETRY_BACKOFF_MS[attempt - 1]);
    }
  }
  return false;
}
