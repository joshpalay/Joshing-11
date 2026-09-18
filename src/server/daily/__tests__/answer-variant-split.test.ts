import { beforeAll, describe, expect, it } from 'vitest';

// Rule 3d (2026-09-16 review): the answer key is a canonical string PLUS a
// variants list. Live rows had the variants packed into the answer string
// instead — "Lack of proportion (or 'failure of propo…", "Cannon (a peal of
// ordnance / guns)" — which made the deterministic grading fast-path unusable
// and padded the primary form the answer-leak gates read.
//
// Same dynamic-import dance as the other generate-questions unit tests: the
// module pulls in @/server/db, which throws at module load without a connection
// string, and none of these units touch the DB.
import {
  normalizeAnswerVariants,
  splitPackedAnswer,
} from '@/server/answers/answer-variants';

let parseQuestions: typeof import('@/server/daily/generate-questions').parseQuestions;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ parseQuestions } = await import('@/server/daily/generate-questions'));
});

describe('splitPackedAnswer', () => {
  it('peels a parenthetical gloss off the two answers the review named', () => {
    expect(splitPackedAnswer("Lack of proportion (or 'failure of proportion')")).toEqual({
      answer: 'Lack of proportion',
      variants: ['failure of proportion', "Lack of proportion (or 'failure of proportion')"],
    });
    expect(splitPackedAnswer('Cannon (a peal of ordnance / guns)')).toEqual({
      answer: 'Cannon',
      variants: ['a peal of ordnance', 'guns', 'Cannon (a peal of ordnance / guns)'],
    });
  });

  it('peels an alternate name, keeping the packed original as a variant', () => {
    expect(splitPackedAnswer('Andrey Razumovsky (Count Razumovsky)')).toEqual({
      answer: 'Andrey Razumovsky',
      variants: ['Count Razumovsky', 'Andrey Razumovsky (Count Razumovsky)'],
    });
    expect(splitPackedAnswer('Venus (Aphrodite)').answer).toBe('Venus');
    expect(splitPackedAnswer('Graphics Processing Unit (GPU)').variants).toContain('GPU');
  });

  it('peels inline slash alternates but never a slash inside one answer', () => {
    expect(splitPackedAnswer('Cannon / ordnance').answer).toBe('Cannon');
    // No surrounding spaces: these are single answers, not alternates.
    for (const whole of ['AC/DC', '9/11', 'km/h', 'and/or']) {
      expect(splitPackedAnswer(whole)).toEqual({ answer: whole, variants: [] });
    }
  });

  it('leaves a LEADING parenthetical alone — it is part of the title', () => {
    for (const title of ["(I Can't Get No) Satisfaction", "(Sittin' On) The Dock of the Bay"]) {
      expect(splitPackedAnswer(title)).toEqual({ answer: title, variants: [] });
    }
  });

  it('drops a disambiguating gloss rather than promoting it to an accepted answer', () => {
    // "the planet" is a category label; accepting it would mark a bare category
    // correct forever. A capitalized second word is a name, so it survives.
    expect(splitPackedAnswer('Mercury (the planet)')).toEqual({
      answer: 'Mercury',
      variants: ['Mercury (the planet)'],
    });
    expect(splitPackedAnswer('Durin (the Deathless)').variants).toContain('the Deathless');
  });

  it('leaves a clean answer untouched', () => {
    for (const clean of ['Neville Longbottom', 'bone', 'Two', 'birds']) {
      expect(splitPackedAnswer(clean)).toEqual({ answer: clean, variants: [] });
    }
  });
});

describe('normalizeAnswerVariants', () => {
  it('dedups against the canonical answer and within the list, and caps the count', () => {
    expect(
      normalizeAnswerVariants(['Venus', 'venus', 'Aphrodite', 'Aphrodite'], 'Venus'),
    ).toEqual(['Aphrodite']);
    expect(normalizeAnswerVariants(['a', 'b', 'c', 'd', 'e', 'f'], 'z')).toHaveLength(4);
  });

  it('ignores non-strings, empties, and over-long entries', () => {
    expect(normalizeAnswerVariants([null, 42, '  ', 'x'.repeat(200), 'ok'], 'z')).toEqual(['ok']);
    expect(normalizeAnswerVariants('not an array', 'z')).toEqual([]);
  });
});

describe('parseQuestions answer key', () => {
  const item = (answer: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      questions: [
        {
          canonical_subcategory: 'Mrs. Dalloway',
          broad_category: 'Literature',
          question_text: 'What does Clarissa hand Peter Walsh when he begins to cry?',
          answer,
          explainer: 'Context.',
          difficulty_estimate: 'moderate',
          fact_key: 'mrs-dalloway-clarissa-peter-scissors',
          subject_entity: 'Clarissa Dalloway',
          sub_angles: ['Peter Walsh visit'],
          question_shape: 'identification',
          ...extra,
        },
      ],
    });

  it('keeps the model-emitted variants when Rule 3d is followed', () => {
    const [q] = parseQuestions(item('Cannon', { acceptable_variants: ['a peal of ordnance'] }));
    expect(q.answer).toBe('Cannon');
    expect(q.acceptable_variants).toEqual(['a peal of ordnance']);
  });

  it('splits a packed answer when the model ignores Rule 3d', () => {
    const [q] = parseQuestions(item('Cannon (a peal of ordnance / guns)'));
    expect(q.answer).toBe('Cannon');
    expect(q.acceptable_variants).toEqual([
      'a peal of ordnance',
      'guns',
      'Cannon (a peal of ordnance / guns)',
    ]);
  });

  it('unions both sources without duplicating', () => {
    const [q] = parseQuestions(
      item('Venus (Aphrodite)', { acceptable_variants: ['Aphrodite', 'Venus'] }),
    );
    expect(q.answer).toBe('Venus');
    expect(q.acceptable_variants).toEqual(['Aphrodite', 'Venus (Aphrodite)']);
  });
});
