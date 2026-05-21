import { describe, expect, it, beforeEach, vi } from 'vitest'

import { normalizeCanonicalSubcategory } from '@/lib/question-categorization'

const createMessageMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  // Anthropic is invoked with `new Anthropic({ apiKey })`, so the default export
  // must be constructable. A class returning the mocked messages.create works;
  // a vi.fn() factory does not (Node's new-call coercion rejects arrow fns).
  default: class MockAnthropic {
    messages = { create: createMessageMock };
  },
}))

function anthropicTextResponse(json: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    // loggedMessagesCreate reads response.usage.input_tokens etc.; without
    // this stub the mocked call throws and categorizeQuestion falls back.
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

async function importCategorizer() {
  const mod = await import('@/lib/llm')
  return mod.categorizeQuestion
}

describe('categorizeQuestion final subcategory guard', () => {
  beforeEach(() => {
    createMessageMock.mockReset()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length'
    process.env.LLM_ENABLED = 'true'
  })

  it('replaces an LLM "Other" subcategory with a specific answer-derived literature domain', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Other',
          broad_category: 'Literature',
          confidence: 0.91,
        })
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Other' }))

    const categorizeQuestion = await importCategorizer()
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost'
    )

    expect(result).toEqual({
      subcategory: 'Paradise Lost',
      broad_category: 'Literature',
      confidence: 0.91,
    })
    expect(result.subcategory).not.toBe('Other')
  })

  it('replaces a subcategory that repeats its broad category', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Literature',
          broad_category: 'Literature',
          confidence: 0.86,
        })
      )
      .mockResolvedValueOnce(
        anthropicTextResponse({ subcategory: 'Literature' })
      )

    const categorizeQuestion = await importCategorizer()
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost'
    )

    expect(result.subcategory).toBe('Paradise Lost')
    expect(result.subcategory).not.toBe(result.broad_category)
  })

  it('uses the deterministic final guard when refinement also returns a generic value', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Other',
          broad_category: 'Literature',
          confidence: 0.72,
        })
      )
      .mockResolvedValueOnce(
        anthropicTextResponse({ subcategory: 'General Knowledge' })
      )

    const categorizeQuestion = await importCategorizer()
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost'
    )

    expect(createMessageMock).toHaveBeenCalledTimes(2)
    expect(result.subcategory).toBe('Paradise Lost')
  })

  it('keeps the final persisted domain specific and never Other', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          subcategory: 'Other',
          broad_category: 'Literature',
          confidence: 0.8,
        })
      )
      .mockResolvedValueOnce(anthropicTextResponse({ subcategory: 'Trivia' }))

    const categorizeQuestion = await importCategorizer()
    const result = await categorizeQuestion(
      'What epic poem by John Milton includes the fall of Adam and Eve?',
      'Paradise Lost'
    )
    const persistedDomain =
      normalizeCanonicalSubcategory(result.subcategory) || 'General Knowledge'

    expect(persistedDomain).toBe('Paradise Lost')
    expect(persistedDomain).not.toBe('Other')
    expect(persistedDomain).not.toBe('General Knowledge')
    expect(persistedDomain).not.toBe('Trivia')
    expect(persistedDomain).not.toBe(result.broad_category)
  })
})
