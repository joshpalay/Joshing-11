import { beforeAll, describe, expect, it } from 'vitest';

// Cover for the bank RE-SERVE gate. Every other gate in this module runs only
// on freshly generated questions; pickBankSource clones existing stock straight
// into the queue, which is how a Joyce-under-Woolf row from 2026-05-09 and a
// self-answering onion/tears row from 2026-08-21 were both re-served on
// 2026-09-06 without passing through anything.
//
// Same dynamic-import dance as answer-leak-gate.test.ts: generate-questions.ts
// imports @/server/db, which throws at module load without a connection string.
let findBankSourceDefect: typeof import('@/server/daily/generate-questions').findBankSourceDefect;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findBankSourceDefect } = await import('@/server/daily/generate-questions'));
});

describe('findBankSourceDefect', () => {
  it('rejects a bank row whose stem contains its own answer', () => {
    // Real row from the live bank (Tennis Fundamentals) — the stem says "six
    // games all and a tiebreak is about to begin" and the answer is the same words.
    const defect = findBankSourceDefect({
      questionText:
        'In tennis, when a player wins the final point of a set to reach six games all and a tiebreak is about to begin, what score is typically announced?',
      answer: 'Six all — tiebreak',
    });
    expect(defect).toContain('appears in question text');
  });

  it('rejects a bank row whose answer is a sentence rather than one clean answer', () => {
    // Real row (Wagner's Ring Cycle), 172 chars of narration.
    const defect = findBankSourceDefect({
      questionText:
        "In 'Götterdämmerung,' Waltraute makes a desperate journey to beg Brünnhilde to give up the ring. What does she report about Wotan?",
      answer:
        "Wotan sits silent and brooding, his spear shattered, surrounded by the gods; if Brünnhilde returns the ring to the Rhinemaidens, the curse will be lifted and the gods saved",
    });
    expect(defect).toContain('one clean answer');
  });

  it('checks acceptable_variants too, not just the primary answer', () => {
    // "Daily Scrum" is the variant that leaks — the stem opens "In Scrum,".
    const defect = findBankSourceDefect({
      questionText:
        'In Scrum, what is the name of the brief daily team meeting, typically time-boxed to fifteen minutes?',
      answer: 'Daily standup',
      acceptableVariants: ['Daily Scrum'],
    });
    expect(defect).toContain('appears in question text');
  });

  it('passes a clean bank row through untouched', () => {
    expect(
      findBankSourceDefect({
        questionText:
          "In Star Trek: The Next Generation, what is the name of Captain Picard's civilian brother, whom he visits at the family vineyard in France?",
        answer: 'Robert Picard',
      }),
    ).toBeNull();
  });

  it('honours PARTIAL_ANSWER_LEAK_ENABLED, matching the generation path', () => {
    // One flag governs both paths on purpose: a rule not trusted to drop at
    // generation time is not trusted to reject a re-serve either.
    const row = {
      questionText:
        "In 'Last Exit to Springfield,' Homer becomes a union negotiator. What specific dental benefit are the workers fighting to keep?",
      answer: 'Dental plan',
    };
    delete process.env.PARTIAL_ANSWER_LEAK_ENABLED;
    expect(findBankSourceDefect(row)).toBeNull();
    process.env.PARTIAL_ANSWER_LEAK_ENABLED = 'true';
    try {
      expect(findBankSourceDefect(row)).toContain('gives away answer');
    } finally {
      delete process.env.PARTIAL_ANSWER_LEAK_ENABLED;
    }
  });

  it('does NOT catch the semantic defects — that is the sweep script’s job', () => {
    // Documenting the limitation deliberately. Both of these were re-served in
    // production on 2026-09-06 and both pass every deterministic check: the
    // leak is "crying"→"Tears" and "1920 + women voting"→"Nineteenth
    // Amendment", neither of which shares a token with its answer. Only the
    // Haiku quality gate reaches these, which is why fix 1 (this gate) and fix
    // 2 (scripts/sweep-bank-quality.ts) are complementary, not alternatives.
    expect(
      findBankSourceDefect({
        questionText:
          'When you slice into a raw onion and start crying, a volatile compound released from damaged onion cells is what actually irritates your eyes. What everyday kitchen liquid is your body producing in response?',
        answer: 'Tears',
      }),
    ).toBeNull();
    expect(
      findBankSourceDefect({
        questionText:
          'During the Progressive Era, women across the country organized and marched for the right to vote, culminating in a constitutional amendment ratified in 1920. What is this amendment commonly called?',
        answer: 'the Nineteenth Amendment',
      }),
    ).toBeNull();
  });
});
