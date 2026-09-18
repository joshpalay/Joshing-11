import { describe, expect, it } from 'vitest';

import { sortPendingDisputesByPriority } from '@/server/db/queries/grade-disputes';

describe('sortPendingDisputesByPriority', () => {
  it('puts canonical_disputed rows first regardless of recency', () => {
    const older = { reviewDecision: 'canonical_disputed', createdAt: new Date('2026-01-01') };
    const newer = { reviewDecision: 'needs_human', createdAt: new Date('2026-06-01') };

    expect(sortPendingDisputesByPriority([newer, older])).toEqual([older, newer]);
  });

  it('falls back to newest-first within the same priority tier', () => {
    const older = { reviewDecision: 'reject', createdAt: new Date('2026-01-01') };
    const newer = { reviewDecision: 'needs_human', createdAt: new Date('2026-06-01') };

    expect(sortPendingDisputesByPriority([older, newer])).toEqual([newer, older]);
  });
});
