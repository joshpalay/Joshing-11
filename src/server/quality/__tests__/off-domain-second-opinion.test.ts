import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { confirmOffDomain } from '@/server/quality/off-domain-second-opinion';

function llmResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] };
}

const CANDIDATE = {
  canonicalSubcategory: "Virginia Woolf's Novels and Essays",
  questionText: "In Joyce's Ulysses, ...",
  answer: 'Rhetoric',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('confirmOffDomain', () => {
  it('returns nothing for an empty candidate list without calling the model', async () => {
    const result = await confirmOffDomain([]);
    expect(result.size).toBe(0);
    expect(mocks.loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it('sends the raw question/answer/domain, NOT a fact_key, so the second opinion is genuinely independent', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(llmResponse({ verdicts: { '0': 'OFF_DOMAIN' } }));
    await confirmOffDomain([CANDIDATE]);
    const [, tag, request] = mocks.loggedMessagesCreate.mock.calls[0];
    expect(tag).toBe('off-domain-second-opinion');
    const userContent = request.messages[0].content as string;
    expect(userContent).toContain(CANDIDATE.canonicalSubcategory);
    expect(userContent).toContain(CANDIDATE.questionText);
    expect(userContent).toContain(CANDIDATE.answer);
    expect(userContent).not.toContain('fact_key');
  });

  it('confirms only the indices the model marks OFF_DOMAIN', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(
      llmResponse({ verdicts: { '0': 'OFF_DOMAIN', '1': 'FILED_CORRECTLY' } }),
    );
    const result = await confirmOffDomain([
      CANDIDATE,
      { canonicalSubcategory: 'Mozart', questionText: '...', answer: 'Basset clarinet' },
    ]);
    expect([...result]).toEqual([0]);
  });

  it('fails CLOSED (confirms nothing) on a request error — an outage must never confirm a drop', async () => {
    mocks.loggedMessagesCreate.mockRejectedValue(new Error('anthropic 529'));
    const result = await confirmOffDomain([CANDIDATE]);
    expect(result.size).toBe(0);
  });

  it('fails CLOSED on an unparseable response', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] });
    const result = await confirmOffDomain([CANDIDATE]);
    expect(result.size).toBe(0);
  });

  it('ignores an out-of-range or malformed index rather than throwing', async () => {
    mocks.loggedMessagesCreate.mockResolvedValue(
      llmResponse({ verdicts: { '5': 'OFF_DOMAIN', 'x': 'OFF_DOMAIN' } }),
    );
    const result = await confirmOffDomain([CANDIDATE]);
    expect(result.size).toBe(0);
  });
});
