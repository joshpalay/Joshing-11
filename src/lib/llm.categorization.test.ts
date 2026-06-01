import { describe, expect, it, beforeEach, vi } from 'vitest';

import { normalizeCanonicalSubcategory } from '@/lib/question-categorization';

const createMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  // Anthropic is invoked with `new Anthropic({ apiKey })`, so the default export
  // must be constructable. A class returning the mocked messages.create works;
  // a vi.fn() factory does not (Node's new-call coercion rejects arrow fns).
  default: class MockAnthropic {
    messages = { create: createMessageMock };
  },
}));

function anthropicTextResponse(json: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    // loggedMessagesCreate reads response.usage.input_tokens etc.; without
    // this stub the mocked call throws and categorizeQuestion falls back.
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

async function importCategorizer() {
  const mod = await import('@/lib/llm');
  return mod.categorizeQuestion;
}

describe('categorizeQuestion final subcategory guard', () => {
  beforeEach(() => {
    createMessageMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length';
    process.env.LLM_ENABLED = 'true';
  });

  it('replaces an LLM "Other" subcategory with a specific answer-derived literature domain', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Other',
          broad_category: 'Literature',
          confidence: 0.91,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Other' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost',
    );

    expect(result).toEqual({
      subcategory: 'Paradise Lost',
      broad_category: 'Literature',
      confidence: 0.91,
    });
    expect(result.subcategory).not.toBe('Other');
  });

  it('replaces a subcategory that repeats its broad category', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Literature',
          broad_category: 'Literature',
          confidence: 0.86,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Literature' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost',
    );

    expect(result.subcategory).toBe('Paradise Lost');
    expect(result.subcategory).not.toBe(result.broad_category);
  });

  it('uses the deterministic final guard when refinement also returns a generic value', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Other',
          broad_category: 'Literature',
          confidence: 0.72,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'General Knowledge' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost',
    );

    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(result.subcategory).toBe('Paradise Lost');
  });

  it('keeps the final persisted domain specific and never Other', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Other',
          broad_category: 'Literature',
          confidence: 0.8,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Trivia' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost',
    );
    const persistedDomain =
      normalizeCanonicalSubcategory(result.subcategory) || 'General Knowledge';

    expect(persistedDomain).toBe('Paradise Lost');
    expect(persistedDomain).not.toBe('Other');
    expect(persistedDomain).not.toBe('General Knowledge');
    expect(persistedDomain).not.toBe('Trivia');
    expect(persistedDomain).not.toBe(result.broad_category);
  });
});

describe('categorizeQuestion de-leak retry', () => {
  beforeEach(() => {
    createMessageMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length';
    process.env.LLM_ENABLED = 'true';
  });

  it('re-prompts when the LLM picks the answer as the subcategory', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: "Robert's Rules of Order",
          broad_category: 'Civics',
          confidence: 0.9,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Parliamentary Procedure' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What is the standard parliamentary authority used by most US organizations?',
      "Robert's Rules of Order",
      ['RONR', "Robert's Rules", 'Rules of Order'],
    );

    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(result.subcategory).toBe('Parliamentary Procedure');
  });

  it('re-prompts when the LLM picks an alternate answer as the subcategory', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Soil Acidity',
          broad_category: 'Gardening',
          confidence: 0.85,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Hydrangea Cultivation' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What is the factor that makes hydrangeas pink or blue?',
      'Soil pH',
      ['Soil acidity', 'Aluminum availability'],
    );

    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(result.subcategory).toBe('Hydrangea Cultivation');
  });

  it('keeps the original leaky subcategory if the retry also leaks (API guard handles it)', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: "Robert's Rules of Order",
          broad_category: 'Civics',
          confidence: 0.9,
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Rules of Order' }));

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What is the standard parliamentary authority used by most US organizations?',
      "Robert's Rules of Order",
      ['Rules of Order'],
    );

    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(result.subcategory).toBe("Robert's Rules of Order");
  });

  it('does not retry when the subcategory does not leak the answer', async () => {
    createMessageMock.mockResolvedValueOnce(
      anthropicTextResponse({
        subcategory: 'Parliamentary Procedure',
        broad_category: 'Civics',
        confidence: 0.9,
      }),
    );

    const categorizeQuestion = await importCategorizer();
    const result = await categorizeQuestion(
      'What is the standard parliamentary authority used by most US organizations?',
      "Robert's Rules of Order",
    );

    expect(createMessageMock).toHaveBeenCalledTimes(1);
    expect(result.subcategory).toBe('Parliamentary Procedure');
  });
});
