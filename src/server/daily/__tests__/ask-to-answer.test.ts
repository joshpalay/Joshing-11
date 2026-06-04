import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ask-to-answer.ts only depends on @/lib/llm (no DB), so we mock that module to
// drive the cold-solver + judge calls deterministically. loggedMessagesCreate is
// dispatched by the `scope` argument: cold answers vs the batched judge verdict.
const llmMock = vi.hoisted(() => ({
  loggedMessagesCreate: vi.fn(),
  getAnthropicClient: vi.fn(() => ({}) as unknown),
}));

vi.mock('@/lib/llm', () => ({
  HAIKU_GATE_TIMEOUT_MS: 1000,
  HAIKU_MODEL: 'claude-haiku-test',
  INSTRUCTION_USER_INPUT_GUIDANCE: '',
  extractTextContent: (content: unknown) => String((content as { text: string }).text),
  parseJsonObject: (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  wrapUserInput: (_tag: string, body: string) => body,
  getAnthropicClient: llmMock.getAnthropicClient,
  loggedMessagesCreate: llmMock.loggedMessagesCreate,
}));

const {
  askToAnswerBatch,
  parseJudgeResponse,
  resolveMachineTrustTier,
} = await import('@/server/daily/ask-to-answer');

const CONFIG = { enabled: true, samples: 3, coldTemperature: 0.7 };

function judgeResponse(json: object) {
  return { content: { text: JSON.stringify(json) } };
}

beforeEach(() => {
  llmMock.getAnthropicClient.mockReturnValue({});
  llmMock.loggedMessagesCreate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('parseJudgeResponse', () => {
  it('collects pass and drop indices and reasons', () => {
    const r = parseJudgeResponse(
      '{"pass_indices":[0],"drop_indices":[1],"reasons":{"1":"cold solver said Paris, not Berlin"}}',
      2,
    );
    expect([...r.verified]).toEqual([0]);
    expect([...r.toDrop]).toEqual([1]);
    expect(r.reasons[1]).toContain('Paris');
  });

  it('lets a clear DROP win over a contradictory PASS for the same index', () => {
    const r = parseJudgeResponse('{"pass_indices":[0],"drop_indices":[0]}', 1);
    expect(r.toDrop.has(0)).toBe(true);
    expect(r.verified.has(0)).toBe(false);
  });

  it('ignores out-of-range / non-integer indices and malformed input', () => {
    expect(parseJudgeResponse('{"pass_indices":[5,-1,1.5]}', 2).verified.size).toBe(0);
    for (const raw of ['not json', '[]', '{}']) {
      const r = parseJudgeResponse(raw, 2);
      expect(r.verified.size).toBe(0);
      expect(r.toDrop.size).toBe(0);
    }
  });
});

describe('resolveMachineTrustTier', () => {
  it('promotes to machine_verified on either positive signal', () => {
    expect(resolveMachineTrustTier({ askToAnswerVerified: true, corroborated: false })).toBe('machine_verified');
    expect(resolveMachineTrustTier({ askToAnswerVerified: false, corroborated: true })).toBe('machine_verified');
    expect(resolveMachineTrustTier({ askToAnswerVerified: true, corroborated: true })).toBe('machine_verified');
  });

  it('leaves a row with no positive signal unverified', () => {
    expect(resolveMachineTrustTier({ askToAnswerVerified: false, corroborated: false })).toBe('unverified');
  });
});

describe('askToAnswerBatch (checkpoint)', () => {
  it('drops a fabricated-answer question and passes a solid one', async () => {
    // Cold calls always succeed (so the batch is evaluated); the judge renders the
    // verdict: index 0 (solid) passes, index 1 (fabricated stored answer) drops.
    llmMock.loggedMessagesCreate.mockImplementation(async (_client, scope) => {
      if (scope === 'ask-to-answer-cold') return { content: { text: 'some cold answer' } };
      return judgeResponse({ pass_indices: [0], drop_indices: [1], reasons: { 1: 'cold solver disagreed' } });
    });

    const result = await askToAnswerBatch(
      [
        { questionText: 'What is 2 + 2?', answer: '4' },
        { questionText: 'What is the capital of France?', answer: 'Berlin' },
      ],
      CONFIG,
    );

    expect([...result.verified]).toEqual([0]);
    expect([...result.toDrop]).toEqual([1]);
    // 3 samples × 2 questions cold calls + 1 judge call.
    expect(llmMock.loggedMessagesCreate).toHaveBeenCalledTimes(7);
  });

  it('fails open (drops/verifies nothing) when no client is configured', async () => {
    llmMock.getAnthropicClient.mockReturnValue(null);
    const result = await askToAnswerBatch([{ questionText: 'q', answer: 'a' }], CONFIG);
    expect(result.toDrop.size).toBe(0);
    expect(result.verified.size).toBe(0);
    expect(llmMock.loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it('fails open when every cold attempt errors (LLM outage)', async () => {
    llmMock.loggedMessagesCreate.mockRejectedValue(new Error('timeout'));
    const result = await askToAnswerBatch([{ questionText: 'q', answer: 'a' }], CONFIG);
    expect(result.toDrop.size).toBe(0);
    expect(result.verified.size).toBe(0);
    // Judge is never reached when all cold attempts fail.
    expect(llmMock.loggedMessagesCreate).toHaveBeenCalledTimes(CONFIG.samples);
  });

  it('is a no-op when disabled', async () => {
    const result = await askToAnswerBatch([{ questionText: 'q', answer: 'a' }], {
      ...CONFIG,
      enabled: false,
    });
    expect(result.toDrop.size).toBe(0);
    expect(llmMock.loggedMessagesCreate).not.toHaveBeenCalled();
  });
});
