import { describe, expect, it } from 'vitest';

import { titleCaseDomain } from '@/lib/knowledge/domain-casing';

describe('titleCaseDomain', () => {
  it('title-cases all-lowercase input', () => {
    expect(titleCaseDomain('russian literature')).toBe('Russian Literature');
    expect(titleCaseDomain('space exploration')).toBe('Space Exploration');
  });

  it('normalizes SHOUTING input down to title case', () => {
    expect(titleCaseDomain('RUSSIAN LITERATURE')).toBe('Russian Literature');
    expect(titleCaseDomain('SPACE EXPLORATION')).toBe('Space Exploration');
  });

  it('keeps minor words lowercase except first/last', () => {
    expect(titleCaseDomain('lord of the rings')).toBe('Lord of the Rings');
    expect(titleCaseDomain('the lord of the rings')).toBe('The Lord of the Rings');
    expect(titleCaseDomain('a tale of two cities')).toBe('A Tale of Two Cities');
    // a minor word as the last word is still capitalized
    expect(titleCaseDomain('something to live for')).toBe('Something to Live For');
  });

  it('does not produce "90S" for decade-style tokens', () => {
    expect(titleCaseDomain('90s hip hop')).toBe('90s Hip Hop');
    expect(titleCaseDomain('1990s rock')).toBe('1990s Rock');
  });

  it('handles iOS-autocorrected apostrophes and mixed casing', () => {
    expect(titleCaseDomain("90's hip hop")).toBe("90's Hip Hop");
    expect(titleCaseDomain("90's HIP HOP")).toBe("90's Hip Hop");
    expect(titleCaseDomain('90’s Hip Hop')).toBe("90's Hip Hop");
  });

  it('up-cases multi-letter roman numerals', () => {
    expect(titleCaseDomain('world war ii')).toBe('World War II');
    expect(titleCaseDomain('final fantasy vii')).toBe('Final Fantasy VII');
  });

  it('applies canonical casing for common acronyms regardless of input casing', () => {
    expect(titleCaseDomain('nba history')).toBe('NBA History');
    expect(titleCaseDomain('history of nasa')).toBe('History of NASA');
    expect(titleCaseDomain('NBA HISTORY')).toBe('NBA History');
    expect(titleCaseDomain('wwii documentaries')).toBe('WWII Documentaries');
  });

  it('preserves a lone all-caps acronym the user typed', () => {
    expect(titleCaseDomain('ESPN highlights')).toBe('ESPN Highlights');
    expect(titleCaseDomain('the FIFA world cup')).toBe('The FIFA World Cup');
  });

  it('preserves hyphenated genres and stylized brands', () => {
    expect(titleCaseDomain('hip-hop')).toBe('Hip-Hop');
    expect(titleCaseDomain('k-pop')).toBe('K-Pop');
    expect(titleCaseDomain('sci-fi films')).toBe('Sci-Fi Films');
    expect(titleCaseDomain('spider-man comics')).toBe('Spider-Man Comics');
    expect(titleCaseDomain('youtube creators')).toBe('YouTube Creators');
    expect(titleCaseDomain('ios development')).toBe('iOS Development');
  });

  it('capitalizes a proper noun that follows leading punctuation (parens, quotes)', () => {
    // Regression: capitalizeChunk previously lowercased the first letter when a
    // token was led by punctuation, mangling "(Verdi" -> "(verdi".
    expect(titleCaseDomain('19th-Century Italian Opera (Verdi & Puccini Era)')).toBe(
      '19th-Century Italian Opera (Verdi & Puccini Era)',
    );
    expect(titleCaseDomain('Oklahoma! (Rodgers & Hammerstein Musical)')).toBe(
      'Oklahoma! (Rodgers & Hammerstein Musical)',
    );
    expect(titleCaseDomain('the simpsons (seasons 1-10)')).toBe('The Simpsons (Seasons 1-10)');
    // A digit-led chunk inside parens still stays lowercase past the digit.
    expect(titleCaseDomain('playlists (90s edition)')).toBe('Playlists (90s Edition)');
  });

  it('collapses whitespace and underscores', () => {
    expect(titleCaseDomain('  space   exploration ')).toBe('Space Exploration');
    expect(titleCaseDomain('space_exploration')).toBe('Space Exploration');
  });

  it('returns empty string for blank input', () => {
    expect(titleCaseDomain('')).toBe('');
    expect(titleCaseDomain('   ')).toBe('');
  });
});
