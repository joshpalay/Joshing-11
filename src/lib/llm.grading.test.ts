import { describe, expect, it, beforeEach, vi } from 'vitest'

const createMessageMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMessageMock };
  },
}))

function anthropicTextResponse(json: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

async function importGrader() {
  const mod = await import('@/lib/llm')
  return mod.gradeAnswerWithLLM
}

describe('gradeAnswerWithLLM', () => {
  beforeEach(() => {
    createMessageMock.mockReset()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length'
    process.env.LLM_ENABLED = 'true'
  })

  it('passes the canonical answer and submitted answer in the user message', async () => {
    createMessageMock.mockResolvedValueOnce(
      anthropicTextResponse({ result: 'correct', confidence: 0.9, reason: 'matches generic descriptor', consolation: null }),
    )

    const gradeAnswerWithLLM = await importGrader()
    await gradeAnswerWithLLM(
      "In the TNG episode 'The Inner Light,' Picard lives an entire lifetime as a man named Katan on a dying alien world. What object, which he learns to play during his 'life' on that world, does he find aboard the Enterprise when he awakens?",
      'A Ressikan flute (a small flute)',
      'A penny whistle flute thungy',
      'factual',
    )

    expect(createMessageMock).toHaveBeenCalledOnce()
    const callArgs = createMessageMock.mock.calls[0]![0] as {
      system: string | Array<{ text: string }>
      messages: Array<{ content: string }>
    }
    expect(callArgs.messages[0]!.content).toContain('A Ressikan flute (a small flute)')
    expect(callArgs.messages[0]!.content).toContain('A penny whistle flute thungy')
  })

  it('returns correct when the model accepts the answer', async () => {
    createMessageMock.mockResolvedValueOnce(
      anthropicTextResponse({ result: 'correct', confidence: 0.85, reason: 'matches generic descriptor', consolation: null }),
    )

    const gradeAnswerWithLLM = await importGrader()
    const outcome = await gradeAnswerWithLLM(
      'What instrument does Picard find aboard the Enterprise?',
      'A Ressikan flute (a small flute)',
      'A penny whistle flute thungy',
      'factual',
    )

    expect(outcome.status).toBe('scored')
    if (outcome.status !== 'scored') throw new Error('expected scored')
    expect(outcome.result).toBe('correct')
    expect(outcome.consolation).toBeNull()
  })

  // Regression: production was returning the user-facing "answer-checker is taking
  // a quick breather" 503 on successfully graded answers because Haiku replied with
  // a non-canonical result label (e.g. "incorrect", "Correct", "yes") and the parser
  // only accepted the exact literals 'correct'/'wrong'. These must coerce, not fall back.
  it.each([
    ['Correct', 'correct'],
    ['incorrect', 'wrong'],
    ['yes', 'correct'],
    ['no', 'wrong'],
    ['  RIGHT  ', 'correct'],
    [true, 'correct'],
    [false, 'wrong'],
  ] as const)('normalizes a result of %p to %p instead of falling back', async (raw, expected) => {
    createMessageMock.mockResolvedValueOnce(
      anthropicTextResponse({ result: raw, confidence: 0.8, reason: 'ok', consolation: null }),
    )

    const gradeAnswerWithLLM = await importGrader()
    const outcome = await gradeAnswerWithLLM('q', 'canonical', 'submitted', 'factual')

    expect(outcome.status).toBe('scored')
    if (outcome.status !== 'scored') throw new Error('expected scored')
    expect(outcome.result).toBe(expected)
    expect(createMessageMock).toHaveBeenCalledOnce()
  })

  it('retries once on a malformed reply, then returns the clean verdict (no fallback)', async () => {
    createMessageMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }], usage: {} })
      .mockResolvedValueOnce(
        anthropicTextResponse({ result: 'correct', confidence: 0.9, reason: 'ok', consolation: null }),
      )

    const gradeAnswerWithLLM = await importGrader()
    const outcome = await gradeAnswerWithLLM('q', 'canonical', 'submitted', 'factual')

    expect(outcome.status).toBe('scored')
    if (outcome.status !== 'scored') throw new Error('expected scored')
    expect(outcome.result).toBe('correct')
    expect(createMessageMock).toHaveBeenCalledTimes(2)
  })

  it('falls back only after the retry also fails', async () => {
    createMessageMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'nope' }], usage: {} })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still nope' }], usage: {} })

    const gradeAnswerWithLLM = await importGrader()
    const outcome = await gradeAnswerWithLLM('q', 'canonical', 'submitted', 'factual')

    expect(outcome.status).toBe('unscored')
    expect(createMessageMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry (or call the model) when there is no usable client', async () => {
    process.env.ANTHROPIC_API_KEY = ''

    const gradeAnswerWithLLM = await importGrader()
    const outcome = await gradeAnswerWithLLM('q', 'canonical', 'submitted', 'factual')

    expect(outcome.status).toBe('unscored')
    if (outcome.status !== 'unscored') throw new Error('expected unscored')
    expect(outcome.reason).toBe('no_client')
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it('includes the parenthetical-descriptor leniency rule in the system prompt', async () => {
    // Regression guard: the Ressikan-flute case ("penny whistle flute thungy") was
    // marked wrong before this rule existed. If the rule is deleted, that bug returns.
    createMessageMock.mockResolvedValueOnce(
      anthropicTextResponse({ result: 'correct', confidence: 0.9, reason: 'ok', consolation: null }),
    )

    const gradeAnswerWithLLM = await importGrader()
    await gradeAnswerWithLLM('q', 'A Ressikan flute (a small flute)', 'penny whistle', 'factual')

    const systemArg = (createMessageMock.mock.calls[0]![0] as { system: string | Array<{ text: string }> }).system
    const systemPrompt = typeof systemArg === 'string' ? systemArg : systemArg[0]!.text
    expect(systemPrompt).toMatch(/parenthetical generic descriptor/i)
    expect(systemPrompt).toMatch(/thing|thingy|thingamajig/i)
  })
})
