import { describe, expect, it } from 'vitest';

import { filterUnverifiedInDomains } from '@/server/daily/verify-gate-thin';
import type { GeneratedQuestionRow } from '@/server/daily/generate-questions';

// Minimal rows — only the fields the pure filter reads.
function row(canonicalSubcategory: string, trustTier: string): GeneratedQuestionRow {
  return { canonicalSubcategory, trustTier } as unknown as GeneratedQuestionRow;
}

describe('filterUnverifiedInDomains — verify-gate for thin declared domains', () => {
  const thin = new Set(['Spy School Books 1-6']);

  it('drops UNVERIFIED rows in a thin declared domain (the fabrication case)', () => {
    const rows = [
      row('Spy School Books 1-6', 'unverified'),
      row('Spy School Books 1-6', 'machine_verified'),
    ];
    const { kept, dropped } = filterUnverifiedInDomains(rows, thin);
    expect(dropped).toBe(1);
    expect(kept.map((r) => r.trustTier)).toEqual(['machine_verified']);
  });

  it('keeps verified rows in a thin declared domain', () => {
    const rows = [
      row('Spy School Books 1-6', 'human_validated'),
      row('Spy School Books 1-6', 'author_confirmed'),
    ];
    expect(filterUnverifiedInDomains(rows, thin).dropped).toBe(0);
  });

  it('never touches rows in domains outside the thin-declared set', () => {
    const rows = [row('Star Wars', 'unverified'), row('Tennis', 'unverified')];
    const { kept, dropped } = filterUnverifiedInDomains(rows, thin);
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(2);
  });

  it('is a no-op when the thin-declared set is empty', () => {
    const rows = [row('Spy School Books 1-6', 'unverified')];
    expect(filterUnverifiedInDomains(rows, new Set()).dropped).toBe(0);
  });
});
