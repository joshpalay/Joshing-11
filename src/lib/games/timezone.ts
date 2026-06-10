/**
 * Daily reset helpers — Wordle-style fixed UTC cutoff.
 * The "day" runs from 17:00 UTC to the next 17:00 UTC. All players worldwide
 * share the same daily window; UI formats that instant in each viewer's local
 * timezone (see `formatNextResetTimeLocal`).
 */

import { DAILY_RESET_HOUR_UTC } from '@/lib/game-constants';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return today's date as a YYYY-MM-DD string in the given IANA timezone.
 * Used for per-player daily budget resets (e.g. star votes).
 */
export function getTodayInTimezone(timezone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

/**
 * Return the assignment bounds for the current daily window.
 *
 * assignment_date — the calendar date (UTC) of the noon EST that opened this window.
 * expiresAt       — the UTC Date of the next noon EST (when this window closes).
 *
 * Example (DAILY_RESET_HOUR_UTC = 17):
 *   10:00 UTC on Mar 17  →  window opened at 17:00 UTC Mar 16  →  expires 17:00 UTC Mar 17
 *   20:00 UTC on Mar 17  →  window opened at 17:00 UTC Mar 17  →  expires 17:00 UTC Mar 18
 */
export function getDailyAssignmentBounds(): {
  assignmentDateStr: string;
  assignmentDate: Date;
  expiresAt: Date;
} {
  const now = new Date();

  // The most recent reset: today at DAILY_RESET_HOUR_UTC UTC
  const todayReset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    DAILY_RESET_HOUR_UTC, 0, 0, 0
  ));

  let windowStart: Date;
  let expiresAt: Date;

  if (now >= todayReset) {
    // Past today's reset — current window started today
    windowStart = todayReset;
    expiresAt = new Date(todayReset.getTime() + ONE_DAY_MS);
  } else {
    // Before today's reset — current window started yesterday
    windowStart = new Date(todayReset.getTime() - ONE_DAY_MS);
    expiresAt = todayReset;
  }

  // assignmentDate is the UTC calendar date of the window start
  const y = windowStart.getUTCFullYear();
  const m = String(windowStart.getUTCMonth() + 1).padStart(2, '0');
  const d = String(windowStart.getUTCDate()).padStart(2, '0');
  const assignmentDateStr = `${y}-${m}-${d}`;
  const assignmentDate = new Date(Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate()
  ));

  return { assignmentDateStr, assignmentDate, expiresAt };
}

/**
 * Return the UTC timestamp for the next global daily reset boundary.
 * If now is exactly on the boundary, "next" means 24h later.
 */
export function getNextDailyResetBoundary(from: Date = new Date()): Date {
  const todayReset = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    DAILY_RESET_HOUR_UTC, 0, 0, 0
  ));

  if (from < todayReset) return todayReset;
  return new Date(todayReset.getTime() + ONE_DAY_MS);
}

/**
 * Milliseconds remaining until the next global daily reset boundary.
 */
export function getMsUntilNextDailyResetBoundary(from: Date = new Date()): number {
  return Math.max(0, getNextDailyResetBoundary(from).getTime() - from.getTime());
}

/**
 * Format the next daily reset boundary as a wall-clock time string in the
 * viewer's local timezone. Falls back to the browser's resolved zone when none
 * is passed. Examples: "1 PM" (Eastern DST), "10 AM" (Pacific DST),
 * "10:30 PM" (India). On-the-hour minutes are dropped for readability.
 */
export function formatNextResetTimeLocal(
  timezone?: string,
  from: Date = new Date(),
): string {
  const next = getNextDailyResetBoundary(from);
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  }).formatToParts(next);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return minute === '00' ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

/**
 * Return the day the next daily reset boundary falls on, relative to the
 * viewer's local timezone: "today", "tomorrow", or — should the boundary ever
 * be further out — the weekday name like "Wednesday" (a proper noun, so it
 * stays capitalized; "today"/"tomorrow" are lowercase for mid-sentence use).
 *
 * The boundary is always within 24h, so in practice it resolves to "today" or
 * "tomorrow"; the weekday fallback exists so the label is never wrong if the
 * window math ever changes. This replaces hardcoded "tomorrow" copy, which was
 * incorrect whenever the next reset fell later on the current local day.
 */
export function getNextResetDayLabelLocal(
  timezone?: string,
  from: Date = new Date(),
): 'today' | 'tomorrow' | string {
  const next = getNextDailyResetBoundary(from);
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Compare local calendar days (YYYY-MM-DD) between now and the reset boundary.
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const resetKey = dayFormatter.format(next);

  if (resetKey === dayFormatter.format(from)) return 'today';

  const tomorrow = new Date(from.getTime() + ONE_DAY_MS);
  if (resetKey === dayFormatter.format(tomorrow)) return 'tomorrow';

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: tz,
  }).format(next);
}

/**
 * Format the next daily reset boundary as a day-aware label in the viewer's
 * local timezone, e.g. "today at 1 PM", "tomorrow at 1 PM", or — when the
 * boundary is further out — the weekday name like "wednesday at 1 PM".
 */
export function formatNextResetDayTimeLocal(
  timezone?: string,
  from: Date = new Date(),
): string {
  const day = getNextResetDayLabelLocal(timezone, from);
  const time = formatNextResetTimeLocal(timezone, from);
  return `${day} at ${time}`;
}
