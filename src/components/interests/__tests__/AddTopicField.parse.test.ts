import { describe, expect, it } from 'vitest';

import { parseTopicTokens } from '@/components/interests/AddTopicField';

describe('parseTopicTokens', () => {
  it('returns a single-element list for one topic', () => {
    expect(parseTopicTokens('Byzantine Coinage')).toEqual(['Byzantine Coinage']);
  });

  it('splits comma-separated topics — the reported "counted as 1" case', () => {
    expect(parseTopicTokens('Byzantine Coinage, Jazz, Chess')).toEqual([
      'Byzantine Coinage',
      'Jazz',
      'Chess',
    ]);
  });

  it('trims whitespace and drops empty tokens', () => {
    expect(parseTopicTokens('  Jazz ,  , Chess ,')).toEqual(['Jazz', 'Chess']);
  });

  it('splits on newlines too, so a pasted list works', () => {
    expect(parseTopicTokens('Jazz\nChess\n\nGo')).toEqual(['Jazz', 'Chess', 'Go']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseTopicTokens('Jazz, jazz, JAZZ, Chess')).toEqual(['Jazz', 'Chess']);
  });

  it('returns an empty list for blank or separator-only input', () => {
    expect(parseTopicTokens('')).toEqual([]);
    expect(parseTopicTokens('   ')).toEqual([]);
    expect(parseTopicTokens(', ,\n,')).toEqual([]);
  });
});
