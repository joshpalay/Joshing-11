import { beforeAll, describe, expect, it } from 'vitest';

// Regression cover for the three questions served to production on 2026-09-04
// and 2026-09-05 whose stems gave their answers away. All three passed the
// conjunctive `findAnswerLeaks` check because it fires only when the stem
// contains EVERY substantive word of the answer.
//
// Same dynamic-import dance as answer-leak-gate.test.ts: generate-questions.ts
// pulls in @/server/db, which throws at module load without a connection
// string, and none of these units touch the DB.
let findAnswerLeaks: typeof import('@/server/daily/generate-questions').findAnswerLeaks;
let findAnswerShapeFailures: typeof import('@/server/daily/generate-questions').findAnswerShapeFailures;
let countPartialAnswerLeaks: typeof import('@/server/daily/generate-questions').countPartialAnswerLeaks;
let questionPartiallyLeaksAnswer: typeof import('@/server/questions/self-answering').questionPartiallyLeaksAnswer;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findAnswerLeaks, findAnswerShapeFailures, countPartialAnswerLeaks } = await import(
    '@/server/daily/generate-questions'
  ));
  ({ questionPartiallyLeaksAnswer } = await import('@/server/questions/self-answering'));
});

function q(question_text: string, answer: string) {
  return {
    canonical_subcategory: 'The Simpsons',
    broad_category: 'Film & Television',
    question_text,
    answer,
    explainer: '',
    difficulty_estimate: 'moderate' as const,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

// The three rows as they were actually generated and served.
const SIMPSONS = q(
  "In 'Last Exit to Springfield,' Homer inadvertently becomes a union negotiator when the power plant workers go on strike. What specific dental benefit are the workers fighting to keep?",
  'Dental plan',
);
const LEMON = q(
  "In 'Lemon of Troy,' Bart leads a group of Springfield kids on a mission to reclaim something stolen by Shelbyville. Fill in the blank: the kids are on a quest to recover Springfield's prized ……",
  'lemon tree',
);
const JOYCE = q(
  "In Joyce's 'A Portrait of the Artist as a Young Man,' Stephen Dedalus famously refuses to sign a petition for universal peace circulated among students at University College Dublin. What cause did that petition support?",
  "A petition calling for universal peace / the Tsar's peace rescript (specifically, the Czar Nicholas II's 1898 peace manifesto)",
);

describe('questionPartiallyLeaksAnswer', () => {
  it('catches the generic-head-noun leak (stem shows the modifier, withholds the category)', () => {
    // "dental" is in the stem; the player supplies "plan" for free.
    expect(questionPartiallyLeaksAnswer(SIMPSONS.question_text, SIMPSONS.answer)).toBe(true);
    // The episode title hands over "lemon"; only "tree" is withheld.
    expect(questionPartiallyLeaksAnswer(LEMON.question_text, LEMON.answer)).toBe(true);
  });

  it('catches the contiguous-run leak that one filler word used to hide', () => {
    // The stem prints "a petition for universal peace" verbatim. Under the
    // conjunctive rule the single gerund "calling" was enough to save it.
    expect(questionPartiallyLeaksAnswer(JOYCE.question_text, JOYCE.answer)).toBe(true);
  });

  it('does not fire when the WITHHELD word is the substance and the shown word is the category', () => {
    // The stem naming the category is normal; "basset" / "plagal" / "cabbage
    // patch" are the answers and are correctly absent from the stem.
    expect(
      questionPartiallyLeaksAnswer(
        "Mozart's Clarinet Concerto in A major was written for a friend who played a now-rare variant of the instrument with an extended lower range. What is that instrument called?",
        'Basset clarinet',
      ),
    ).toBe(false);
    expect(
      questionPartiallyLeaksAnswer(
        'In Western tonal harmony, when a chord progression moves from the subdominant (IV) chord directly to the tonic (I) chord, what is that cadence called?',
        'Plagal cadence',
      ),
    ).toBe(false);
    expect(
      questionPartiallyLeaksAnswer(
        'The Garbage Pail Kids cards were deliberately designed as a grotesque parody of which enormously popular 1980s doll line?',
        'Cabbage Patch Kids',
      ),
    ).toBe(false);
  });

  it('does not fire when the stem merely paraphrases the answer’s category', () => {
    // The stem prints a real contiguous run of the answer ("tennis academy"),
    // but withholds "Enfield" — which is the entire answer. self-answering.ts
    // has warned about this exact case since the accepted-form gate landed, and
    // an untightened contiguous-run rule reintroduces it.
    expect(
      questionPartiallyLeaksAnswer(
        "In 'Infinite Jest,' what is the name of the elite Boston tennis academy founded by James Incandenza?",
        'Enfield Tennis Academy',
      ),
    ).toBe(false);
    // Same shape: the run is "theorem ... calculus", but "Fundamental" is the ask.
    expect(
      questionPartiallyLeaksAnswer(
        'When finding the area under a curve between two x-values, you evaluate the antiderivative at the upper limit and subtract its value at the lower. Which theorem of calculus guarantees this works?',
        'The Fundamental Theorem of Calculus',
      ),
    ).toBe(false);
  });

  it('does not fire on counting questions, where the stem naming the unit is normal', () => {
    // Structurally identical to a leak — the stem shows "bases"/"books" and the
    // answer adds a number — but the withheld number IS the answer.
    expect(
      questionPartiallyLeaksAnswer(
        'A pitcher steps off the rubber and throws to first base to attempt a pickoff, but the throw goes into the stands. How many bases are the runners awarded?',
        'Two bases',
      ),
    ).toBe(false);
    expect(
      questionPartiallyLeaksAnswer(
        "Bach's 'The Well-Tempered Clavier' systematically works through all 24 major and minor keys. How many books make up the complete collection?",
        'Two books',
      ),
    ).toBe(false);
  });
});

describe('findAnswerLeaks partial-leak flag', () => {
  const cases = [SIMPSONS, LEMON, JOYCE];

  it('measures the partial leaks but does not drop them by default', () => {
    delete process.env.PARTIAL_ANSWER_LEAK_ENABLED;
    expect(findAnswerLeaks(cases).toDrop.size).toBe(0);
    expect(countPartialAnswerLeaks(cases)).toBe(3);
  });

  it('drops them once PARTIAL_ANSWER_LEAK_ENABLED is set', () => {
    process.env.PARTIAL_ANSWER_LEAK_ENABLED = 'true';
    try {
      const result = findAnswerLeaks(cases);
      expect([...result.toDrop].sort()).toEqual([0, 1, 2]);
      expect(result.reasons[0]).toContain('Dental plan');
    } finally {
      delete process.env.PARTIAL_ANSWER_LEAK_ENABLED;
    }
  });
});

describe('findAnswerShapeFailures (Rule 3 — ONE CLEAN ANSWER)', () => {
  it('drops sentence-shaped answers', () => {
    const result = findAnswerShapeFailures([
      q(
        "In 'Siegfried,' the hero shatters the spear. What does that signify?",
        "It signals the end of Wotan's power and the gods' dominion — the spear, engraved with the contracts that undergird Wotan's authority, is broken, meaning his rule over the world is finished",
      ),
    ]);
    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('one clean answer');
  });

  it('drops the Joyce answer, whose padding is what defeated the leak gate', () => {
    expect([...findAnswerShapeFailures([JOYCE]).toDrop]).toEqual([0]);
  });

  it('spares a long answer that is genuinely one clean title', () => {
    // 159 chars, no clause break, no leading pronoun — a real essay title and a
    // perfectly checkable answer. A bare length cap would have killed it.
    const result = findAnswerShapeFailures([
      q(
        "David Foster Wallace's profile of tennis player Michael Joyce carried what full title?",
        'Tennis Player Michael Joyce’s Professional Artistry as a Paradigm of Certain Stuff About Choice, Freedom, Discipline, Joy, Grotesquerie, and Human Completeness',
      ),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('spares short answers and honours the kill switch', () => {
    expect(findAnswerShapeFailures([SIMPSONS, LEMON]).toDrop.size).toBe(0);
    process.env.ANSWER_SHAPE_GATE_ENABLED = 'off';
    try {
      expect(findAnswerShapeFailures([JOYCE]).toDrop.size).toBe(0);
    } finally {
      delete process.env.ANSWER_SHAPE_GATE_ENABLED;
    }
  });
});
