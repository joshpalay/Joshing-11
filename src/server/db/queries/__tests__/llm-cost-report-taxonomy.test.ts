import { describe, expect, it, vi } from 'vitest';

// The taxonomy exports are pure, but the module imports the db layer at top level.
// Stub the heavy imports so we can test SURFACE_BUCKETS / bucketForScope in isolation.
vi.mock('@/server/db', () => ({
  db: {},
  generatedQuestions: {},
  llmCostReport: {},
  llmUsageEvent: {},
  masteryEvents: {},
  users: {},
}));
vi.mock('@/server/db/queries/crafter-demand', () => ({ getExpensiveDomains: vi.fn() }));
vi.mock('@/server/auth/admin', () => ({ adminUserIds: () => [] }));
vi.mock('@/server/llm/pricing', () => ({ estimateCostUsd: () => ({ usd: 0, unpriced: false }) }));

import {
  ALL_BUCKETS,
  OTHER_BUCKET,
  SURFACE_BUCKETS,
  bucketForScope,
} from '@/server/db/queries/llm-cost-report';

// Scopes observed in the live LlmUsageEvent ledger (30-day snapshot, 2026-07-06).
// Every one must resolve to a NAMED bucket — none may fall into "Other / unmapped",
// which is what let the whole verification pipeline + topic-sizing hide from the
// weekly digest. A new scope added to the codebase should be added to a bucket
// here (or this test flags that it's silently landing in Other).
const LIVE_SCOPES = [
  'batch-verify', 'ask-to-answer-cold', 'vet-question', 'generate-questions',
  'audit:gate', 'inside-joke', 'grade', 'factual-gate', 'node-weight-depth',
  'quality-gate', 'mastery-threshold-points', 'salvage-propose', 'history-dedupe',
  'ask-to-answer-judge', 'batch-dedupe', 'enrich-variants', 'pool-refill-generate',
  'questions-suggest-verify', 'questions-suggest', 'ceremony-narrative',
  'interests-answerability', 'crafter-draft', 'recheck', 'interests-categorize-domain',
  'knowledge-structure-proposal', 'critique', 'reconcile-subcategory', 'categorize',
  'difficulty', 'interests-suggest-broader', 'interests-suggest-adjacent',
  'interests-expand', 'interests-proofread', 'categorize-deleak',
  // Flag-gated / lower-volume scopes that must still be named when they fire:
  'domain-reference', 'nearness-tree',
];

describe('LLM cost-report surface taxonomy', () => {
  it('maps every live scope to a NAMED bucket (nothing hides in Other)', () => {
    const unmapped = LIVE_SCOPES.filter((s) => bucketForScope(s).key === OTHER_BUCKET.key);
    expect(unmapped).toEqual([]);
  });

  it('surfaces the new named buckets', () => {
    const keys = ALL_BUCKETS.map((b) => b.key);
    expect(keys).toContain('verify');
    expect(keys).toContain('sizing');
    expect(keys).toContain('grounding');
  });

  it('lands the depth-sized-completion spend under "sizing"', () => {
    expect(bucketForScope('node-weight-depth').key).toBe('sizing');
    expect(bucketForScope('mastery-threshold-points').key).toBe('sizing');
  });

  it('names the verification pipeline (previously the biggest Other contributor)', () => {
    expect(bucketForScope('batch-verify').key).toBe('verify');
    expect(bucketForScope('ask-to-answer-cold').key).toBe('verify');
  });

  it('assigns each scope to exactly one bucket (no double-counting)', () => {
    const seen = new Map<string, string>();
    for (const b of SURFACE_BUCKETS) {
      for (const scope of b.scopes) {
        expect(seen.has(scope), `scope "${scope}" is in both ${seen.get(scope)} and ${b.key}`).toBe(false);
        seen.set(scope, b.key);
      }
    }
  });

  it('keeps only genuinely player-facing surfaces flagged', () => {
    const facing = SURFACE_BUCKETS.filter((b) => b.playerFacing).map((b) => b.key).sort();
    expect(facing).toEqual(['grade', 'interests']);
  });
});
