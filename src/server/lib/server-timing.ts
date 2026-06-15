/**
 * Minimal Server-Timing accumulator (B-PERF-04).
 *
 * Mirrors the format the edge proxy already emits (`proxy;dur=<ms>`, see
 * `src/proxy.ts`) so per-route server duration shows up in the DevTools Network
 * panel and Vercel function logs alongside the proxy span. Multiple spans
 * serialize to one comma-separated header value, e.g. `queue;dur=12, total;dur=20`.
 *
 * Observational only: building or serializing timings never alters a response
 * body or status — callers set the resulting string as a `Server-Timing`
 * response header, exactly as the proxy does.
 *
 * Usage:
 *   const timing = createServerTiming();
 *   const startedAt = Date.now();
 *   // ... work ...
 *   timing.measure('queue', startedAt);
 *   res.headers.set('Server-Timing', timing.toHeader());
 */
export type ServerTiming = {
  /** Record span `name` lasting from `startedAt` (a `Date.now()` stamp) to now. */
  measure: (name: string, startedAt: number) => void;
  /** Record span `name` with an explicit duration in ms (e.g. from existing marks). */
  add: (name: string, durationMs: number) => void;
  /** Serialize to a `Server-Timing` header value. Empty string when no spans recorded. */
  toHeader: () => string;
};

export function createServerTiming(): ServerTiming {
  const spans: Array<{ name: string; dur: number }> = [];
  return {
    measure(name, startedAt) {
      spans.push({ name, dur: Math.max(0, Date.now() - startedAt) });
    },
    add(name, durationMs) {
      spans.push({ name, dur: Math.max(0, Math.round(durationMs)) });
    },
    toHeader() {
      return spans.map((s) => `${s.name};dur=${s.dur}`).join(', ');
    },
  };
}
