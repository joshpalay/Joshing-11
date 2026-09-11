// R7 (2026-09-11) — subject-level coverage in the generation prompt.
//
// The sub-angle block tells the model which FACETS of a domain are taken, and it
// reads that as "find an uncovered facet" — of the same headline work. In a
// multi-work domain that concentrates hard: a hand count of live stock found
// "Virginia Woolf's Novels and Essays" putting Mrs Dalloway at the centre of 19
// of 47 rows, and "Shakespearean Tragedy" reaching Hamlet 10 times and Macbeth 6
// before touching anything else. subject_entity was written on every row and
// read by nothing but a short cooldown.
//
// Also covers the dedupe fold that lets the widened sub-angle window (20 -> 60)
// carry 60 distinct facets rather than 60 spellings of a dozen.

import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from '@/server/daily/generate-questions';
import { subAngleDedupeKey } from '@/server/db/queries/daily';

const NO_AVOID: never[] = [];

function prompt(
  subjects?: ReadonlyMap<string, ReadonlyArray<{ subject: string; count: number }>>,
) {
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
    subjects,
  );
}

describe('buildUserPrompt — subject coverage block (R7)', () => {
  it('lists covered subjects with their counts', () => {
    const out = prompt(
      new Map([
        [
          'Shakespearean Tragedy',
          [
            { subject: 'Hamlet', count: 10 },
            { subject: 'Macbeth', count: 6 },
          ],
        ],
      ]),
    );
    expect(out).toContain('Subjects already covered');
    expect(out).toContain('Hamlet (10)');
    expect(out).toContain('Macbeth (6)');
  });

  it('asks for a different work, not merely a different facet', () => {
    const out = prompt(new Map([['Shakespearean Tragedy', [{ subject: 'Hamlet', count: 10 }]]]));
    expect(out).toContain('A domain is not one work');
    expect(out).toContain('different play, novel, album, episode, character, figure, or period');
  });

  it('is absent entirely when there is no coverage yet', () => {
    expect(prompt(undefined)).not.toContain('Subjects already covered');
    expect(prompt(new Map())).not.toContain('Subjects already covered');
  });

  it('omits a domain that has no covered subjects rather than printing an empty line', () => {
    const out = prompt(new Map([['Some Other Domain', [{ subject: 'Thing', count: 1 }]]]));
    expect(out).not.toContain('Subjects already covered');
  });

  it('does not disturb the avoid-list blocks that follow it', () => {
    const out = prompt(new Map([['Shakespearean Tragedy', [{ subject: 'Hamlet', count: 3 }]]]));
    expect(out).toContain('Previously generated questions to avoid repeating');
    expect(out).toContain('Fact keys already covered for this user');
  });
});

describe('subAngleDedupeKey (R7)', () => {
  it('folds case, punctuation and articles onto one key', () => {
    expect(subAngleDedupeKey('Fugue Structure')).toBe(subAngleDedupeKey('fugue structure'));
    expect(subAngleDedupeKey("Alberich's capture")).toBe(subAngleDedupeKey('Alberich s capture'));
    expect(subAngleDedupeKey('the Water Temple')).toBe(subAngleDedupeKey('Water Temple'));
  });

  it('keeps genuinely different facets apart', () => {
    expect(subAngleDedupeKey('fugue structure')).not.toBe(subAngleDedupeKey('fugue terminology'));
    expect(subAngleDedupeKey('Die Walküre Act I')).not.toBe(subAngleDedupeKey('Die Walküre Act III'));
  });

  it('strips diacritics so a spelling variant does not claim a second slot', () => {
    expect(subAngleDedupeKey('Götterdämmerung')).toBe(subAngleDedupeKey('Gotterdammerung'));
  });

  it('returns empty for a tag with no substance, so it is skipped not stored', () => {
    expect(subAngleDedupeKey('   ')).toBe('');
    expect(subAngleDedupeKey('the')).toBe('');
  });
});
