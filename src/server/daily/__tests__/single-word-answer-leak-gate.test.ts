import { beforeAll, describe, expect, it } from 'vitest';

// Regression cover for the single-word answer-leak blind spot found 2026-09-12
// via a user report on the "Suspension" question (a music-theory term the
// stem's own closing clause names outright). acceptedFormLeaks/isDiscriminating
// in self-answering.ts only credits a form as a genuine tell when it has 3+
// substantive words, or a SECOND capitalized word after the first — so a
// one-word primary form ("Suspension", "Venus", "Snorks", "Rocko") can never
// qualify no matter how squarely it sits in the stem. A live-bank sweep after
// the report found three more already-served examples with this exact shape.
//
// Same dynamic-import dance as answer-leak-gate.test.ts / partial-answer-leak-
// gate.test.ts: generate-questions.ts pulls in @/server/db, which throws at
// module load without a connection string, and none of these units touch the DB.
let findAnswerLeaks: typeof import('@/server/daily/generate-questions').findAnswerLeaks;
let findBankSourceDefect: typeof import('@/server/daily/generate-questions').findBankSourceDefect;
let countSingleWordAnswerLeaks: typeof import('@/server/daily/generate-questions').countSingleWordAnswerLeaks;
let singleWordAnswerLeaks: typeof import('@/server/questions/self-answering').singleWordAnswerLeaks;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findAnswerLeaks, findBankSourceDefect, countSingleWordAnswerLeaks } = await import(
    '@/server/daily/generate-questions'
  ));
  ({ singleWordAnswerLeaks } = await import('@/server/questions/self-answering'));
});

