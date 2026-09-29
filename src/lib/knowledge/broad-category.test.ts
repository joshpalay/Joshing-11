import { describe, expect, it } from 'vitest';

import { broadCategoryForDomain, normalizeBroadCategory } from '@/lib/knowledge/broad-category';

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

describe('normalizeBroadCategory — territory-sized labels (QA 2026-09-27, S3)', () => {
  it('folds a label ending in a bucket name into that bucket', () => {
    expect(normalizeBroadCategory('American Auto History')).toBe('History');
    expect(normalizeBroadCategory('Physical Geography')).toBe('Geography');
  });

  it('knows Geography and Religion & Mythology as buckets', () => {
    expect(normalizeBroadCategory('geography')).toBe('Geography');
    expect(normalizeBroadCategory('Mythology')).toBe('Religion & Mythology');
  });

  it('leaves labels with no bucket word alone', () => {
    expect(normalizeBroadCategory('Chess')).toBe('Chess');
  });
});

describe('broadCategoryForDomain (QA 2026-09-27, S3)', () => {
  it("trusts a topic name that names its field over the categorizer's History", () => {
    expect(broadCategoryForDomain('Australian Geography', 'History')).toBe('Geography');
    expect(broadCategoryForDomain('Greek Mythology', 'History')).toBe('Religion & Mythology');
  });

  it('otherwise normalizes the proposed category', () => {
    expect(broadCategoryForDomain('Tudor Dynasty', 'History')).toBe('History');
    expect(broadCategoryForDomain('Model T Fords', 'American Auto History')).toBe('History');
    expect(broadCategoryForDomain('Chess Openings', null)).toBeNull();
  });
});
