import { describe, expect, it } from 'vitest';

import { normalizeBroadCategory } from '@/server/questions/broad-category';

describe('normalizeBroadCategory', () => {
  it('folds known Literature synonyms onto one canonical label', () => {
    expect(normalizeBroadCategory('Literature & Drama')).toBe('Literature');
    expect(normalizeBroadCategory('Literature & Poetry')).toBe('Literature');
    expect(normalizeBroadCategory('Fiction & Literature')).toBe('Literature');
    expect(normalizeBroadCategory('Literature')).toBe('Literature');
  });

  it('folds Theater / Musical Theatre variants', () => {
    expect(normalizeBroadCategory('Musical Theater')).toBe('Theater & Musicals');
    expect(normalizeBroadCategory('Musical Theatre')).toBe('Theater & Musicals');
    expect(normalizeBroadCategory('Theater')).toBe('Theater & Musicals');
  });

  it('folds Film / Television variants', () => {
    expect(normalizeBroadCategory('Television')).toBe('Film & Television');
    expect(normalizeBroadCategory('Television & Animation')).toBe('Film & Television');
    expect(normalizeBroadCategory('Film & Television')).toBe('Film & Television');
  });

  it('folds Classical Music variants', () => {
    expect(normalizeBroadCategory('Classical Music & Opera')).toBe('Classical Music');
    expect(normalizeBroadCategory('Classical Music')).toBe('Classical Music');
  });

  it('normalizes " and " to " & " and collapses whitespace/case for aliases', () => {
    expect(normalizeBroadCategory('literature  and   drama')).toBe('Literature');
    expect(normalizeBroadCategory('  Musical   Theatre ')).toBe('Theater & Musicals');
  });

  it('passes unknown labels through with only cosmetic normalization', () => {
    expect(normalizeBroadCategory('Science & Nature')).toBe('Science & Nature');
    expect(normalizeBroadCategory('Science  and  Nature')).toBe('Science & Nature');
    expect(normalizeBroadCategory('Sports')).toBe('Sports');
    // Genuinely distinct categories are never guessed into a merge.
    expect(normalizeBroadCategory('Botany & Plant Science')).toBe('Botany & Plant Science');
  });

  it('leaves null / undefined / blank untouched', () => {
    expect(normalizeBroadCategory(null)).toBeNull();
    expect(normalizeBroadCategory(undefined)).toBeUndefined();
    expect(normalizeBroadCategory('')).toBe('');
  });
});
