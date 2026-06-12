import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the (hoisted) vi.mock factories below can reference these.
const { categorizeInterestDomainMock } = vi.hoisted(() => ({
  categorizeInterestDomainMock: vi.fn(),
}));

// Mutable fixture for the "currently active declared interests" the select
// returns — each test sets it to drive the cap / idempotency branches.
const state = vi.hoisted(() => ({
  activeRows: [] as Array<{ domain: string; broadCategory: string | null }>,
}));

// Keep the real isCatchAllBroadCategory logic; only stub the LLM call.
vi.mock('@/server/llm/interests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/llm/interests')>();
  return { ...actual, categorizeInterestDomain: categorizeInterestDomainMock };
});

const selectChain = () => {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => Promise.resolve(state.activeRows);
  return c;
};

const txChain = () => {
  const c: Record<string, unknown> = {};
  c.values = () => c;
  c.onConflictDoUpdate = () => Promise.resolve();
  c.onConflictDoNothing = () => Promise.resolve();
  return c;
};

vi.mock('@/server/db', () => ({
  db: {
    select: () => selectChain(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ insert: () => txChain() }),
  },
  declaredInterests: {
    userId: 'declaredInterests.userId',
    domain: 'declaredInterests.domain',
    broadCategory: 'declaredInterests.broadCategory',
    isActive: 'declaredInterests.isActive',
  },
  playerMastery: {
    userId: 'playerMastery.userId',
    canonicalSubcategory: 'playerMastery.canonicalSubcategory',
  },
  users: { id: 'users.id' },
  friendInvitations: {},
}));

import { TooBroadInterestError } from '@/lib/knowledge/interest-specificity';

import { addDeclaredInterest, DeclaredInterestLimitError, MAX_ACTIVE_DECLARED_INTERESTS } from '../users';

describe('addDeclaredInterest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.activeRows = [];
  });

  it('adds a new interest when under the cap', async () => {
    const result = await addDeclaredInterest('user-1', { label: 'Jazz', broadCategory: 'Music' });
    expect(result).toEqual({ created: true, domain: 'Jazz', broadCategory: 'Music' });
    expect(categorizeInterestDomainMock).not.toHaveBeenCalled();
  });

  it('re-categorizes an uncategorized new interest', async () => {
    categorizeInterestDomainMock.mockResolvedValue('Finance');
    const result = await addDeclaredInterest('user-1', { label: 'Mortgage backed securities' });
    expect(categorizeInterestDomainMock).toHaveBeenCalledWith('Mortgage backed securities');
    expect(result).toEqual({
      created: true,
      domain: 'Mortgage backed securities',
      broadCategory: 'Finance',
    });
  });

  it('is idempotent on an already-active label (case-insensitive)', async () => {
    state.activeRows = [{ domain: 'Jazz', broadCategory: 'Music' }];
    const result = await addDeclaredInterest('user-1', { label: 'jazz' });
    expect(result).toEqual({ created: false, domain: 'Jazz', broadCategory: 'Music' });
    expect(categorizeInterestDomainMock).not.toHaveBeenCalled();
  });

  it('rejects with DeclaredInterestLimitError when already at the cap', async () => {
    state.activeRows = Array.from({ length: MAX_ACTIVE_DECLARED_INTERESTS }, (_, i) => ({
      domain: `interest-${i}`,
      broadCategory: null,
    }));
    await expect(
      addDeclaredInterest('user-1', { label: 'one too many', broadCategory: 'Music' }),
    ).rejects.toBeInstanceOf(DeclaredInterestLimitError);
    expect(categorizeInterestDomainMock).not.toHaveBeenCalled();
  });

  it('rejects an empty label', async () => {
    await expect(addDeclaredInterest('user-1', { label: '   ' })).rejects.toThrow(/topic name/);
  });

  it('rejects a broad-category label so the field expands it instead', async () => {
    await expect(
      addDeclaredInterest('user-1', { label: 'Technology' }),
    ).rejects.toBeInstanceOf(TooBroadInterestError);
    expect(categorizeInterestDomainMock).not.toHaveBeenCalled();
  });
});
