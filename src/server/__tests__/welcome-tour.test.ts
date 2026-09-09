import { describe, expect, it } from 'vitest';

import type { QueueSlot } from '@/server/daily/types';
import { isWelcomeTourEligible } from '@/server/welcome-tour';

function slot(slotIndex: number, resolved: boolean): QueueSlot {
  return {
    slot_index: slotIndex,
    source: 'generated',
    answered: resolved,
    skipped: false,
  } as QueueSlot;
}

describe('isWelcomeTourEligible', () => {
  it('waits until a Daily Five is complete', () => {
    expect(
      isWelcomeTourEligible({
        seenAt: null,
        queues: [{ slots: [slot(0, true), slot(1, false)] }],
      }),
    ).toBe(false);
  });

  it('shows after the first completed Daily Five', () => {
    expect(
      isWelcomeTourEligible({
        seenAt: null,
        queues: [{ slots: [slot(0, true), slot(1, true)] }],
      }),
    ).toBe(true);
  });

  it('never repeats once the account marker is set', () => {
    expect(
      isWelcomeTourEligible({
        seenAt: new Date(),
        queues: [{ slots: [slot(0, true)] }],
      }),
    ).toBe(false);
  });
});
