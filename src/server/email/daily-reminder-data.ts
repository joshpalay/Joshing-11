/**
 * Pure data shaping for the daily reminder email. NO database imports — the cron
 * route (src/app/api/cron/daily-assignments/route.ts) runs the queries and feeds
 * the results here, which keeps these transforms unit-testable without a DB and
 * keeps the email template (daily-reminder.ts) presentational.
 */

import type { QueueSlot } from '@/server/daily/types';

/**
 * Today's five topic/domain labels for the email's TODAY section: the canonical
 * `domain` of each unanswered, non-skipped slot, trimmed, de-duplicated (order
 * preserved), capped at five. An empty result lets the template fall back to the
 * generic "Today's five are ready." line.
 */
export function topicsForReminder(slots: QueueSlot[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slot.answered || slot.skipped) continue;
    const domain = slot.domain?.trim();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length === 5) break;
  }
  return out;
}