function q(question_text: string, answer: string) {
  return {
    canonical_subcategory: 'General Knowledge',
    broad_category: 'General Knowledge',
    question_text,
    answer,
    explainer: '',
    difficulty_estimate: 'moderate' as const,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

// Rows exactly as generated and served in production, found live 2026-09-12/13.
const SUSPENSION = q(
  "In strict counterpoint, what term describes the interval of a second formed when a suspended note resolves downward by step — the dissonant 'leaning' tone that gives suspension counterpoint much of its expressive tension?",
  'Suspension (or suspension dissonance)',
);
const VENUS = q(
  "Botticelli's 'The Birth of Venus' now hangs in the Uffizi, but it was painted for a Medici villa. Which mythological figure emerges fully grown from the sea on a giant scallop shell at the center of the composition?",
  'Venus (Aphrodite)',
);
const SNORKS = q(
  "In the 1980s Hanna-Barbera series 'The Snorks,' the underwater creatures are distinguished from their more famous Smurf-like cousins by a distinctive anatomical feature that sits on top of their heads and serves as both a snorkel and a means of propulsion. What is this signature feature called — the same word used in the show's title?",
  'Snorks (the tubes/snorkels on their heads)',
);
const FIRE = q(
  'In Tears of the Kingdom, Link can attach a Zonai device called a Flame Emitter to constructions — but there is also a simpler way to set things on fire using a basic fusion technique. If Link fuses a Red ChuChu Jelly to his weapon and then strikes an enemy, what elemental effect does the attack produce?',
  'Fire (the weapon ignites and deals fire damage)',
);
const YELLOW = q(
  "In Steven Soderbergh's 'Traffic,' the film's three intercut storylines are visually distinguished from one another by radically different color treatments applied in post-production. What color grade — a bleached, high-contrast, amber-yellow tone — is used to represent the Mexican border storyline following Javier Rodriguez?",
  'Yellow (amber/golden/desaturated yellow)',
);

describe('singleWordAnswerLeaks', () => {
  it('catches the "Venus" class: a one-word answer whose exact word sits in the stem', () => {
    expect(singleWordAnswerLeaks(SUSPENSION.question_text, SUSPENSION.answer)).toBe(true);
    expect(singleWordAnswerLeaks(VENUS.question_text, VENUS.answer)).toBe(true);
    expect(singleWordAnswerLeaks(SNORKS.question_text, SNORKS.answer)).toBe(true);
    expect(singleWordAnswerLeaks(FIRE.question_text, FIRE.answer)).toBe(true);
    expect(singleWordAnswerLeaks(YELLOW.question_text, YELLOW.answer)).toBe(true);
  });

  it('does not fire on multi-word forms (that is the conjunctive/partial gates’ job)', () => {
    expect(
      singleWordAnswerLeaks(
        'Mozart’s Clarinet Concerto in A major was written for a friend who played a now-rare variant of the instrument with an extended lower range. What is that instrument called?',
        'Basset clarinet',
      ),
    ).toBe(false);
  });

  it('does not fire on counting questions, where a numeric single word is the whole point', () => {
    expect(
      singleWordAnswerLeaks(
        'A pitcher steps off the rubber and throws to first base to attempt a pickoff, but the throw goes into the stands. How many bases are the runners awarded?',
        'Two',
      ),
    ).toBe(false);
  });

  it('does not fire when the single word is absent from the stem', () => {
    expect(
      singleWordAnswerLeaks(
        'What is the name of the Australian wallaby who stars in a 1990s Nickelodeon cartoon about modern suburban life?',
        'Rocko',
      ),
    ).toBe(false);
  });

  // Known false-positive risk (documented, not silently swept under the rug):
  // a single common noun that the stem must use anyway to describe its own
  // subject, or a name that appears only because the setup needs to name every
  // participant in a scene. Both measured true here on purpose — the function
  // is deliberately loose (see its block comment); telling these apart from
  // genuine leaks is exactly what the SINGLE_WORD_ANSWER_LEAK_ENABLED
  // measure-only period is for, not something this pure function decides.
  it('is deliberately loose: also fires on borderline non-leak-shaped cases (measure-only, by design)', () => {
    expect(
      singleWordAnswerLeaks(
        "David Foster Wallace's essay on talk radio, which follows a right-wing Southern California host through his workday, ran in The Atlantic and later appeared in 'Consider the Lobster.' What is that essay's title, taken from the host's own on-air nickname for himself?",
        'Host',
      ),
    ).toBe(true);
    expect(
      singleWordAnswerLeaks(
        "Laertes and Hamlet duel in the final scene with a poisoned blade. The plan was Laertes' to use, but the foils get switched during the fight. Which character is struck by the poisoned weapon before Hamlet is?",
        'Laertes',
      ),
    ).toBe(true);
  });
});

describe('findAnswerLeaks single-word-leak flag', () => {
  const cases = [SUSPENSION, VENUS, SNORKS, FIRE, YELLOW];

  it('measures the single-word leaks but does not drop them by default', () => {
    delete process.env.SINGLE_WORD_ANSWER_LEAK_ENABLED;
    expect(findAnswerLeaks(cases).toDrop.size).toBe(0);
    expect(countSingleWordAnswerLeaks(cases)).toBe(5);
  });

  it('drops them once SINGLE_WORD_ANSWER_LEAK_ENABLED is set', () => {
    process.env.SINGLE_WORD_ANSWER_LEAK_ENABLED = 'true';
    try {
      const result = findAnswerLeaks(cases);
      expect([...result.toDrop].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(result.reasons[0]).toContain('Suspension');
    } finally {
      delete process.env.SINGLE_WORD_ANSWER_LEAK_ENABLED;
    }
  });
});

describe('findBankSourceDefect single-word-leak flag', () => {
  it('is silent by default and rejects once the flag is set', () => {
    delete process.env.SINGLE_WORD_ANSWER_LEAK_ENABLED;
    expect(
      findBankSourceDefect({ questionText: FIRE.question_text, answer: FIRE.answer }),
    ).toBeNull();

    process.env.SINGLE_WORD_ANSWER_LEAK_ENABLED = 'true';
    try {
      expect(
        findBankSourceDefect({ questionText: FIRE.question_text, answer: FIRE.answer }),
      ).toContain('Fire');
    } finally {
      delete process.env.SINGLE_WORD_ANSWER_LEAK_ENABLED;
    }
  });
});
