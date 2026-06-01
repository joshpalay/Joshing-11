import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the (hoisted) vi.mock factory below can reference the mock.
const { categorizeInterestDomainMock } = vi.hoisted(() => ({
  categorizeInterestDomainMock: vi.fn(),
}));

// Keep the real isCatchAllBroadCategory logic; only stub the LLM call so the
// backstop can be exercised offline.
vi.mock('@/server/llm/interests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/llm/interests')>();
  return { ...actual, categorizeInterestDomain: categorizeInterestDomainMock };
});

// Minimal drizzle chain: every builder method returns the chain, and the
// awaited terminals resolve. saveDeclaredInterests only awaits the writes for
// their side effects, so the values are irrelevant — we assert on its return.
const txChain = () => {
  const c: Record<string, unknown> = {};
  c.set = () => c;
  c.where = () => Promise.resolve();
  c.values = () => c;
  c.onConflictDoUpdate = () => Promise.resolve();
  c.onConflictDoNothing = () => Promise.resolve();
  return c;
};

vi.mock('@/server/db', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ update: () => txChain(), insert: () => txChain() }),
  },
  declaredInterests: { userId: 'declaredInterests.userId', domain: 'declaredInterests.domain' },
  playerMastery: {
    userId: 'playerMastery.userId',
    canonicalSubcategory: 'playerMastery.canonicalSubcategory',
  },
  users: { id: 'users.id' },
  friendInvitations: {},
}));

import { saveDeclaredInterests } from '../users';

describe('saveDeclaredInterests categorization backstop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects more than 5 interests before any categorization', async () => {
    await expect(
      saveDeclaredInterests(
        'user-1',
        Array.from({ length: 6 }, (_, i) => ({ label: `interest-${i}` })),
      ),
    ).rejects.toThrow(/at most 5/);
    expect(categorizeInterestDomainMock).not.toHaveBeenCalled();
  });

  it('leaves a real broad category untouched without calling the categorizer', async () => {
    const result = await saveDeclaredInterests('user-1', [
      { label: 'Jazz', broadCategory: 'Music' },
    ]);
    expect(categorizeInterestDomainMock).not.toHaveBeenCalled();
    expect(result).toEqual([{ label: 'Jazz', broadCategory: 'Music', description: null }]);
  });

  it('re-categorizes a "General Knowledge" catch-all instead of persisting it', async () => {
    categorizeInterestDomainMock.mockResolvedValue('Music');
    const result = await saveDeclaredInterests('user-1', [
      { label: 'Romantic Era Classical symphony music', broadCategory: 'General Knowledge' },
    ]);
    expect(categorizeInterestDomainMock).toHaveBeenCalledWith(
      'Romantic Era Classical symphony music',
    );
    expect(result).toEqual([
      { label: 'Romantic Era Classical symphony music', broadCategory: 'Music', description: null },
    ]);
  });

  it('re-categorizes a missing broad category', async () => {
    categorizeInterestDomainMock.mockResolvedValue('Finance');
    const result = await saveDeclaredInterests('user-1', [{ label: 'Mortgage backed securities' }]);
    expect(categorizeInterestDomainMock).toHaveBeenCalledWith('Mortgage backed securities');
    expect(result).toEqual([
      { label: 'Mortgage backed securities', broadCategory: 'Finance', description: null },
    ]);
  });

  it('treats "Other" as a catch-all and re-categorizes it', async () => {
    categorizeInterestDomainMock.mockResolvedValue('Film & Television');
    const result = await saveDeclaredInterests('user-1', [
      { label: "90's ballywood", broadCategory: 'Other' },
    ]);
    expect(categorizeInterestDomainMock).toHaveBeenCalledWith("90's ballywood");
    expect(result).toEqual([
      { label: "90's ballywood", broadCategory: 'Film & Television', description: null },
    ]);
  });

  it('persists null — not the catch-all — when categorization is unavailable', async () => {
    categorizeInterestDomainMock.mockResolvedValue(null);
    const result = await saveDeclaredInterests('user-1', [
      { label: 'Mystery Topic', broadCategory: 'General Knowledge' },
    ]);
    expect(result).toEqual([{ label: 'Mystery Topic', broadCategory: null, description: null }]);
  });
});
