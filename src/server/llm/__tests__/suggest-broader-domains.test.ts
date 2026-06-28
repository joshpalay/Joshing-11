import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const createMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMessageMock };
  },
}));

function anthropicArrayResponse(items: unknown[]) {
  return {
    content: [{ type: 'text', text: JSON.stringify(items) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

async function importBroader() {
  return (await import('@/server/llm/interests')).suggestBroaderDomains;
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

describe('suggestBroaderDomains', () => {
  beforeEach(() => {
    createMessageMock.mockReset();
  });
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('returns curated parents for a deadly sin without calling the LLM', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const suggestBroaderDomains = await importBroader();

    const result = await suggestBroaderDomains('Pride', null);

    expect(result).toEqual([
      { label: 'The Seven Deadly Sins', broadCategory: 'Philosophy' },
      { label: 'Moral Philosophy', broadCategory: 'Philosophy' },
      { label: "Dante's Inferno", broadCategory: 'Literature' },
    ]);
    expect(createMessageMock).not.toHaveBeenCalled();
  });

  it('matches the curated map case-insensitively and covers the virtues', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const suggestBroaderDomains = await importBroader();

    const result = await suggestBroaderDomains('  humility ', null);

    expect(result.map((c) => c.label)).toEqual([
      'The Seven Heavenly Virtues',
      'Moral Philosophy',
      'Virtue Ethics',
    ]);
    expect(createMessageMock).not.toHaveBeenCalled();
  });

  it('falls open to [] for an unmapped domain when the client is unavailable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const suggestBroaderDomains = await importBroader();

    expect(await suggestBroaderDomains('Tears of the Kingdom', 'Pop Culture')).toEqual([]);
    expect(createMessageMock).not.toHaveBeenCalled();
  });

  it('uses the constrained LLM fallback for an unmapped domain: drops the own domain and bucket labels, de-dupes, caps to 3', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length';
    createMessageMock.mockResolvedValueOnce(
      anthropicArrayResponse([
        { label: 'The Norman Conquest', broadCategory: 'History' },
        { label: 'Medieval England', broadCategory: 'History' },
        { label: 'medieval england', broadCategory: 'History' }, // dupe
        { label: 'History', broadCategory: 'History' }, // bucket — dropped
        { label: 'The Battle of Hastings', broadCategory: 'History' }, // own domain — dropped
        { label: 'The Crusades', broadCategory: 'History' },
        { label: 'The Hundred Years War', broadCategory: 'History' }, // beyond cap
      ]),
    );
    const suggestBroaderDomains = await importBroader();

    const result = await suggestBroaderDomains('The Battle of Hastings', 'History');

    expect(createMessageMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { label: 'The Norman Conquest', broadCategory: 'History' },
      { label: 'Medieval England', broadCategory: 'History' },
      { label: 'The Crusades', broadCategory: 'History' },
    ]);
  });

  it('fails open to [] when the LLM call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-with-enough-length';
    createMessageMock.mockRejectedValueOnce(new Error('boom'));
    const suggestBroaderDomains = await importBroader();

    expect(await suggestBroaderDomains('Some Unmapped Niche', null)).toEqual([]);
  });
});
