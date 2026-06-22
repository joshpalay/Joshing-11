import { describe, expect, it } from 'vitest';

import type { StreamQuestion } from '@/lib/activity-stream';
import { categoryPhrase, streakCategories, streakPageTitle } from '../streak-meta';

const q = (questionId: string, domain: string | null): StreamQuestion => ({
  questionId,
  text: `Question ${questionId}`,
  domain,
  priorResult: null,
});

describe('streakCategories', () => {
  it('dedupes domains, preserves order, and drops blanks/nulls', () => {
    expect(
      streakCategories([
        q('a', 'Tennis'),
        q('b', 'History'),
        q('c', 'Tennis'), // dup
        q('d', '   '), // blank
        q('e', null), // null
        q('f', 'Reformation'),
      ]),
    ).toEqual(['Tennis', 'History', 'Reformation']);
  });
});

describe('categoryPhrase', () => {
  it('handles 0/1/2 and "and N others" for 3+', () => {
    expect(categoryPhrase([])).toBe('');
    expect(categoryPhrase(['Tennis'])).toBe('Tennis');
    expect(categoryPhrase(['Tennis', 'History'])).toBe('Tennis and History');
    expect(categoryPhrase(['Tennis', 'History', 'Reformation'])).toBe(
      'Tennis, History and 1 other',
    );
    expect(categoryPhrase(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
  });
});

describe('streakPageTitle', () => {
  it('builds "{Friend}’s questions about {categories}"', () => {
    const title = streakPageTitle('Joshua', [
      q('a', 'Tennis Fundamentals'),
      q('b', 'Early 20th Century American History'),
      q('c', 'English Reformation'),
      q('d', 'Jazz'),
      q('e', 'Cinema'),
    ]);
    expect(title).toBe(
      'Joshua’s questions about Tennis Fundamentals, Early 20th Century American History and 3 others',
    );
  });

  it('falls back to "{Friend}’s questions" when no category is known', () => {
    expect(streakPageTitle('Joshua', [q('a', null)])).toBe('Joshua’s questions');
  });

  it('falls back to a generic name when the friend name is blank', () => {
    expect(streakPageTitle('  ', [q('a', 'Tennis')])).toBe('Your friend’s questions about Tennis');
  });
});
