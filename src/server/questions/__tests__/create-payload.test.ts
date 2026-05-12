import { describe, expect, it } from 'vitest';

import { normalizeCanonicalSubcategory } from '@/lib/question-categorization';
import { readCreateQuestionPayload } from '@/server/questions/create-payload';

describe('create question payload categorization', () => {
  const basePayload = {
    text: 'Which 1922 poem opens with April as the cruelest month?',
    correctAnswer: 'The Waste Land',
    verified: true,
    critiqueIterations: 0,
  };

  it('persists a broad enum category plus a specific canonical subcategory', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      category: 'literature',
      canonicalSubcategory: '  The   Waste Land  ',
    });

    expect(result.errors).toEqual([]);
    expect(result.value.category).toBe('literature');
    expect(result.value.broadCategory).toBe('Literature');
    expect(result.value.canonicalSubcategory).toBe('The Waste Land');
    expect(result.value.subcategory).toBe('The Waste Land');
    expect(result.value.domain).toBe('The Waste Land');
  });

  it('accepts domain as the backwards-compatible specific area field', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      broadCategory: 'Literature',
      domain: 'TS Eliot',
      shareToFeed: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.value.category).toBe('literature');
    expect(result.value.canonicalSubcategory).toBe('T. S. Eliot');
    expect(result.value.shareToFeed).toBe(true);
  });

  it('rejects broad-only authored question payloads', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      category: 'literature',
      domain: 'literature',
    });

    expect(result.errors).toContain('canonicalSubcategory');
  });


  it('does not require a user-supplied difficulty', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      category: 'literature',
      canonicalSubcategory: 'The Waste Land',
    });

    expect(result.errors).toEqual([]);
    expect('difficulty' in result.value).toBe(false);
  });

  it('does not require friends when sharing to feed', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      category: 'literature',
      canonicalSubcategory: 'The Waste Land',
      shareToFeed: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.value.sendToFriendIds).toEqual([]);
  });
});

describe('normalizeCanonicalSubcategory', () => {
  it('normalizes common T. S. Eliot variants without lowercasing other titles', () => {
    expect(normalizeCanonicalSubcategory('T S Eliot')).toBe('T. S. Eliot');
    expect(normalizeCanonicalSubcategory('The   Waste Land')).toBe('The Waste Land');
  });
});
