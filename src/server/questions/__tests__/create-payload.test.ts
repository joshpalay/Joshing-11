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

  it('ignores user-supplied broad and specific categories', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      category: 'literature',
      broadCategory: 'Literature',
      canonicalSubcategory: '  The   Waste Land  ',
      subcategory: 'Modernist Poetry',
      domain: 'TS Eliot',
    });

    expect(result.errors).toEqual([]);
    expect('category' in result.value).toBe(false);
    expect('broadCategory' in result.value).toBe(false);
    expect('canonicalSubcategory' in result.value).toBe(false);
    expect('subcategory' in result.value).toBe(false);
    expect('domain' in result.value).toBe(false);
  });

  it('accepts question text and answer without category fields', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      shareToFeed: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.value.text).toBe(basePayload.text);
    expect(result.value.correctAnswer).toBe(basePayload.correctAnswer);
    expect(result.value.shareToFeed).toBe(true);
  });

  it('does not reject broad-only authored question payloads because LLM categorization owns the domain', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      category: 'literature',
      domain: 'literature',
    });

    expect(result.errors).toEqual([]);
    expect('category' in result.value).toBe(false);
    expect('domain' in result.value).toBe(false);
  });

  it('does not accept a user-supplied difficulty', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      difficulty: 5,
    });

    expect(result.errors).toEqual([]);
    expect('difficulty' in result.value).toBe(false);
  });

  it('does not require friends when sharing to feed', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
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
