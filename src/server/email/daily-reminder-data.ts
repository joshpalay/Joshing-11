/**
 * Pure data shaping for the daily reminder email. NO database imports — the cron
 * route (src/app/api/cron/daily-assignments/route.ts) runs the queries and feeds
 * the results here, which keeps these transforms unit-testable without a DB and
 * keeps the email template (daily-reminder.ts) presentational.
 */

import type { ActivityItemView } from '@/server/db/queries/activity';
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

function actorName(view: ActivityItemView): string {
  return view.actor?.displayName?.trim() || 'A friend';
}

/**
 * The email's MEANWHILE section: at most three quiet, people-first one-liners
 * drawn from the viewer's recent home-eligible activity. The input is expected to
 * already be filtered to HOME_TOP3_ELIGIBLE_TYPES (e.g. via
 * getRecentActivityForHome). Viewer-own broadcasts (authored_question_shared) are
 * dropped here because the section is meant to read as "people did something with
 * your stuff", not "here's what you did". Returns plain sentences, never markup.
 */
export function formatActivityForEmail(views: ActivityItemView[]): string[] {
  const out: string[] = [];
  for (const view of views) {
    const line = activityLine(view);
    if (line) out.push(line);
    if (out.length === 3) break;
  }
  return out;
}

function activityLine(view: ActivityItemView): string | null {
  const name = actorName(view);
  switch (view.type) {
    case 'friend_answered_your_question':
      return `${name} answered one of your questions.`;
    case 'reaction_received':
      return `${name} reacted to your answer.`;
    case 'received_direct_question':
      return `${name} sent you a question.`;
    case 'question_curated':
      return `${name} saved one of your questions.`;
    case 'friend_mastery': {
      const domain = view.reference.masteryEvent?.domain?.trim();
      return domain ? `${name} went deep on ${domain}.` : `${name} made progress in a new area.`;
    }
    case 'declared_promoted': {
      const domain = view.reference.declaredPromoted?.domain?.trim();
      return domain ? `${name} opened ${domain}.` : `${name} opened a new area.`;
    }
    // authored_question_shared and anything else: viewer-own or not a people-first
    // invitation back into the product — leave it out of the email.
    default:
      return null;
  }
}
