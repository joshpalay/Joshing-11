/**
 * Client-side answer submission with automatic retry.
 *
 * The grader is allowed to be transiently unavailable: src/server/grading.ts
 * returns an UNSCORED outcome on an LLM outage, and the answer routes surface it
 * as a retryable HTTP 503 `grader_unavailable` — never a 'wrong' verdict (see
 * src/server/__tests__/grading-fail-toward-player.test.ts). This helper closes
 * that loop on the client so a player never has to manually re-tap through an
 * outage: on a transient failure (503 / any 5xx / network error) it retries with
 * backoff, reporting each retry via `onRetry`, and only escalates to the terminal
 * "try again later" message once the retries are exhausted.
 *
 * Deterministic failures (validation, auth, already-closed — any 4xx) are NOT
 * retried: they can never succeed on resubmission, so they surface immediately
 * with the server's own message.
 */

// Backoff between retries. Length + 1 = total attempts (4): one initial try
// plus three retries spanning ~8.7s, comfortably past a single grader timeout
// (8s, src/lib/llm.ts GRADE_TIMEOUT_MS) so a one-off slow grade self-heals.
export const ANSWER_RETRY_BACKOFF_MS = [1200, 2500, 5000] as const;
export const ANSWER_MAX_ATTEMPTS = ANSWER_RETRY_BACKOFF_MS.length + 1;

// Shown while we're auto-retrying — warm and reassuring, not alarming, because
// the player did nothing wrong and their answer has not been scored.
export const ANSWER_GRADER_RETRY_MESSAGE =
  "Our answer-checker is taking a quick breather — hang tight, we're trying again";

// Shown only once every retry is spent. This is the single place the player is
// asked to come back later.
export const ANSWER_RETRY_EXHAUSTED_MESSAGE =
  "We still can't reach our answer-checker. Please try again later.";

const DEFAULT_FAILURE_MESSAGE = 'Could not record that answer.';

/**
 * Thrown when submission ultimately fails. `exhausted` is true only when every
 * retry was spent on transient failures (the message is the "try again later"
 * copy); it is false for deterministic 4xx failures, which carry the server's
 * own message.
 */
export class AnswerSubmitError extends Error {
  readonly exhausted: boolean;

  constructor(message: string, options?: { exhausted?: boolean; cause?: unknown }) {
    super(message);
    this.name = 'AnswerSubmitError';
    this.exhausted = options?.exhausted ?? false;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export type AnswerRetryInfo = {
  /** The attempt about to start (2-based: the first retry is attempt 2). */
  attempt: number;
  maxAttempts: number;
};

export type SubmitAnswerOptions<T> = {
  /** JSON request body. */
  body: unknown;
  /** Narrows a parsed 2xx body to the expected success shape. */
  isSuccessBody: (body: unknown) => body is T;
  /** Maps a failure body/status to a human message (falls back to body.message). */
  resolveErrorMessage?: (body: unknown, status: number) => string | undefined;
  /** Called before each retry sleep so the UI can show progress. */
  onRetry?: (info: AnswerRetryInfo) => void;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  delayImpl?: (ms: number) => Promise<void>;
};

type Outcome = { kind: 'transient'; message: string } | { kind: 'permanent'; message: string };

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return undefined;
}

/**
 * POST an answer, retrying transient grader outages with backoff. Resolves with
 * the parsed success body, or rejects with an {@link AnswerSubmitError}.
 */
export async function submitAnswerWithRetry<T>(
  url: string,
  options: SubmitAnswerOptions<T>,
): Promise<T> {
  const fetchFn = options.fetchImpl ?? fetch;
  const delay = options.delayImpl ?? defaultDelay;

  for (let attempt = 1; attempt <= ANSWER_MAX_ATTEMPTS; attempt += 1) {
    let outcome: Outcome;

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(options.body),
        signal: options.signal,
      });
      const parsed: unknown = await response.json().catch(() => null);

      if (response.ok && options.isSuccessBody(parsed)) {
        return parsed;
      }

      const message =
        options.resolveErrorMessage?.(parsed, response.status) ??
        readMessage(parsed) ??
        DEFAULT_FAILURE_MESSAGE;

      // 5xx (including the grader's 503) is a transient outage worth retrying.
      // A 2xx with an unrecognized shape is a contract change, not an outage, so
      // it is permanent. 4xx is deterministic and never retried.
      outcome =
        response.status >= 500
          ? { kind: 'transient', message }
          : { kind: 'permanent', message };
    } catch (caught) {
      // An aborted request is intentional cancellation — propagate, don't retry.
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        throw caught;
      }
      // Network-level failure (offline, DNS, reset) — treat as a transient outage.
      outcome = { kind: 'transient', message: ANSWER_GRADER_RETRY_MESSAGE };
    }

    if (outcome.kind === 'permanent') {
      throw new AnswerSubmitError(outcome.message, { exhausted: false });
    }

    if (attempt < ANSWER_MAX_ATTEMPTS) {
      options.onRetry?.({ attempt: attempt + 1, maxAttempts: ANSWER_MAX_ATTEMPTS });
      await delay(ANSWER_RETRY_BACKOFF_MS[attempt - 1]);
    }
  }

  throw new AnswerSubmitError(ANSWER_RETRY_EXHAUSTED_MESSAGE, { exhausted: true });
}
