import { describe, expect, it } from 'vitest';

import {
  QUESTION_SHARING_FEED_SOURCE_VISIBILITY,
  isCorrectAnswerFeedEligible,
  isLlmOriginQuestion,
  isMainFeedSourceVisible,
  socialFeedDomainLabel,
} from '@/server/feed/visibility';

const publicQuestion = {
  creatorId: 'author-1',
  source: 'authored' as const,
  visibility: 'public' as const,
  deletedAt: null,
};

describe('correct-answer social feed eligibility', () => {
  it('allows authored and direct-sent sharing but rejects game-publication sources from the main feed', () => {
    expect(isMainFeedSourceVisible('authored_shared')).toBe(true);
    expect(isMainFeedSourceVisible('joshing_game')).toBe(false);
    expect(isMainFeedSourceVisible('direct_sent')).toBe(true);
    expect(isMainFeedSourceVisible('thumbs_upped')).toBe(true);
  });

  it('still flags a correct non-author answer as feed-eligible (the type-3 WRITE survives Stage 5) but no longer renders it', () => {
    // The write path (Daily +2, presence) still depends on this eligibility check.
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'answerer-1',
      question: publicQuestion,
      hasVisibleSocialContext: true,
    })).toBe(true);
    // D-1 Stage 5: friend_answered is no longer rendered in the feed.
    expect(isMainFeedSourceVisible('friend_answered')).toBe(false);
  });

  it('allows public daily-generated questions without an author to propagate correct friend answers', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'answerer-1',
      question: {
        creatorId: null,
        source: 'daily_generated' as const,
        visibility: 'public' as const,
        deletedAt: null,
      },
      hasVisibleSocialContext: true,
    })).toBe(true);
  });

  it('allows public curated-sent (forwarded LLM) questions without an author to propagate correct friend answers', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'answerer-1',
      question: {
        creatorId: null,
        source: 'curated_sent' as const,
        visibility: 'public' as const,
        deletedAt: null,
      },
      hasVisibleSocialContext: true,
    })).toBe(true);
  });

  it('rejects wrong answers to curated-sent questions', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: false,
      answererUserId: 'answerer-1',
      question: {
        creatorId: null,
        source: 'curated_sent' as const,
        visibility: 'public' as const,
        deletedAt: null,
      },
      hasVisibleSocialContext: true,
    })).toBe(false);
  });

  it('classifies LLM-origin sources', () => {
    expect(isLlmOriginQuestion('daily_generated')).toBe(true);
    expect(isLlmOriginQuestion('curated_sent')).toBe(true);
    expect(isLlmOriginQuestion('authored')).toBe(false);
  });

  it('rejects a correct answer by the author', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'author-1',
      question: publicQuestion,
      hasVisibleSocialContext: true,
    })).toBe(false);
  });

  it('rejects wrong answers', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: false,
      answererUserId: 'answerer-1',
      question: publicQuestion,
      hasVisibleSocialContext: true,
    })).toBe(false);
    expect(isMainFeedSourceVisible('friend_answered')).toBe(false);
  });

  it('rejects private or non-visible questions for unauthorized viewers', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'answerer-1',
      question: { ...publicQuestion, visibility: 'private' as const },
      hasVisibleSocialContext: true,
    })).toBe(false);
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'answerer-1',
      question: publicQuestion,
      hasVisibleSocialContext: false,
    })).toBe(false);
  });

  it('documents visibility for every source type still rendered in the feed', () => {
    // D-1 Stage 5: friend_answered is intentionally absent — it is written but
    // not rendered. Broadcasts/Sent surfaces render authored_shared + direct_sent.
    expect(QUESTION_SHARING_FEED_SOURCE_VISIBILITY).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'authored_shared' }),
      expect.objectContaining({ sourceType: 'direct_sent' }),
    ]));
    expect(
      QUESTION_SHARING_FEED_SOURCE_VISIBILITY.some((entry) => entry.sourceType === 'friend_answered'),
    ).toBe(false);

    for (const { sourceType, visible, reason } of QUESTION_SHARING_FEED_SOURCE_VISIBILITY) {
      expect(isMainFeedSourceVisible(sourceType)).toBe(visible);
      if (visible) {
        expect(reason).toBeNull();
      } else {
        expect(reason).toEqual(expect.any(String));
        expect(reason?.length).toBeGreaterThan(0);
      }
    }
  });

  it('suppresses forbidden fallback categories on feed cards', () => {
    expect(socialFeedDomainLabel({ canonicalSubcategory: 'Other', broadCategory: 'Uncategorized', category: 'Unknown' })).toBeNull();
    expect(socialFeedDomainLabel({ canonicalSubcategory: ' ', broadCategory: 'Bowie-era Glam Rock', category: 'Unknown' })).toBe('Bowie-era Glam Rock');
  });
});
