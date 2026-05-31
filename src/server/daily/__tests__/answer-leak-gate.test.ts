import { beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. findAnswerLeaks never touches the DB; a dummy
// URL plus dynamic import (the repo convention) keeps the unit pure.
let findAnswerLeaks: typeof import('@/server/daily/generate-questions').findAnswerLeaks;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findAnswerLeaks } = await import('@/server/daily/generate-questions'));
});

// Minimal stand-in for the LlmQuestion shape findAnswerLeaks reads. Only
// question_text and answer are inspected; the rest satisfy the type.
function q(question_text: string, answer: string) {
  return {
    canonical_subcategory: 'User Experience Design',
    broad_category: 'Design',
    question_text,
    answer,
    explainer: '',
    difficulty_estimate: 'moderate' as const,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

describe('findAnswerLeaks', () => {
  it('drops the reported case where the answer appears in the question text', () => {
    const result = findAnswerLeaks([
      q(
        'In UX design, what term describes the mental model a user forms about how a system works?',
        'Mental model',
      ),
    ]);
    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('Mental model');
  });

  it('keeps a clean question whose answer is absent from the setup', () => {
    const result = findAnswerLeaks([
      q('What cognitive bias makes recent information feel more important?', 'Recency bias'),
    ]);
    expect(result.toDrop.size).toBe(0);
    expect(result.reasons).toEqual({});
  });

  it('keeps a complete-the-quote question where the answer is the missing word', () => {
    const result = findAnswerLeaks([
      q('Complete the design maxim: "Don\'t make me ___."', 'think'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('only flags the leaking entries within a mixed batch', () => {
    const result = findAnswerLeaks([
      q('Which Gestalt principle groups nearby elements together?', 'Proximity'),
      q('What is the heuristic about keeping users informed of system status?', 'System status'),
      q('What pricing tactic ends prices in .99?', 'Charm pricing'),
    ]);
    expect([...result.toDrop].sort()).toEqual([1]);
  });

  it('does not flag short answers below the leak-check token threshold', () => {
    // "UI" normalizes to length 2 (< MIN_ANSWER_TOKEN_LENGTH = 3), so
    // textContainsAnswer ignores it even though it appears in the text.
    const result = findAnswerLeaks([
      q('What two-letter abbreviation refers to UI in product work?', 'UI'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });
});
