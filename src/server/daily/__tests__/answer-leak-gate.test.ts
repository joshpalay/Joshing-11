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

  it('drops an article-led answer whose bare noun is named in the question (episode-title leak)', () => {
    // Both played in a duo today: the question names the episode title, which is
    // the answer. "A box cutter" / "A fly" never substring-match because of the
    // leading article — the gate must strip it and catch the bare noun.
    const result = findAnswerLeaks([
      q(
        "In the episode 'Box Cutter,' Gus Fring silently kills one of his own men to send Walter and Jesse a message. What does he use as the murder weapon?",
        'A box cutter',
      ),
      q(
        "In the episode 'Fly,' Walt and Jesse spend an entire episode trapped together in the superlab chasing a single intruder. What is it?",
        'A fly',
      ),
    ]);
    expect([...result.toDrop].sort()).toEqual([0, 1]);
  });

  it('drops an answer whose acronym short form is shown in the question (UX-design leak)', () => {
    // Reported 2026-07-15: the answer spells out an acronym the stem already
    // shows in short form. "User Experience (UX) design" collapses to "UX
    // design", which is verbatim in the stem — the whole-answer substring test
    // missed it because the stem never contains the expansion "User Experience".
    const result = findAnswerLeaks([
      q(
        "In UX design, what term refers to the overall process of researching, designing, and improving the quality of a user's interaction with a product or service?",
        'User Experience (UX) design',
      ),
    ]);
    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('User Experience (UX) design');
  });

  it('keeps an acronym-expansion answer whose short form is NOT in the question', () => {
    // Same answer shape, but the stem never shows "UX design", so nothing leaks.
    const result = findAnswerLeaks([
      q(
        'What field studies how people perceive, feel about, and interact with products they use?',
        'User Experience (UX) design',
      ),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps a "what does the acronym stand for" question whose stem must show the acronym', () => {
    // The acronym-collapse must NOT fire on bare-acronym expansions: a define-
    // the-acronym question necessarily shows the acronym, and its answer is the
    // expansion. Dropping these would delete a whole legitimate question type.
    const result = findAnswerLeaks([
      q('What does GPU stand for in computer hardware?', 'Graphics Processing Unit (GPU)'),
      q('In finance, what does the acronym ROI represent?', 'Return on Investment (ROI)'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps an initials-identification question even when the stem contains the initials', () => {
    // "Franklin D. Roosevelt (FDR)" collapses to the bare acronym "FDR". Even
    // though the stem says "FDR", that is the SUBJECT being identified, not a
    // leak — the answer is the full name. Must be kept.
    const result = findAnswerLeaks([
      q('Which U.S. president is commonly referred to by the initials FDR?', 'Franklin D. Roosevelt (FDR)'),
    ]);
    expect(result.toDrop.size).toBe(0);
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
