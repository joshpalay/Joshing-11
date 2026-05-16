import { and, eq, or } from 'drizzle-orm';

import type { feedItems, questions } from '@/server/db';

export const SOCIAL_FEED_SOURCE_TYPE = 'friend_answered' as const;
export const DIRECT_SENT_FEED_SOURCE_TYPE = 'direct_sent' as const;

// 'authored_shared' and 'thumbs_upped' are legacy-read-only source types.
// PRD v11.1 §8.2 killed authored_shared as a write path. thumbs_upped was
// retired earlier. Both values may still exist in DB rows written before those
// decisions; read queries include them for legacy support only. Do not write
// new rows with these sourceType values.

export const ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES = [
  'authored_shared',
  DIRECT_SENT_FEED_SOURCE_TYPE,
  'thumbs_upped',
] as const;

export const RESULT_GATED_MAIN_FEED_SOURCE_TYPES = {
  [SOCIAL_FEED_SOURCE_TYPE]: ['correct'],
} as const;

export const QUESTION_SHARING_FEED_SOURCE_VISIBILITY = [
  { sourceType: 'authored_shared' as const, sourceResult: null, visible: true, reason: null },
  { sourceType: DIRECT_SENT_FEED_SOURCE_TYPE, sourceResult: null, visible: true, reason: null },
  { sourceType: SOCIAL_FEED_SOURCE_TYPE, sourceResult: 'correct', visible: true, reason: null },
  {
    sourceType: SOCIAL_FEED_SOURCE_TYPE,
    sourceResult: 'incorrect',
    visible: false,
    reason: 'Incorrect answer shares are intentionally excluded so the main feed only amplifies successful friend activity.',
  },
] as const;

const SUPPRESSED_CATEGORY_LABELS = new Set(['other', 'uncategorized', 'unknown', 'general', 'general knowledge']);

type QuestionLike = Pick<typeof questions.$inferSelect, 'creatorId' | 'source' | 'visibility' | 'canonicalSubcategory' | 'broadCategory' | 'category' | 'deletedAt'>;
type FeedItemsVisibilityColumns = Pick<typeof feedItems, 'sourceType' | 'sourceResult'>;

export type FeedEventEligibilityInput = {
  answerIsCorrect: boolean;
  answererUserId: string;
  question: Pick<QuestionLike, 'creatorId' | 'source' | 'visibility' | 'deletedAt'> | null | undefined;
  hasVisibleSocialContext: boolean;
};

export function isCorrectAnswerFeedEligible(input: FeedEventEligibilityInput): boolean {
  if (!input.answerIsCorrect) return false;
  if (!input.hasVisibleSocialContext) return false;
  if (!input.question) return false;
  if (input.question.deletedAt) return false;
  if (input.question.visibility !== 'public') return false;
  if (input.question.source === 'daily_generated') return true;
  if (!input.question.creatorId) return false;
  return input.answererUserId !== input.question.creatorId;
}

export function isVisibleFriendAnsweredSource(sourceType: string, sourceResult: string | null): boolean {
  return sourceType === SOCIAL_FEED_SOURCE_TYPE
    && (RESULT_GATED_MAIN_FEED_SOURCE_TYPES[SOCIAL_FEED_SOURCE_TYPE] as readonly string[]).includes(sourceResult ?? '');
}

export function isMainFeedSourceVisible(sourceType: string, sourceResult: string | null): boolean {
  if ((ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES as readonly string[]).includes(sourceType)) return true;
  return isVisibleFriendAnsweredSource(sourceType, sourceResult);
}

export function visibleFeedSourcePredicate(feedItemColumns: FeedItemsVisibilityColumns) {
  return or(
    eq(feedItemColumns.sourceType, 'authored_shared'), // legacy-read-only
    eq(feedItemColumns.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE),
    eq(feedItemColumns.sourceType, 'thumbs_upped'), // legacy-read-only
    and(
      eq(feedItemColumns.sourceType, SOCIAL_FEED_SOURCE_TYPE),
      eq(feedItemColumns.sourceResult, 'correct'),
    ),
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
