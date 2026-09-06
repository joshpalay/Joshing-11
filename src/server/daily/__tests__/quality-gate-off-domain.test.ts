import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plumbing tests for the OFF_DOMAIN defect — the "Joyce question filed under
// Virginia Woolf" case served to production on 2026-09-05.
//
// The drift was invisible because `canonical_subcategory` is worthless as a
// signal: the generation prompt tells the model to echo the domain it was
// handed, so the field agreed with the request even though the question had
// wandered to another author. `fact_key`, which the model derives from what it
// actually wrote, still said "james-joyce-irish-modernism-...". These tests
// verify that field reaches the gate and that OFF_DOMAIN verdicts are held out
// of the drop set until DOMAIN_DRIFT_DROP_ENABLED is set. The model's actual
// judgment (sibling flagged, containment spared) is non-deterministic and
// belongs in the opt-in live evals.

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

vi.mock('@/server/db', () => ({ db: {}, generatedQuestions: {} }));

import { findQualityFailures, type LlmQuestion } from '@/server/daily/generate-questions';

function q(domain: string, factKey: string | null, text: string): LlmQuestion {
  return {
    canonical_subcategory: domain,
    broad_category: 'Literature',
    question_text: text,
    answer: 'answer',
    explainer: 'explainer',
    difficulty_estimate: 'moderate',
    fact_key: factKey,
    sub_angles: [],
    question_shape: null,
  };
}

function llmResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] };
}

// The row as it was actually generated: filed under Woolf, fact_key confessing Joyce.
const DRIFTED = q(
  "Virginia Woolf's Novels and Essays",
  'james-joyce-irish-modernism-portrait-of-the-artist-as-a-young-man-a-petition-cal',
  "In Joyce's 'A Portrait of the Artist as a Young Man,' Stephen Dedalus refuses to sign a petition…",
);
// Correctly filed: Mrs. Dalloway IS a Woolf novel. Containment, not drift.
const CONTAINED = q(
  "Virginia Woolf's Novels and Essays",
  'mrs-dalloway-big-ben-chimes-time-unifying-device',
  "In 'Mrs. Dalloway,' Woolf uses a specific recurring sound heard across London…",
);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DOMAIN_DRIFT_DROP_ENABLED;
});

describe('quality gate — OFF_DOMAIN plumbing', () => {
  it('sends each candidate fact_key to the gate and ships the containment rubric', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(llmResponse({ drop_indices: [], reasons: {} }));

    await findQualityFailures([DRIFTED, CONTAINED]);

    const [, , request] = mocks.loggedMessagesCreate.mock.calls[0];
    const userContent = request.messages[0].content as string;
    expect(userContent).toContain('fact=james-joyce-irish-modernism');
    expect(userContent).toContain('fact=mrs-dalloway-big-ben-chimes');

    const system = request.system as string;
    expect(system).toContain('OFF_DOMAIN');
    // The guard that keeps a correctly-filed work from being read as drift.
    expect(system).toContain('containment is NOT a defect');
  });

  it('renders a null fact_key without breaking the body', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(llmResponse({ drop_indices: [], reasons: {} }));
    await findQualityFailures([q('Beethoven', null, 'A question')]);
    const [, , request] = mocks.loggedMessagesCreate.mock.calls[0];
    expect(request.messages[0].content).toContain('fact=(none)');
  });

  it('reports OFF_DOMAIN separately and does NOT drop it by default', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(
      llmResponse({
        drop_indices: [0],
        reasons: { '0': 'OFF_DOMAIN: question is about Joyce, filed under Woolf' },
      }),
    );

    const result = await findQualityFailures([DRIFTED, CONTAINED]);

    expect([...result.offDomain]).toEqual([0]);
    expect(result.toDrop.size).toBe(0); // measure-only
  });

  it('keeps the gate’s other defects dropping exactly as before', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(
      llmResponse({
        drop_indices: [0, 1],
        reasons: {
          '0': 'OFF_DOMAIN: about Joyce, filed under Woolf',
          '1': 'ANSWER_LEAKED: the setup names the answer',
        },
      }),
    );

    const result = await findQualityFailures([DRIFTED, CONTAINED]);

    // The off-domain hit is withheld; the answer-leak hit still drops.
    expect([...result.offDomain]).toEqual([0]);
    expect([...result.toDrop]).toEqual([1]);
  });

  it('promotes OFF_DOMAIN to a drop once DOMAIN_DRIFT_DROP_ENABLED is set', async () => {
    // The flag is read where the drop sets are unioned, so the gate itself keeps
    // reporting the hit separately either way — that separation is what lets the
    // caller decide.
    const { isDomainDriftDropEnabled } = await import('@/server/daily/generate-questions');
    expect(isDomainDriftDropEnabled()).toBe(false);
    process.env.DOMAIN_DRIFT_DROP_ENABLED = 'true';
    try {
      expect(isDomainDriftDropEnabled()).toBe(true);
    } finally {
      delete process.env.DOMAIN_DRIFT_DROP_ENABLED;
    }
  });

  it('fails OPEN on a gate error — drops nothing, flags nothing', async () => {
    mocks.loggedMessagesCreate.mockRejectedValue(new Error('anthropic 529'));
    const result = await findQualityFailures([DRIFTED]);
    expect(result.toDrop.size).toBe(0);
    expect(result.offDomain.size).toBe(0);
  });
});
