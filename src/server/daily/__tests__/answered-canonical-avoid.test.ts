import { beforeEach, describe, expect, it, vi } from 'vitest';

// BP-6 / audit Q8 regression: canonical questions the player answered via a
// friend's feed send, a milestone click-through, or a house slot carry no
// fact_key, so generation could re-create the same fact the next day. The fix
// folds recently-answered canonical texts — domain-scoped and capped — into
// the ADVISORY avoid list. This test drives the +2 path through a bank miss
// and asserts the in-domain answered text reaches the Sonnet generation
// prompt while an out-of-domain one is scoped away.

const mocks = vi.hoisted(() => ({
  getRecentDailyQuestionTexts: vi.fn(),
  getRecentFactKeys: vi.fn(),
  getAuthoredQuestionTexts: vi.fn(),
  getRecentAnsweredCanonicalTexts: vi.fn(),
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

const ANSWERED_IN_DOMAIN = 'Scarpia is the villain in what Puccini opera?';
const ANSWERED_OTHER_DOMAIN = "What physical anomaly is Anne Boleyn rumored to have had?";

function llmText(text: string) {
  return { content: [{ type: 'text', text }] };
}

// Canned per-tag responses so the full pipeline (generation + gates +
// ask-to-answer) runs deterministically.
function respondByTag(tag: string) {
  switch (tag) {
    case 'generate-questions':
      return llmText(
        JSON.stringify({
          questions: [
            {
              canonical_subcategory: 'Puccini Operas',
              broad_category: 'Music',
              question_text: 'In Tosca, what does Cavaradossi paint in Act I?',
              answer: 'a portrait of Mary Magdalene',
              explainer: 'He is painting the Magdalene in the church.',
              difficulty_estimate: 'accessible',
              fact_key: 'tosca-cavaradossi-act1-painting',
              sub_angles: ['Tosca Act I'],
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
      return llmText('a portrait of Mary Magdalene');
    case 'ask-to-answer-judge':
      return llmText(JSON.stringify({ pass_indices: [0], drop_indices: [], reasons: {} }));
    default:
      return llmText('{}');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRecentDailyQuestionTexts.mockResolvedValue([]);
  mocks.getRecentFactKeys.mockResolvedValue([]);
  mocks.getAuthoredQuestionTexts.mockResolvedValue([]);
  mocks.getRecentAnsweredCanonicalTexts.mockResolvedValue([
    { domain: 'Puccini Operas', text: ANSWERED_IN_DOMAIN },
    { domain: 'Tudor England', text: ANSWERED_OTHER_DOMAIN },
  ]);
  mocks.pickBankSource.mockResolvedValue(null); // bank miss -> Sonnet path
  mocks.loggedMessagesCreate.mockImplementation(async (_client, tag) => respondByTag(tag));
});

describe('answered-canonical texts reach the generation avoid list (Q8)', () => {
  it('folds the in-domain answered text into the Sonnet prompt; scopes out other domains', async () => {
    const results = await generateBonusQuestionsForDomains('viewer-1', ['Puccini Operas']);
    expect(results).toHaveLength(1);

    const genCall = mocks.loggedMessagesCreate.mock.calls.find(([, tag]) => tag === 'generate-questions');
    expect(genCall).toBeDefined();
    const userContent = genCall![2].messages[0].content as string;

    expect(userContent).toContain(ANSWERED_IN_DOMAIN);
    expect(userContent).not.toContain(ANSWERED_OTHER_DOMAIN);
  });

  it('survives a failed answered-canonical read (advisory, resilient)', async () => {
    mocks.getRecentAnsweredCanonicalTexts.mockRejectedValue(new Error('db hiccup'));
    const results = await generateBonusQuestionsForDomains('viewer-1', ['Puccini Operas']);
    expect(results).toHaveLength(1);
  });
});
