import { beforeEach, describe, expect, it, vi } from 'vitest';

// removeKnowledgeDomain (B-1) is the undo for the default-add that opens a
// domain on a correct answer in unfamiliar territory. These tests assert it
// deletes the PLAYER_MASTERY row + the domain's MASTERY_EVENTS, and prunes the
// domain from a custom Daily Five selection — without touching random-mode
// preferences.

const { getDailyPreferencesMock, updateDailyPreferencesMock, deletedRowsRef } = vi.hoisted(() => ({
  getDailyPreferencesMock: vi.fn(),
  updateDailyPreferencesMock: vi.fn(async () => undefined),
  deletedRowsRef: { rows: [] as Array<{ id: string }> },
}));

// Minimal drizzle delete chain. The PLAYER_MASTERY delete awaits
// `.where().returning()`; the MASTERY_EVENTS delete awaits `.where()` directly.
// A single chain serves both: `.where()` returns a resolved promise that also
// carries a `.returning()` yielding the seeded deleted rows.
const deleteChain = () => ({
  where: () => {
    const p = Promise.resolve(deletedRowsRef.rows) as Promise<Array<{ id: string }>> & {
      returning?: () => Promise<Array<{ id: string }>>;
    };
    p.returning = () => Promise.resolve(deletedRowsRef.rows);
    return p;
  },
});

// Spread the REAL schema (pure pgTable definitions — no DB pool) so the wide
// import graph behind knowledge.ts (e.g. getTableColumns(questions) in
// questions.ts) loads, while stubbing only the `db` client so no real
// connection is opened.
vi.mock('@/server/db', async () => {
  const schema = await vi.importActual<typeof import('@/server/db/schema')>('@/server/db/schema');
  return {
    ...schema,
    db: {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ delete: () => deleteChain() }),
    },
  };
});

vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: getDailyPreferencesMock,
  updateDailyPreferences: updateDailyPreferencesMock,
}));

import { removeKnowledgeDomain } from '../knowledge';

describe('removeKnowledgeDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletedRowsRef.rows = [{ id: 'pm-1' }];
    getDailyPreferencesMock.mockResolvedValue({
      userId: 'user-1',
      difficulty: 'mixed',
      domainMode: 'random',
      selectedDomains: [],
    });
  });

  it('reports removed when a PLAYER_MASTERY row was deleted', async () => {
    const result = await removeKnowledgeDomain('user-1', 'History');
    expect(result).toEqual({ removed: true });
  });

  it('reports not-removed when no PLAYER_MASTERY row matched', async () => {
    deletedRowsRef.rows = [];
    const result = await removeKnowledgeDomain('user-1', 'History');
    expect(result).toEqual({ removed: false });
  });

  it('prunes the domain from a custom Daily Five selection (case-insensitive)', async () => {
    getDailyPreferencesMock.mockResolvedValue({
      userId: 'user-1',
      difficulty: 'mixed',
      domainMode: 'custom',
      selectedDomains: ['History', 'Jazz'],
    });

    await removeKnowledgeDomain('user-1', 'history');

    expect(updateDailyPreferencesMock).toHaveBeenCalledWith('user-1', {
      selectedDomains: ['Jazz'],
    });
  });

  it('leaves random-mode preferences untouched', async () => {
    await removeKnowledgeDomain('user-1', 'History');
    expect(updateDailyPreferencesMock).not.toHaveBeenCalled();
  });

  it('rejects an empty domain', async () => {
    await expect(removeKnowledgeDomain('user-1', '   ')).rejects.toThrow(/domain is required/);
  });
});
