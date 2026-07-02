import { beforeEach, describe, expect, it, vi } from 'vitest';

const getKnowledgeBase = vi.fn();
const getAnthropicClient = vi.fn();
const loggedMessagesCreate = vi.fn();

vi.mock('@/server/db/queries/daily', () => ({
  getKnowledgeBase: (...args: unknown[]) => getKnowledgeBase(...args),
}));

vi.mock('@/lib/llm', () => ({
  getAnthropicClient: (...args: unknown[]) => getAnthropicClient(...args),
  loggedMessagesCreate: (...args: unknown[]) => loggedMessagesCreate(...args),
  extractTextContent: (content: unknown) => String(content),
  parseJsonObject: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
}));

import { reconcileProposedDomain } from '@/lib/questions/categorization';

describe('reconcileProposedDomain — deterministic domainKey short-circuit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Client absent: any test reaching the LLM path returns the proposal
    // unchanged, so a fold in these tests proves the key short-circuit fired.
    getAnthropicClient.mockReturnValue(null);
  });

  it('folds a connector-variant onto the existing KB spelling without the LLM', async () => {
    getKnowledgeBase.mockResolvedValue([{ domain: 'Star Trek: The Next Generation' }]);

    const result = await reconcileProposedDomain('Star Trek – The Next Generation', 'user-1');

    expect(result.canonicalDomain).toBe('Star Trek: The Next Generation');
    expect(loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it('folds an ampersand-variant onto an additionalDomains corpus label', async () => {
    getKnowledgeBase.mockResolvedValue([{ domain: 'Hamlet' }]);

    const result = await reconcileProposedDomain('Renaissance & Medieval Polyphony', 'user-1', {
      additionalDomains: ['Renaissance and Medieval Polyphony'],
    });

    expect(result.canonicalDomain).toBe('Renaissance and Medieval Polyphony');
    expect(loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it("prefers the player's own spelling when both KB and corpus match the key", async () => {
    getKnowledgeBase.mockResolvedValue([{ domain: "90's Hip Hop" }]);

    const result = await reconcileProposedDomain('90’s Hip Hop', 'user-1', {
      additionalDomains: ['90’S HIP HOP'],
    });

    // Both the player's straight-apostrophe spelling and the corpus's shouty
    // curly-apostrophe one fold to the same key; the KB label is listed first.
    expect(result.canonicalDomain).toBe("90's Hip Hop");
  });

  it('keeps genuinely different domains apart (no false key fold)', async () => {
    getKnowledgeBase.mockResolvedValue([{ domain: 'Alien: Covenant' }]);

    const result = await reconcileProposedDomain('Alien', 'user-1');

    expect(result.canonicalDomain).toBe('Alien');
    expect(result.reconciled).toBe(false);
  });
});
