import { beforeAll, describe, expect, it } from 'vitest';

// prompt-proposer.ts → @/server/db + @/server/daily/generate-questions, which
// need a connection string at load. The pure helper never touches the DB.
let mod: typeof import('@/server/quality/prompt-proposer');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/quality/prompt-proposer');
});

describe('wrapProposalArtifact — proposal-only guarantee', () => {
  const meta = {
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-07-01T00:00:00Z'),
  };

  it('always prepends the DO-NOT-AUTO-APPLY header', () => {
    const md = mod.wrapProposalArtifact('### Some cluster\nbody', meta);
    expect(md.startsWith('# Prompt improvement proposals — DO NOT AUTO-APPLY')).toBe(true);
  });

  it('states it is human-review-only and lands as a reviewed commit', () => {
    const md = mod.wrapProposalArtifact('body', meta);
    expect(md).toMatch(/human review only/i);
    expect(md).toMatch(/reviewed commit/i);
    expect(md).toContain('2026-06-01–2026-07-01');
  });

  it('preserves the proposal body', () => {
    const md = mod.wrapProposalArtifact('### Literature › Spy School\nProposed change: …', meta);
    expect(md).toContain('Spy School');
  });
});
