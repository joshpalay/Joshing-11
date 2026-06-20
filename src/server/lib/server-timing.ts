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
  /**
   * Span durations as a `${name}_ms` → ms map, for structured logging. The
   * `_ms` suffix matches the `[daily/answer timings]` convention so every perf
   * log reads uniformly (`{ feed_ms, total_ms, … }`).
   */
  toMetrics: () => Record<string, number>;
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
    toMetrics() {
      const metrics: Record<string, number> = {};
      for (const s of spans) metrics[`${s.name}_ms`] = s.dur;
      return metrics;
    },
  };
}

/**
 * Emit one structured, grep-able `[perf]` log line per request so per-route
 * durations are queryable from Vercel function logs (B-PERF-04). The
 * `Server-Timing` *header* only reaches the browser Network panel and never
 * appears in function logs, so it cannot back the §12.6 p50/p95 table on its
 * own. One consistent shape — `[perf] { route, …_ms, … }` — across every §12.6
 * surface lets a log drain aggregate percentiles per `route`.
 *
 * Telemetry only: logging never throws and never alters a response.
 */
export function logServerTiming(
  route: string,
  timing: ServerTiming,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  try {
    console.info('[perf]', { route, ...timing.toMetrics(), ...extra });
  } catch {
    // telemetry only — swallow
  }
}

/**
 * Time an awaited unit of server work and emit its `[perf]` line (B-PERF-04).
 * Intended for React Server Components — calling `Date.now()` directly in a
 * component render trips the `react-hooks/purity` lint, so the stamps live here
 * in a plain module function rather than in the component body. The span is
 * recorded even when `work` rejects, then the error re-throws unchanged.
 */
export async function timeServerWork<T>(
  route: string,
  span: string,
  work: () => Promise<T>,
  extra?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    const timing = createServerTiming();
    timing.measure(span, startedAt);
    logServerTiming(route, timing, extra);
  }
}
