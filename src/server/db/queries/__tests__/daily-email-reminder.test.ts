import { describe, it, expect, vi, beforeEach } from 'vitest';

// What the claim's `UPDATE ... RETURNING` resolves to. One row = this call won
// the claim (the marker was null); empty = another run already claimed it.
let returningRows: Array<{ id: string }> = [];
const updates: Array<{ set: Record<string, unknown>; usedReturning: boolean }> = [];

vi.mock('@/server/db', () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          const capture = { set: vals, usedReturning: false };
          updates.push(capture);
          // Drizzle's query builder is thenable (release awaits it directly)
          // AND exposes `.returning()` (claim chains it). Model both.
          const thenable = Promise.resolve(returningRows) as Promise<unknown> & {
            returning?: () => Promise<unknown>;
          };
          thenable.returning = () => {
            capture.usedReturning = true;
            return Promise.resolve(returningRows);
          };
          return thenable;
        },
      }),
    }),
  },
  dailyQueues: { id: 'id', emailReminderSentAt: 'email_reminder_sent_at' },
  // The remaining named exports daily.ts pulls in at import time — unused here.
  generatedQuestions: {},
  dailyPreferences: {},
  declaredInterests: {},
  feedItems: {},
  masteryEvents: {},
  playerMastery: {},
  questions: {},
  userDomainExclusions: {},
  users: {},
}));

import {
  claimDailyEmailReminder,
  releaseDailyEmailReminder,
} from '@/server/db/queries/daily';

beforeEach(() => {
  returningRows = [];
  updates.length = 0;
});

describe('claimDailyEmailReminder', () => {
  it('returns true and stamps the marker when the row was unclaimed', async () => {
    returningRows = [{ id: 'q1' }];

    const won = await claimDailyEmailReminder('q1');

    expect(won).toBe(true);
    // Claim must use the conditional RETURNING update, not a blind write.
    expect(updates.at(-1)?.usedReturning).toBe(true);
    expect(updates.at(-1)?.set).toMatchObject({ emailReminderSentAt: expect.any(Date) });
  });

  it('returns false when another run already claimed it (no row returned)', async () => {
    returningRows = [];

    const won = await claimDailyEmailReminder('q1');

    expect(won).toBe(false);
  });
});

describe('releaseDailyEmailReminder', () => {
  it('resets the marker to null so a later run can retry', async () => {
    await releaseDailyEmailReminder('q1');

    expect(updates.at(-1)?.set).toEqual({ emailReminderSentAt: null });
  });
});
