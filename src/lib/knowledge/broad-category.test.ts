import { describe, expect, it } from 'vitest';

import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';

describe('normalizeBroadCategory', () => {
  it('keeps stable broad categories as portrait sections', () => {
    expect(normalizeBroadCategory('Literature')).toBe('Literature');
    expect(normalizeBroadCategory('music')).toBe('Music');
  });

  it('keeps Joyce-specific labels inside Literature rather than making a new section', () => {
    expect(normalizeBroadCategory('James Joyce & Irish Modernism')).toBe('Literature');
    expect(normalizeBroadCategory("Joyce's Ulysses")).toBe('Literature');
  });

  it('normalizes common broad-category aliases', () => {
    expect(normalizeBroadCategory('Film & TV')).toBe('Film & Television');
    expect(normalizeBroadCategory('Pop Culture & Television')).toBe('Film & Television');
  });
});
