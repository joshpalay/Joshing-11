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
    expect(result.result).toBe('correct');
    expect(result.gradedVia).toBe('exact');
    expect(llmMock.gradeAnswerWithLLM).not.toHaveBeenCalled();
  });

  it('is case-insensitive on the variant match', async () => {
    const result = await gradeAnswer('bach', 'Johann Sebastian Bach', ['Bach'], 'q');
    expect(result.result).toBe('correct');
  });
});

describe('gradeAnswer — fail toward the player on outage (Drift Risk 2)', () => {
  it('tags the verdict gradedVia="fallback" when the grader throws', async () => {
    // gradeAnswer catches the throw and returns the deterministic placeholder.
    llmMock.gradeAnswerWithLLM.mockRejectedValue(new Error('anthropic 529'));
    const result = await gradeAnswer('some answer', 'the real answer', [], 'q');
    // The sentinel every answer route now branches on to defer instead of
    // persisting a wrong. The result field is a placeholder, NOT a real verdict.
    expect(result.gradedVia).toBe('fallback');
    expect(result.confidence).toBe(0);
  });

  it('passes through a genuine LLM verdict as gradedVia="llm"', async () => {
    llmMock.gradeAnswerWithLLM.mockResolvedValue({
      result: 'wrong',
      confidence: 0.9,
      reason: 'different person',
      consolation: 'close!',
    });
    const result = await gradeAnswer('wrong answer', 'right answer', [], 'q');
    expect(result.gradedVia).toBe('llm');
    expect(result.result).toBe('wrong'); // a REAL wrong is a connection event — allowed
  });
});
