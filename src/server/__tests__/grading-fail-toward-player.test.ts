import { afterEach, describe, expect, it, vi } from 'vitest';

// gradeAnswer wraps gradeAnswerWithLLM (@/lib/llm). Mock the LLM so we can drive
// the outage path and the accepted-variant fast path deterministically.
const llmMock = vi.hoisted(() => ({ gradeAnswerWithLLM: vi.fn() }));
vi.mock('@/lib/llm', () => ({ gradeAnswerWithLLM: llmMock.gradeAnswerWithLLM }));

const { gradeAnswer } = await import('@/server/grading');

afterEach(() => {
  vi.clearAllMocks();
});

describe('gradeAnswer — acceptable variants (B4 Phase 4)', () => {
  it('marks a known acceptable variant correct WITHOUT calling the LLM', async () => {
    const result = await gradeAnswer(
      'J.S. Bach',
      'Johann Sebastian Bach',
      ['J.S. Bach', 'Bach'],
      'Who composed the Well-Tempered Clavier?',
    );
    expect(result.status).toBe('scored');
    if (result.status !== 'scored') throw new Error('expected scored');
    expect(result.result).toBe('correct');
    expect(result.gradedVia).toBe('exact');
    expect(llmMock.gradeAnswerWithLLM).not.toHaveBeenCalled();
  });

  it('is case-insensitive on the variant match', async () => {
    const result = await gradeAnswer('bach', 'Johann Sebastian Bach', ['Bach'], 'q');
    expect(result.status).toBe('scored');
    if (result.status !== 'scored') throw new Error('expected scored');
    expect(result.result).toBe('correct');
  });
});

describe('gradeAnswer — fail toward the player on outage (Drift Risk 2)', () => {
  it('returns an UNSCORED outcome (no result field) when the grader throws', async () => {
    // gradeAnswer catches the throw and returns the unscored outcome.
    llmMock.gradeAnswerWithLLM.mockRejectedValue(new Error('anthropic 529'));
    const result = await gradeAnswer('some answer', 'the real answer', [], 'q');
    // The discriminant every answer route now branches on to defer instead of
    // persisting a wrong. There is NO result field — reading a verdict is impossible.
    expect(result.status).toBe('unscored');
    expect(result).not.toHaveProperty('result');
  });

  it('propagates an unscored outcome when the LLM returns one', async () => {
    llmMock.gradeAnswerWithLLM.mockResolvedValue({ status: 'unscored', reason: 'invalid_json' });
    const result = await gradeAnswer('some answer', 'the real answer', [], 'q');
    expect(result.status).toBe('unscored');
    expect(result).not.toHaveProperty('result');
  });

  it('passes through a genuine LLM verdict as a scored gradedVia="llm"', async () => {
    llmMock.gradeAnswerWithLLM.mockResolvedValue({
      status: 'scored',
      result: 'wrong',
      confidence: 0.9,
      reason: 'different person',
      consolation: 'close!',
    });
    const result = await gradeAnswer('wrong answer', 'right answer', [], 'q');
    expect(result.status).toBe('scored');
    if (result.status !== 'scored') throw new Error('expected scored');
    expect(result.gradedVia).toBe('llm');
    expect(result.result).toBe('wrong'); // a REAL wrong is a connection event — allowed
  });
});
