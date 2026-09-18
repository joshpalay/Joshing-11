import { beforeAll, describe, expect, it } from 'vitest';

// The mechanical answer-in-stem check from the 2026-09-16 review: tokenise the
// answer, drop the stopwords, flag the question when ANY content token is
// already printed in the stem. Disjunctive, so it reaches the shape the other
// three rules structurally cannot — a two-word answer whose withheld word is
// ordinary substance ("Hamlet the Dane"), and the fill-in-the-blank line whose
// elided word appears elsewhere in the same line.
//
// Same dynamic-import dance as single-word-answer-leak-gate.test.ts:
// generate-questions.ts pulls in @/server/db, which throws at module load
// without a connection string, and none of these units touch the DB.
let findAnswerLeaks: typeof import('@/server/daily/generate-questions').findAnswerLeaks;
let findBankSourceDefect: typeof import('@/server/daily/generate-questions').findBankSourceDefect;
let countAnyTokenAnswerLeaks: typeof import('@/server/daily/generate-questions').countAnyTokenAnswerLeaks;
let answerTokenLeaks: typeof import('@/server/questions/self-answering').answerTokenLeaks;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findAnswerLeaks, findBankSourceDefect, countAnyTokenAnswerLeaks } = await import(
    '@/server/daily/generate-questions'
  ));
  ({ answerTokenLeaks } = await import('@/server/questions/self-answering'));
});

function q(question_text: string, answer: string, acceptable_variants: string[] = []) {
  return {
    canonical_subcategory: 'General Knowledge',
    broad_category: 'General Knowledge',
    question_text,
    answer,
    acceptable_variants,
    explainer: '',
    difficulty_estimate: 'moderate' as const,
    fact_key: null,
    subject_entity: null,
    sub_angles: [],
    question_shape: null,
  };
}

const HAMLET_THE_DANE = q(
  "In Shakespeare's Hamlet, the prince leaps into Ophelia's grave and announces himself with a royal epithet he has not used before. What does he call himself?",
  'Hamlet the Dane',
);
// The complete-the-quote shape the review named: the elided remainder repeats a
// word the stem already prints, so the player reads half the answer off the
// line. None of the three earlier rules reach it — the answer's other content
// word ("kingdom") is neither filler nor a generic head noun.
const QUOTE_REMAINDER = q(
  'Complete the line Shakespeare gives Richard III on Bosworth Field, after the king is unhorsed: "A horse, a horse, ……"',
  'my kingdom for a horse',
);

describe('answerTokenLeaks', () => {
  it('catches the "Hamlet the Dane" class: one content token already in the stem', () => {
    expect(answerTokenLeaks(HAMLET_THE_DANE.question_text, HAMLET_THE_DANE.answer)).toBe(true);
  });

  it('catches a quote whose elided remainder repeats a word the line already prints', () => {
    expect(answerTokenLeaks(QUOTE_REMAINDER.question_text, QUOTE_REMAINDER.answer)).toBe(true);
  });

  it('does not fire when no content token of the answer is in the stem', () => {
    expect(
      answerTokenLeaks(
        'What is the name of the Australian wallaby who stars in a 1990s Nickelodeon cartoon about modern suburban life?',
        'Rocko Rama',
      ),
    ).toBe(false);
  });

  it('does not fire when the only shared word is a generic head noun or filler', () => {
    // The stem may hand over "plan"/"tree" for free — the substance is the
    // modifier, and that is questionPartiallyLeaksAnswer's Rule B, not this one.
    expect(
      answerTokenLeaks(
        'In this episode the workers strike over a benefit their contract is about to lose. What benefit are they fighting to keep?',
        'Dental plan',
      ),
    ).toBe(false);
  });

  it('does not fire on counting questions or numeric tokens', () => {
    expect(
      answerTokenLeaks(
        'A pitcher throws to first base to attempt a pickoff and the throw goes into the stands. How many bases are the runners awarded?',
        'Two bases',
      ),
    ).toBe(false);
  });

  it('leaves single-word answers to singleWordAnswerLeaks (own rule, own flag)', () => {
    expect(
      answerTokenLeaks(
        "Botticelli's 'The Birth of Venus' hangs in the Uffizi. Which mythological figure emerges from the sea at the center of the composition?",
        'Venus (Aphrodite)',
      ),
    ).toBe(false);
  });

  // Known false-positive risk, measured true on purpose. Rule 2b (NAME THE
  // SOURCE) REQUIRES the stem to name the work, so an answer sharing a word
  // with its own source title trips this rule structurally rather than because
  // the question gives anything away. Telling these apart from real leaks is
  // exactly what the measure-only period is for.
  it('is deliberately loose: fires when the stem must name the answer’s own category', () => {
    // The stem cannot describe a rare variant of the clarinet without saying
    // "clarinet", so the shared token is forced by the question, not a giveaway.
    expect(
      answerTokenLeaks(
        "Mozart's Clarinet Concerto in A major was written for a friend who played a now-rare variant of the instrument with an extended lower range. What is that instrument called?",
        'Basset clarinet',
      ),
    ).toBe(true);
    // Rule 2b (NAME THE SOURCE) forces the same collision whenever an answer
    // shares a word with the work the stem is required to name.
    expect(
      answerTokenLeaks(
        "In Rocko's Modern Life, which character is the wallaby's steadfast steer best friend?",
        "Rocko's neighbour Heffer Wolfe",
      ),
    ).toBe(true);
  });
});

describe('findAnswerLeaks any-token flag', () => {
  const cases = [HAMLET_THE_DANE, QUOTE_REMAINDER];

  it('measures the any-token leaks but does not drop them by default', () => {
    delete process.env.ANY_TOKEN_ANSWER_LEAK_ENABLED;
    expect(findAnswerLeaks(cases).toDrop.size).toBe(0);
    expect(countAnyTokenAnswerLeaks(cases)).toBe(2);
  });

  it('drops them once ANY_TOKEN_ANSWER_LEAK_ENABLED is set', () => {
    process.env.ANY_TOKEN_ANSWER_LEAK_ENABLED = 'true';
    try {
      const result = findAnswerLeaks(cases);
      expect([...result.toDrop].sort()).toEqual([0, 1]);
      expect(result.reasons[0]).toContain('Hamlet the Dane');
    } finally {
      delete process.env.ANY_TOKEN_ANSWER_LEAK_ENABLED;
    }
  });

  it('does not double-count a row an earlier rule already flagged', () => {
    // A whole-answer leak is counted by `answer_leak`; the any-token counter is
    // net of the rules ahead of it so the four gates never tally the same row.
    const whole = q('What is a dental plan, as the workers call it?', 'Dental plan');
    expect(countAnyTokenAnswerLeaks([whole])).toBe(0);
  });
});

describe('findBankSourceDefect any-token flag', () => {
  it('is silent by default and rejects once the flag is set', () => {
    delete process.env.ANY_TOKEN_ANSWER_LEAK_ENABLED;
    expect(
      findBankSourceDefect({
        questionText: HAMLET_THE_DANE.question_text,
        answer: HAMLET_THE_DANE.answer,
      }),
    ).toBeNull();

    process.env.ANY_TOKEN_ANSWER_LEAK_ENABLED = 'true';
    try {
      expect(
        findBankSourceDefect({
          questionText: HAMLET_THE_DANE.question_text,
          answer: HAMLET_THE_DANE.answer,
        }),
      ).toContain('Hamlet the Dane');
    } finally {
      delete process.env.ANY_TOKEN_ANSWER_LEAK_ENABLED;
    }
  });
});
