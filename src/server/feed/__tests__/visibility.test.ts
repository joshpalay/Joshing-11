import { describe, expect, it } from 'vitest';

import { isCorrectAnswerFeedEligible, isMainFeedSourceVisible, socialFeedDomainLabel } from '@/server/feed/visibility';

const publicQuestion = {
  creatorId: 'author-1',
  visibility: 'public' as const,
  deletedAt: null,
};

describe('correct-answer social feed eligibility', () => {
  it('rejects newly-created/authored feed sources and game-publication sources from the main feed', () => {
    expect(isMainFeedSourceVisible('authored_shared', null)).toBe(false);
    expect(isMainFeedSourceVisible('joshing_game', null)).toBe(false);
    expect(isMainFeedSourceVisible('direct_sent', null)).toBe(false);
  });

  it('allows a correct answer by someone other than the author in a visible social context', () => {
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'answerer-1',
      question: publicQuestion,
      hasVisibleSocialContext: true,
    })).toBe(true);
    expect(isMainFeedSourceVisible('friend_answered', 'correct')).toBe(true);
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
    expect(isMainFeedSourceVisible('friend_answered', 'incorrect')).toBe(false);
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

  it('suppresses forbidden fallback categories on feed cards', () => {
    expect(socialFeedDomainLabel({ canonicalSubcategory: 'Other', broadCategory: 'Uncategorized', category: 'Unknown' })).toBeNull();
    expect(socialFeedDomainLabel({ canonicalSubcategory: ' ', broadCategory: 'Bowie-era Glam Rock', category: 'Unknown' })).toBe('Bowie-era Glam Rock');
  });
});
