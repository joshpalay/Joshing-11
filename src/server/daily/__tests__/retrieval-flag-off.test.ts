import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// BP-7 Phase 3: while RETRIEVAL_GROUNDING_ENABLED is off, a real pool-refill
// run must be a hard no-op — zero LLM calls, zero rows persisted — even when
// an Anthropic client IS available (proving the flag alone blocks, not a
// missing key). The off→on path stays clean: flipping the flag + providing
// RETRIEVAL_SYSTEM_USER_ID is all the route needs (docs/retrieval-flip-checklist.md).

const mocks = vi.hoisted(() => ({
  loggedMessagesCreate: vi.fn(),
}));

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>();
  return {
    ...actual,
    // Client available on purpose — the flag must block on its own.
    getAnthropicClient: () => ({}) as never,
    loggedMessagesCreate: mocks.loggedMessagesCreate,
  };
});

vi.mock('@/server/db', () => ({ db: {}, generatedQuestions: {} }));
vi.mock('@/server/pool/dedup', () => ({ embedAndResolveDuplicate: vi.fn() }));

import { runPoolRefill } from '@/server/daily/retrieval-grounded';

const FLAG_VARS = ['RETRIEVAL_GROUNDING_ENABLED', 'RETRIEVAL_SYSTEM_USER_ID'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of FLAG_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of FLAG_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('pool refill with RETRIEVAL_GROUNDING_ENABLED off', () => {
  it('a real run is a hard no-op: no LLM calls, nothing persisted, reason names the flag', async () => {
    const report = await runPoolRefill();

    expect(report.enabled).toBe(false);
    expect(report.reason).toContain('RETRIEVAL_GROUNDING_ENABLED');
    expect(report.questionsPersisted).toBe(0);
    expect(report.domainsProcessed).toBe(0);
    expect(report.usdSpent).toBe(0);
    expect(mocks.loggedMessagesCreate).not.toHaveBeenCalled();
  });
});
