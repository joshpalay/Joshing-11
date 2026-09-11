// R4 (2026-09-11) — question_shape is persisted and fed back.
//
// The generator has been asked for a question_shape, and held to a
// no-two-alike rule on it, since the shape catalogue was written. The value was
// validated, console.warn'd, and then dropped at persist, so nothing downstream
// could see whether the variety instruction was landing. It was not: a hand read
// put ~77% of live rows in 'identification' and found three of the nine offered
// shapes with ONE row each across 2,191 questions.
//
// Two compounding causes, both addressed here. The variety rule is scoped to a
// single BATCH, and a batch is three questions (GENERATION_CHUNK_SIZE), so
// "no two alike" is satisfiable forever by identification plus two others. And
// with nothing persisted, no per-domain history could contradict that.

import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from '@/server/daily/generate-questions';

const NO_AVOID: never[] = [];

function prompt(shapes?: ReadonlyMap<string, ReadonlyArray<{ shape: string; count: number }>>) {
  return buildUserPrompt(
    ['Shakespearean Tragedy'],
    1,
    NO_AVOID,
    NO_AVOID,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    shapes,
  );
}

describe('buildUserPrompt — shape coverage block (R4)', () => {
  it('lists used shapes with their counts', () => {
    const out = prompt(
      new Map([
        [
          'Shakespearean Tragedy',
          [
            { shape: 'identification', count: 40 },
            { shape: 'who_did_what', count: 3 },
          ],
        ],
      ]),
    );
    expect(out).toContain('Question shapes already used');
    expect(out).toContain('identification (40)');
    expect(out).toContain('who_did_what (3)');
  });

  it('names identification as the shape to steer away from', () => {
    const out = prompt(
      new Map([['Shakespearean Tragedy', [{ shape: 'identification', count: 40 }]]]),
    );
    expect(out).toContain('treat a high identification count as a reason to pick something else');
  });

  it('asks for an unused shape, not merely a different one', () => {
    const out = prompt(
      new Map([['Shakespearean Tragedy', [{ shape: 'identification', count: 9 }]]]),
    );
    expect(out).toContain('especially one with no count at all');
  });

  it('is absent when nothing has been recorded yet', () => {
    // The column lands empty and backfills only as new questions are generated,
    // so an absent block is the normal state immediately after deploy.
    expect(prompt(undefined)).not.toContain('Question shapes already used');
    expect(prompt(new Map())).not.toContain('Question shapes already used');
  });

  it('omits a domain with no recorded shapes rather than printing an empty line', () => {
    const out = prompt(new Map([['Some Other Domain', [{ shape: 'identification', count: 2 }]]]));
    expect(out).not.toContain('Question shapes already used');
  });

  it('coexists with the subject block and the avoid lists', () => {
    const out = buildUserPrompt(
      ['Shakespearean Tragedy'],
      1,
      NO_AVOID,
      NO_AVOID,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new Map([['Shakespearean Tragedy', [{ subject: 'Hamlet', count: 10 }]]]),
      new Map([['Shakespearean Tragedy', [{ shape: 'identification', count: 40 }]]]),
    );
    expect(out).toContain('Subjects already covered');
    expect(out).toContain('Question shapes already used');
    expect(out).toContain('Previously generated questions to avoid repeating');
  });
});
