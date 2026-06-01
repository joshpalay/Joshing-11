import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  computeBeatsMock,
  runDomainMergesForUserMock,
  sendSmsMock,
  writeActivityMock,
  insertReturningMock,
  userLookupMock,
  existingCeremonyLookupMock,
  selectChain,
  dbMock,
} = vi.hoisted(() => {
  const insertReturningMock = vi.fn(async () => [{ id: 'cer-1' }]);
  const selectChain: Array<() => Promise<unknown[]>> = [];
  const dbMock = {
    select: vi.fn(() => {
      const handler = selectChain.shift() ?? (async () => []);
      return {
        from: () => ({
          where: () => ({
            limit: handler,
          }),
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: () => insertReturningMock(),
      })),
    })),
  };
  return {
    computeBeatsMock: vi.fn(async () => ({
      cycleStart: '2026-05-01',
      cycleEnd: '2026-05-15',
      beat1: null,
      beat2: null,
      beat3: null,
      beat4: null,
      beat5: null,
    })),
    runDomainMergesForUserMock: vi.fn(async () => ({ mergesApplied: 0, details: [] })),
    sendSmsMock: vi.fn(async () => undefined),
    writeActivityMock: vi.fn(async () => undefined),
    insertReturningMock,
    userLookupMock: vi.fn(async () => [{ phoneNumber: '+15551234567', smsOptIn: 'opted_in' }]),
    existingCeremonyLookupMock: vi.fn(async () => []),
    selectChain,
    dbMock,
  };
});

// The route's distinct select() shapes:
//   1) findExistingCeremony: select({id}).from(biweeklyCeremonies).where(and(...)).limit(1)
//   2) hasMasteryEventInCycle: select({id}).from(masteryEvents).where(and(...)).limit(1)
//   3) user lookup: select({phoneNumber, smsOptIn}).from(users).where(eq(...)).limit(1)
// Dispatch sequentially via a queue.

vi.mock('@/server/activity/write-activity', () => ({
  writeActivity: writeActivityMock,
}));

vi.mock('@/server/ceremony/compute-beats', () => ({
  computeBeats: computeBeatsMock,
  beatsPayloadSchema: { parse: (value: unknown) => value },
}));

vi.mock('@/server/db', () => ({
  db: dbMock,
  biweeklyCeremonies: { id: 'b.id', userId: 'b.uid', cycleStart: 'b.cs', cycleEnd: 'b.ce' },
  masteryEvents: { id: 'm.id', userId: 'm.uid', createdAt: 'm.created' },
  users: { id: 'u.id', phoneNumber: 'u.phone', smsOptIn: 'u.opt' },
}));

vi.mock('@/server/mastery/ceremony', () => ({
  runDomainMergesForUser: runDomainMergesForUserMock,
}));

vi.mock('@/server/sms', () => ({
  sendSms: sendSmsMock,
}));

import { fireCeremony } from '@/server/ceremony/fire-ceremony';

function pushExistingLookup(rows: unknown[]) {
  selectChain.push(async () => rows);
}

function pushMasteryLookup(rows: unknown[]) {
  selectChain.push(async () => rows);
}

function pushUserLookup() {
  selectChain.push(async () => [{ phoneNumber: '+15551234567', smsOptIn: 'opted_in' }]);
}

describe('fireCeremony (F3.3 idempotency)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.length = 0;
    insertReturningMock.mockResolvedValue([{ id: 'cer-1' }]);
    void userLookupMock;
    void existingCeremonyLookupMock;
  });

  it('returns the existing ceremony id when one already exists for the cycle (no work redone)', async () => {
    pushExistingLookup([{ id: 'existing-cer' }]);

    const result = await fireCeremony('user-1');

    expect(result).toBe('existing-cer');
    expect(runDomainMergesForUserMock).not.toHaveBeenCalled();
    expect(computeBeatsMock).not.toHaveBeenCalled();
    expect(writeActivityMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('on first fire: computes beats, inserts row, writes activity, sends SMS', async () => {
    pushExistingLookup([]); // no prior
    pushMasteryLookup([{ id: 'me-1' }]); // has activity in cycle
    pushUserLookup();

    const result = await fireCeremony('user-1');

    expect(result).toBe('cer-1');
    expect(runDomainMergesForUserMock).toHaveBeenCalledWith('user-1');
    expect(computeBeatsMock).toHaveBeenCalled();
    expect(writeActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ceremony_ready',
        referenceId: 'cer-1',
      }),
    );
    expect(sendSmsMock).toHaveBeenCalled();
  });

  it('on concurrent unique-violation: returns the racing winner id, skips activity + SMS', async () => {
    pushExistingLookup([]); // pre-check: nothing yet
    pushMasteryLookup([{ id: 'me-1' }]); // has activity in cycle
    insertReturningMock.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint'),
    );
    // post-failure lookup: another transaction wrote 'racing-winner'
    pushExistingLookup([{ id: 'racing-winner' }]);

    const result = await fireCeremony('user-1');

    expect(result).toBe('racing-winner');
    expect(writeActivityMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('skips SMS when user has opted out', async () => {
    pushExistingLookup([]);
    pushMasteryLookup([{ id: 'me-1' }]);
    selectChain.push(async () => [{ phoneNumber: '+15551234567', smsOptIn: 'opted_out' }]);

    await fireCeremony('user-1');

    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('rethrows non-duplicate insert failures', async () => {
    pushExistingLookup([]);
    pushMasteryLookup([{ id: 'me-1' }]);
    insertReturningMock.mockRejectedValueOnce(new Error('unrelated db failure'));
    pushExistingLookup([]); // post-failure lookup still finds nothing

    await expect(fireCeremony('user-1')).rejects.toThrow('unrelated db failure');
  });
});

describe('fireCeremony (§8.1.31 eligibility — zero-activity silence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.length = 0;
    insertReturningMock.mockResolvedValue([{ id: 'cer-1' }]);
  });

  it('returns null and does no work when the user has zero mastery events in the cycle', async () => {
    pushExistingLookup([]); // no prior ceremony
    pushMasteryLookup([]); // zero activity in cycle window

    const result = await fireCeremony('user-1');

    expect(result).toBeNull();
    expect(runDomainMergesForUserMock).not.toHaveBeenCalled();
    expect(computeBeatsMock).not.toHaveBeenCalled();
    expect(writeActivityMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
