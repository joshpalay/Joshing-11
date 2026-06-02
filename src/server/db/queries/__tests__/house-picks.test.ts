import { describe, expect, it } from 'vitest';

import {
  buildHouseSlot,
  selectHousePicks,
  type HouseCandidateRow,
  type HousePick,
} from '@/server/db/queries/daily';
import { isCorrectAnswerFeedEligible } from '@/server/feed/visibility';
import { HOUSE_AUTHOR } from '@/lib/questions-types';

let seq = 0;
function candidate(over: Partial<HouseCandidateRow> = {}): HouseCandidateRow {
  seq += 1;
  return {
    id: `house-${seq}`,
    questionText: `House question ${seq}`,
    answerText: `Answer ${seq}`,
    alternateAnswers: [],
    factualExplanation: null,
    canonicalSubcategory: 'Bowie-era Glam Rock',
    broadCategory: 'music',
    category: 'music',
    difficultyEstimate: 'moderate',
    creatorNote: null,
    createdAt: new Date(2026, 0, seq + 1),
    ...over,
  };
}

describe('selectHousePicks (domain-matched, deduped — not +2 relevance ranking)', () => {
  it('drops questions the viewer has already seen', () => {
    const rows = [candidate({ id: 'seen-1' }), candidate({ id: 'fresh-1' })];
    const picks = selectHousePicks(rows, new Set(['seen-1']), 5);
    expect(picks.map((p) => p.id)).toEqual(['fresh-1']);
  });

  it('drops generic bucket domains', () => {
    const rows = [
      candidate({ id: 'generic', canonicalSubcategory: 'general' }),
      candidate({ id: 'specific', canonicalSubcategory: 'Bowie-era Glam Rock' }),
    ];
    const picks = selectHousePicks(rows, new Set(), 5);
    expect(picks.map((p) => p.id)).toEqual(['specific']);
  });

  it('prefers newest curated content and caps at the limit', () => {
    const older = candidate({ id: 'older', createdAt: new Date(2026, 0, 1) });
    const newer = candidate({ id: 'newer', createdAt: new Date(2026, 5, 1) });
    const picks = selectHousePicks([older, newer], new Set(), 1);
    expect(picks.map((p) => p.id)).toEqual(['newer']);
  });

  it('returns nothing when the limit is zero or negative', () => {
    expect(selectHousePicks([candidate()], new Set(), 0)).toEqual([]);
  });
});

describe('buildHouseSlot (Daily core slot, never a +2 bonus, never a users row)', () => {
  const pick: HousePick = {
    id: 'house-q-1',
    questionText: 'Who produced Low (1977)?',
    answerText: 'Tony Visconti & David Bowie',
    alternateAnswers: [],
    factualExplanation: null,
    canonicalSubcategory: 'Bowie-era Glam Rock',
    broadCategory: 'music',
    category: 'music',
    difficultyEstimate: 'specialist',
    authorNote: null,
  };

  it('labels the slot as house with the Joshing name and a canonical question id', () => {
    const slot = buildHouseSlot(pick, 2);
    expect(slot.source).toBe('house');
    expect(slot.question_id).toBe('house-q-1');
    expect(slot.author_name).toBe(HOUSE_AUTHOR.displayName);
    expect(slot.difficulty_estimate).toBe('specialist');
    expect(slot.slot_index).toBe(2);
  });

  it('never carries a users.id author_id (Invariant H-1)', () => {
    const slot = buildHouseSlot(pick, 0);
    expect(slot.author_id).toBeUndefined();
  });

  it('never carries answerer_* fields, so it can never be mistaken for a +2 bonus slot', () => {
    const slot = buildHouseSlot(pick, 0);
    expect(slot.answerer_id).toBeUndefined();
    expect(slot.answerer_name).toBeUndefined();
  });
});

describe('house questions never enter the Feed (documented isLlmOriginQuestion branch)', () => {
  it('is not feed-eligible on a correct answer (null creatorId, non-LLM origin)', () => {
    // This is the upstream gate in create-feed-items-for-answer.ts that runs
    // before BOTH the friend fan-out and the +2 bonus source (friend_answered
    // feed items). House being feed-ineligible is therefore what keeps it out of
    // the Feed AND out of every +2 bonus slot.
    expect(isCorrectAnswerFeedEligible({
      answerIsCorrect: true,
      answererUserId: 'viewer-1',
      question: {
        creatorId: null,
        source: 'house_authored',
        visibility: 'public',
        deletedAt: null,
      },
      hasVisibleSocialContext: true,
    })).toBe(false);
  });
});
