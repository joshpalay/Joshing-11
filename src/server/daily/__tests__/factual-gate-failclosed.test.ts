import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LlmQuestion } from '@/server/daily/generate-questions';

// Unit tests for the max_tokens fail-closed branch of findFactualFailures.
// Kept out of factual-gate.test.ts because these mock '@/lib/llm', and that
// file's live evals need the real client.
const loggedMessagesCreate = vi.fn();
vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>();
  return {
    ...actual,
    getAnthropicClient: () => ({}) as never,
    loggedMessagesCreate,
  };
});

// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string (repo convention, mirrors factual-gate.test.ts).
let findFactualFailures: typeof import('@/server/daily/generate-questions').findFactualFailures;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findFactualFailures } = await import('@/server/daily/generate-questions'));
});

function q(text: string): LlmQuestion {
  return {
    canonical_subcategory: 'Beethoven Symphonies',
    broad_category: 'Music',
    question_text: text,
    answer: 'Eroica',
    explainer: 'Context for the answer.',
    difficulty_estimate: 'moderate',
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

function gateResponse(text: string, stopReason: 'end_turn' | 'max_tokens') {
  return { stop_reason: stopReason, content: [{ type: 'text', text }] };
}

describe('findFactualFailures max_tokens handling', () => {
  it('fails CLOSED (drops the whole batch) when the verdict is truncated mid-structure', async () => {
    loggedMessagesCreate.mockResolvedValueOnce(
      gateResponse(
        '{"drop_indices":[0,1],"reasons":{"0":"Neville received ten points not fifty","1":"the choral finale is the Ninth not the Thi',
        'max_tokens',
      ),
    );
    const result = await findFactualFailures([q('a'), q('b'), q('c')]);
    expect([...result.toDrop].sort()).toEqual([0, 1, 2]);
    expect(result.reasons[2]).toContain('truncated');
  });

  it('uses the verdict when max_tokens hit but the JSON object completed', async () => {
    loggedMessagesCreate.mockResolvedValueOnce(
      gateResponse('{"drop_indices":[1],"reasons":{"1":"wrong count"}}', 'max_tokens'),
    );
    const result = await findFactualFailures([q('a'), q('b'), q('c')]);
    expect([...result.toDrop]).toEqual([1]);
    expect(result.reasons[1]).toBe('wrong count');
  });

  it('parses a normal end_turn verdict unchanged', async () => {
    loggedMessagesCreate.mockResolvedValueOnce(
      gateResponse('{"drop_indices":[],"reasons":{}}', 'end_turn'),
    );
    const result = await findFactualFailures([q('a'), q('b')]);
    expect(result.toDrop.size).toBe(0);
  });
});
