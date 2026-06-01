import { describe, expect, it, beforeEach, vi } from 'vitest';

const createMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMessageMock };
  },
}));

function anthropicTextResponse(json: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

async function importModule() {
  return import('@/server/llm/suggest-question');
}

describe('parseVerifierResponse', () => {
  it('reads a WRONG verdict with a corrected answer', async () => {
    const { parseVerifierResponse } = await importModule();
    expect(
      parseVerifierResponse('{"verdict":"WRONG","corrected_answer":"genuine leather"}'),
    ).toEqual({
      verdict: 'WRONG',
      correctedAnswer: 'genuine leather',
    });
  });

  it('treats malformed or unknown output as fail-open UNVERIFIABLE', async () => {
    const { parseVerifierResponse } = await importModule();
    for (const raw of ['not json', '{}', '{"verdict":"maybe"}', '[]']) {
      expect(parseVerifierResponse(raw)).toEqual({
        verdict: 'UNVERIFIABLE',
        correctedAnswer: null,
      });
    }
  });

  it('nulls an empty corrected_answer on a WRONG verdict', async () => {
    const { parseVerifierResponse } = await importModule();
    expect(parseVerifierResponse('{"verdict":"WRONG","corrected_answer":"  "}')).toEqual({
      verdict: 'WRONG',
      correctedAnswer: null,
    });
  });
});

describe('suggestQuestionAnswer', () => {
  beforeEach(() => {
    createMessageMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length';
    process.env.LLM_ENABLED = 'true';
  });

  it('parses and discards the internal reasoning field', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          reasoning: 'entity = the surrey; attribute = dashboard → genuine leather',
          correctAnswer: 'genuine leather',
          alternateAnswers: ['leather'],
          explanation: 'The song describes the dashboard as genuine leather.',
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ verdict: 'OK', corrected_answer: null }));

    const { suggestQuestionAnswer } = await importModule();
    const result = await suggestQuestionAnswer('q');

    expect(result).toEqual({
      correctAnswer: 'genuine leather',
      alternateAnswers: ['leather'],
      explanation: 'The song describes the dashboard as genuine leather.',
    });
    expect(result).not.toHaveProperty('reasoning');
  });

  it('regenerates with the correction when the verifier flags the wrong attribute (surrey regression)', async () => {
    createMessageMock
      // 1. generation answers the wrong attribute (curtains, not dashboard)
      .mockResolvedValueOnce(
        anthropicTextResponse({
          reasoning: 'isinglass',
          correctAnswer: 'isinglass',
          alternateAnswers: ['isinglass curtains'],
          explanation: 'Isinglass curtains can be rolled down.',
        }),
      )
      // 2. verifier catches it and supplies the correct answer
      .mockResolvedValueOnce(
        anthropicTextResponse({ verdict: 'WRONG', corrected_answer: 'genuine leather' }),
      )
      // 3. regeneration, seeded with the correction
      .mockResolvedValueOnce(
        anthropicTextResponse({
          reasoning: 'the dashboard is genuine leather',
          correctAnswer: 'genuine leather',
          alternateAnswers: [],
          explanation: 'The surrey in Oklahoma! has a genuine leather dashboard.',
        }),
      );

    const { suggestQuestionAnswer } = await importModule();
    const result = await suggestQuestionAnswer(
      'The surrey with a fringe on top has what kind of dashboard?',
    );

    expect(result.correctAnswer).toBe('genuine leather');
    expect(result.correctAnswer).not.toBe('isinglass');
    expect(createMessageMock).toHaveBeenCalledTimes(3);

    // The retry must carry the correction hint to the generator.
    const retryMessage = (
      createMessageMock.mock.calls[2]![0] as {
        messages: Array<{ content: string }>;
      }
    ).messages[0]!.content;
    expect(retryMessage).toContain('genuine leather');
  });

  it('passes the suggestion through unchanged when the verifier says OK (no regeneration)', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          reasoning: 'ok',
          correctAnswer: 'Mercury',
          alternateAnswers: [],
          explanation: 'Mercury is the closest planet to the Sun.',
        }),
      )
      .mockResolvedValueOnce(anthropicTextResponse({ verdict: 'OK', corrected_answer: null }));

    const { suggestQuestionAnswer } = await importModule();
    const result = await suggestQuestionAnswer('Which planet is closest to the Sun?');

    expect(result.correctAnswer).toBe('Mercury');
    expect(createMessageMock).toHaveBeenCalledTimes(2);
  });

  it('fails open: a verifier error leaves the original suggestion intact', async () => {
    createMessageMock
      .mockResolvedValueOnce(
        anthropicTextResponse({
          reasoning: 'ok',
          correctAnswer: 'Mercury',
          alternateAnswers: [],
          explanation: 'Mercury is the closest planet to the Sun.',
        }),
      )
      .mockRejectedValueOnce(new Error('haiku timeout'));

    const { suggestQuestionAnswer } = await importModule();
    const result = await suggestQuestionAnswer('Which planet is closest to the Sun?');

    expect(result.correctAnswer).toBe('Mercury');
    expect(createMessageMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the generator returns an unusable suggestion', async () => {
    createMessageMock.mockResolvedValueOnce(anthropicTextResponse({ reasoning: 'x' }));

    const { suggestQuestionAnswer } = await importModule();
    await expect(suggestQuestionAnswer('q')).rejects.toThrow('Invalid suggestion response');
  });
});
