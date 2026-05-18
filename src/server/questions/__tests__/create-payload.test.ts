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
      broad_category: 'Literature',
      canonicalSubcategory: '  The   Waste Land  ',
      canonical_subcategory: '  Poetry  ',
      subcategory: 'Modernist Poetry',
      domain: 'TS Eliot',
    });

    expect(result.errors).toEqual([]);
    expect('category' in result.value).toBe(false);
    expect('broadCategory' in result.value).toBe(false);
    expect('broad_category' in result.value).toBe(false);
    expect('canonicalSubcategory' in result.value).toBe(false);
    expect('canonical_subcategory' in result.value).toBe(false);
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

  it('ignores user-supplied difficulty fields', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      difficulty: 5,
      calibratedDifficulty: 1,
      calibrated_difficulty: 2,
      llmDifficulty: 4,
      llm_difficulty: 5,
    });

    expect(result.errors).toEqual([]);
    expect('difficulty' in result.value).toBe(false);
    expect('calibratedDifficulty' in result.value).toBe(false);
    expect('calibrated_difficulty' in result.value).toBe(false);
    expect('llmDifficulty' in result.value).toBe(false);
    expect('llm_difficulty' in result.value).toBe(false);
  });

  it('accepts legacy and form-style share-with-friends flags', () => {
    const payloads = [
      { shareWithFriends: true },
      { share_with_friends: 'true' },
      { share_to_feed: '1' },
      { sharedToFriendsFeed: 'on' },
    ];

    for (const payload of payloads) {
      const result = readCreateQuestionPayload({
        ...basePayload,
        ...payload,
      });

      expect(result.errors).toEqual([]);
      expect(result.value.shareToFeed).toBe(true);
    }
  });

  it('does not require friends when sharing to feed', () => {
    const result = readCreateQuestionPayload({
      ...basePayload,
      shareToFeed: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.value.sendToFriendIds).toEqual([]);
  });

  describe('answer-in-question guard', () => {
    it('rejects when the answer appears verbatim in the question', () => {
      const result = readCreateQuestionPayload({
        text: 'What is the capital of France, which is Paris?',
        correctAnswer: 'Paris',
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).toContain('answerInQuestion');
    });

    it('rejects multi-word answers that appear in the question', () => {
      const result = readCreateQuestionPayload({
        text: "Who wrote The Waste Land, the 1922 poem?",
        correctAnswer: 'The Waste Land',
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).toContain('answerInQuestion');
    });

    it('rejects when an alternate answer leaks into the question', () => {
      const result = readCreateQuestionPayload({
        text: 'Which US state is also nicknamed the Empire State?',
        correctAnswer: 'New York',
        alternateAnswers: ['Empire State'],
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).toContain('answerInQuestion');
    });

    it('is case- and punctuation-insensitive', () => {
      const result = readCreateQuestionPayload({
        text: 'In 1969, who took "one small step" on the moon?',
        correctAnswer: 'one small step',
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).toContain('answerInQuestion');
    });

    it('does not trigger on partial word overlap', () => {
      const result = readCreateQuestionPayload({
        text: 'Which French city served as the setting for the Burning of Notre-Dame?',
        correctAnswer: 'Paris',
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).not.toContain('answerInQuestion');
    });

    it('does not flag short answers like "no"', () => {
      const result = readCreateQuestionPayload({
        text: 'Is there snow on Mount Everest year-round?',
        correctAnswer: 'No',
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).not.toContain('answerInQuestion');
    });

    it('does not trigger on answers that are only a substring of a question word', () => {
      const result = readCreateQuestionPayload({
        text: 'What country is famous for hosting the Cannes Film Festival?',
        correctAnswer: 'an',
        verified: true,
        critiqueIterations: 0,
      });

      expect(result.errors).not.toContain('answerInQuestion');
    });
  });
});

describe('normalizeCanonicalSubcategory', () => {
  it('normalizes common T. S. Eliot variants without lowercasing other titles', () => {
    expect(normalizeCanonicalSubcategory('T S Eliot')).toBe('T. S. Eliot');
    expect(normalizeCanonicalSubcategory('The   Waste Land')).toBe('The Waste Land');
  });
});
