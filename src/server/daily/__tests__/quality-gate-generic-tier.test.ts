import { beforeEach, describe, expect, it, vi } from 'vitest';

// BP-4 plumbing tests for the GENERIC_AT_TIER defect class on the quality gate.
// These verify the deterministic parts — the rubric ships in the system prompt,
// each candidate's tier reaches the gate body, drop indices parse, and the gate
// stays fail-open on an LLM error. The model's actual judgment (roster question
// flagged at specialist, passes at accessible, exemplar-style not flagged) is
// non-deterministic and lives in the opt-in live evals:
// quality-gate.eval.test.ts (RUN_LLM_EVALS=1).

const mocks = vi.hoisted(() => ({
  loggedMessagesCreate: vi.fn(),
}));

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>();
  return {
    ...actual,
    getAnthropicClient: () => ({}) as never,
    loggedMessagesCreate: mocks.loggedMessagesCreate,
  };
});

// generate-questions.ts imports @/server/db at module load; the gate under test
// never touches it.
vi.mock('@/server/db', () => ({ db: {}, generatedQuestions: {} }));

import { findQualityFailures, type LlmQuestion } from '@/server/daily/generate-questions';

function q(
  text: string,
  answer: string,
  tier: LlmQuestion['difficulty_estimate'],
  domain = 'Gilmore Girls',
): LlmQuestion {
  return {
    canonical_subcategory: domain,
    broad_category: 'Television',
    question_text: text,
    answer,
    explainer: 'explainer',
    difficulty_estimate: tier,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

// Response shape extractTextContent understands.
function llmResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('quality gate — GENERIC_AT_TIER plumbing', () => {
  it('sends each candidate tier to the gate and ships the tier-gated rubric', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(llmResponse({ drop_indices: [], reasons: {} }));

    await findQualityFailures([
      q("In Gilmore Girls, what is the name of Rory's first boyfriend?", 'Dean Forester', 'specialist'),
      q('What is the title of Beethoven\'s Third Symphony?', 'Eroica', 'accessible', 'Beethoven'),
    ]);

    expect(mocks.loggedMessagesCreate).toHaveBeenCalledTimes(1);
    const [, tag, request] = mocks.loggedMessagesCreate.mock.calls[0];
    expect(tag).toBe('quality-gate');

    const userContent = request.messages[0].content as string;
    expect(userContent).toContain('[0] domain=Gilmore Girls tier=specialist');
    expect(userContent).toContain('[1] domain=Beethoven tier=accessible');

    const system = request.system as string;
    expect(system).toContain('GENERIC_AT_TIER');
    expect(system).toContain('NEVER flag an accessible-tier item');
    expect(system).toContain('when uncertain, do not flag');
  });

  it('parses drop indices and reasons from the gate verdict', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(
      llmResponse({ drop_indices: [0], reasons: { '0': 'GENERIC_AT_TIER: roster question at specialist' } }),
    );

    const result = await findQualityFailures([
      q("In Gilmore Girls, what is the name of Rory's first boyfriend?", 'Dean Forester', 'specialist'),
      q('In American Psycho, what color is Paul Allen\'s business card?', 'bone', 'specialist', 'American Psycho'),
    ]);

    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('GENERIC_AT_TIER');
  });

  it('fails OPEN on a gate error — drops nothing', async () => {
    mocks.loggedMessagesCreate.mockRejectedValue(new Error('anthropic 529'));

    const result = await findQualityFailures([
      q("In Gilmore Girls, what is the name of Rory's first boyfriend?", 'Dean Forester', 'specialist'),
    ]);

    expect(result.toDrop.size).toBe(0);
    expect(result.reasons).toEqual({});
  });
});
