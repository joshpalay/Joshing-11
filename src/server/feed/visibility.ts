import { eq, or } from 'drizzle-orm';

import { assertNever } from '@/lib/assert-never';
import type { QuestionSource } from '@/lib/questions-types';
import type { feedItems, questions } from '@/server/db';

export const SOCIAL_FEED_SOURCE_TYPE = 'friend_answered' as const;
export const DIRECT_SENT_FEED_SOURCE_TYPE = 'direct_sent' as const;

// 'authored_shared' is an ACTIVE write path again: PRD v11.1 §8.2 removed the
// broadcast "share to all friends" path, but it was reintroduced in PR #254
// (2026-05-17) and now backs the "Share with all friends" checkbox in question
// creation — these rows render as the friend_added "Handwritten" envelope.
// (PRD-V11.1-AUDIT.md §2/§9/§12 predate that reintroduction and are stale.)
//
// 'thumbs_upped' is genuinely legacy-read-only: it was retired and is no longer
// written. Read queries still include it so pre-retirement rows keep rendering.

// D-1 Stage 5 (feed flip): friend_answered (type-3) is no longer rendered in the
// feed. It is still WRITTEN by create-feed-items-for-answer.ts — it remains the
// source signal for Daily Five +2 and the profile "Recently exploring" presence —
// but the feed surfaces collapse to Broadcasts (authored_shared + legacy
// thumbs_upped) and Sent (direct_sent). SOCIAL_FEED_SOURCE_TYPE is kept above for
// the write path and the daily bonus-slot picker; it is intentionally absent here.
export const ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES = [
  'authored_shared',
  DIRECT_SENT_FEED_SOURCE_TYPE,
  'thumbs_upped',
] as const;

export const QUESTION_SHARING_FEED_SOURCE_VISIBILITY = [
  { sourceType: 'authored_shared' as const, sourceResult: null, visible: true, reason: null },
  { sourceType: DIRECT_SENT_FEED_SOURCE_TYPE, sourceResult: null, visible: true, reason: null },
] as const;

const SUPPRESSED_CATEGORY_LABELS = new Set(['other', 'uncategorized', 'unknown', 'general', 'general knowledge']);

type QuestionLike = Pick<typeof questions.$inferSelect, 'creatorId' | 'source' | 'visibility' | 'canonicalSubcategory' | 'broadCategory' | 'category' | 'deletedAt'>;
type FeedItemsVisibilityColumns = Pick<typeof feedItems, 'sourceType'>;

export type FeedEventEligibilityInput = {
  answerIsCorrect: boolean;
  answererUserId: string;
  question: Pick<QuestionLike, 'creatorId' | 'source' | 'visibility' | 'deletedAt'> | null | undefined;
  hasVisibleSocialContext: boolean;
};

// LLM-origin questions have no human author. Both daily-generated questions and
// curated sends ('curated_sent', written by /api/questions/send) carry a null
// creatorId, so feed eligibility for their correct answers can't be keyed on
// authorship — they are always eligible (subject to the checks above).
//
// Exhaustive over QuestionSource so a new source value (e.g. D-3's
// 'house_authored') cannot compile until its feed-origin status is decided here.
// 'house_authored' is deliberately NOT LLM-origin (it is curated/editorial, and
// per D-3 §C house content never enters the Feed) — it returns false, and
// isCorrectAnswerFeedEligible then rejects it via the null-creatorId guard.
export function isLlmOriginQuestion(source: QuestionSource): boolean {
  switch (source) {
    case 'daily_generated':
    case 'curated_sent':
      return true;
    case 'authored':
    case 'house_authored':
      return false;
    default:
      return assertNever(source, 'Question.source');
  }
}

export function isCorrectAnswerFeedEligible(input: FeedEventEligibilityInput): boolean {
  if (!input.answerIsCorrect) return false;
  if (!input.hasVisibleSocialContext) return false;
  if (!input.question) return false;
  if (input.question.deletedAt) return false;
  if (input.question.visibility !== 'public') return false;
  if (isLlmOriginQuestion(input.question.source)) return true;
  if (!input.question.creatorId) return false;
  return input.answererUserId !== input.question.creatorId;
}

export function isMainFeedSourceVisible(sourceType: string): boolean {
  return (ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES as readonly string[]).includes(sourceType);
}

export function visibleFeedSourcePredicate(feedItemColumns: FeedItemsVisibilityColumns) {
  return or(
    eq(feedItemColumns.sourceType, 'authored_shared'), // active: friend_added envelope
    eq(feedItemColumns.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE),
    eq(feedItemColumns.sourceType, 'thumbs_upped'), // legacy-read-only
  );
}

export function socialFeedDomainLabel(question: Pick<QuestionLike, 'canonicalSubcategory' | 'broadCategory' | 'category'> | null | undefined): string | null {
  const candidates = [question?.canonicalSubcategory, question?.broadCategory, question?.category];
  for (const candidate of candidates) {
    const label = typeof candidate === 'string' ? candidate.trim() : '';
    if (!label) continue;
    if (SUPPRESSED_CATEGORY_LABELS.has(label.toLowerCase())) continue;
    return label;
  }
  return null;
}
