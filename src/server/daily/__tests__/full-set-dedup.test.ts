// Full-set dedup (D-SUPPLY-NEVER-REPEAT-01): the persist path must drop a
// generated question whose fact the viewer has ALREADY ANSWERED even when the
// recency-capped avoid set (getRecentFactKeys, 200) has aged that fact out —
// the exact leak a 445-fact history opens. Runs the real generation pipeline
// with a canned LLM and asserts the uncapped DB check (getAnsweredFactKeysAmong)
// is what drops it; also proves the check fails OPEN (a DB error never blocks
// the batch).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRecentDailyQuestionTexts: vi.fn(),
  getRecentFactKeys: vi.fn(),
  getAuthoredQuestionTexts: vi.fn(),
  getRecentAnsweredCanonicalTexts: vi.fn(),
  getAnsweredFactKeysAmong: vi.fn(),
  pickBankSource: vi.fn(),
  loggedMessagesCreate: vi.fn(),
}));

vi.mock('@/server/db/queries/daily', () => ({
  getRecentDailyQuestionTexts: mocks.getRecentDailyQuestionTexts,
  getRecentFactKeys: mocks.getRecentFactKeys,
  getAuthoredQuestionTexts: mocks.getAuthoredQuestionTexts,
  getRecentAnsweredCanonicalTexts: mocks.getRecentAnsweredCanonicalTexts,
  getRecentAnsweredAnswerKeys: vi.fn(async () => new Set<string>()),
  getRecentAnsweredEntities: vi.fn(async () => new Set<string>()),
  getAnsweredFactKeysAmong: mocks.getAnsweredFactKeysAmong,
  getRecentDomainCounts: vi.fn(),
  getRecentSkipCountsByDomain: vi.fn(),
  getRecentSubAnglesByDomain: vi.fn(),
  getKnowledgeBase: vi.fn(),
  pickBankSource: mocks.pickBankSource,
  normalizeQuestionText: (text: string) => text.trim().toLowerCase(),
}));

vi.mock('@/server/db', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => [{ id: 'row-1', ...values }],
      }),
    }),
  },
  generatedQuestions: {},
}));

vi.mock('@/server/pool/dedup', () => ({
  embedAndResolveDuplicate: vi.fn(async () => undefined),
  embedAndResolveDuplicatesBatch: vi.fn(async () => undefined),
}));

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>();
  return {
    ...actual,
    getAnthropicClient: () => ({}) as never,
    generateInsideJoke: vi.fn(async () => null),
    loggedMessagesCreate: mocks.loggedMessagesCreate,
  };
});

import { generateBonusQuestionsForDomains } from '@/server/daily/generate-questions';

const FLUTE_FACT_KEY = 'star-trek-inner-light-picard-flute';

function llmText(text: string) {
  return { content: [{ type: 'text', text }] };
}

// Canned per-tag responses: the LLM re-proposes an already-answered fact (the
// flute) — exactly what happens when the prompt's capped avoid slice no longer
// carries it.
function respondByTag(tag: string) {
  switch (tag) {
    case 'generate-questions':
      return llmText(
        JSON.stringify({
          questions: [
            {
              canonical_subcategory: 'Star Trek',
              broad_category: 'TV & Film',
              question_text:
                "In 'The Inner Light', what instrument does Picard learn to play?",
              answer: 'the Ressikan flute',
              explainer: 'He lives a lifetime on Kataan and keeps the flute.',
              difficulty_estimate: 'accessible',
              fact_key: FLUTE_FACT_KEY,
              sub_angles: ['The Inner Light'],
              question_shape: 'who_did_what',
            },
          ],
        }),
      );
    case 'batch-dedupe':
    case 'history-dedupe':
      return llmText(JSON.stringify({ duplicate_indices: [] }));
    case 'quality-gate':
    case 'factual-gate':
      return llmText(JSON.stringify({ drop_indices: [], reasons: {} }));
    case 'ask-to-answer-cold':
      return llmText('the Ressikan flute');
    case 'ask-to-answer-judge':
      return llmText(JSON.stringify({ pass_indices: [0], drop_indices: [], reasons: {} }));
    default:
      return llmText('{}');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRecentDailyQuestionTexts.mockResolvedValue([]);
  // CRITICAL setup: the capped avoid list does NOT carry the flute — it aged
  // out of the 200-entry window. Only the uncapped DB check knows it.
  mocks.getRecentFactKeys.mockResolvedValue([]);
  mocks.getAuthoredQuestionTexts.mockResolvedValue([]);
  mocks.getRecentAnsweredCanonicalTexts.mockResolvedValue([]);
  mocks.getAnsweredFactKeysAmong.mockResolvedValue(new Set<string>());
  mocks.pickBankSource.mockResolvedValue(null); // bank miss -> Sonnet path
  mocks.loggedMessagesCreate.mockImplementation(async (_client, tag) => respondByTag(tag));
});

describe('full-set dedup at persist (D-SUPPLY-NEVER-REPEAT-01)', () => {
  it('drops a re-proposed fact the viewer answered even when the capped avoid set missed it', async () => {
    mocks.getAnsweredFactKeysAmong.mockResolvedValue(new Set([FLUTE_FACT_KEY]));
    const results = await generateBonusQuestionsForDomains('viewer-1', ['Star Trek']);
    expect(results).toHaveLength(0);
    // The check ran against this batch's candidate keys.
    const [, keys] = mocks.getAnsweredFactKeysAmong.mock.calls[0];
    expect(keys).toContain(FLUTE_FACT_KEY);
  });

  it('persists normally when the fact is genuinely new', async () => {
    const results = await generateBonusQuestionsForDomains('viewer-1', ['Star Trek']);
    expect(results).toHaveLength(1);
    // The bonus path returns {domain, question} wrappers.
    expect(results[0]).toMatchObject({ question: { factKey: FLUTE_FACT_KEY } });
  });

  it('fails open: a DB error in the full-set check never blocks the batch', async () => {
    mocks.getAnsweredFactKeysAmong.mockRejectedValue(new Error('db down'));
    const results = await generateBonusQuestionsForDomains('viewer-1', ['Star Trek']);
    expect(results).toHaveLength(1);
  });
});
