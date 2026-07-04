import { describe, expect, it } from 'vitest';

import {
  MAX_NODE_WEIGHT,
  MIN_NODE_WEIGHT,
  computeNodeWeight,
  weightFromChildCount,
} from '@/server/knowledge/node-weight';

describe('weightFromChildCount', () => {
  it('grows fast at the low end and saturates at the ceiling', () => {
    expect(weightFromChildCount(0)).toBe(1); // no breadth → floor
    expect(weightFromChildCount(1)).toBe(2);
    expect(weightFromChildCount(3)).toBe(3);
    expect(weightFromChildCount(50)).toBe(7);
    expect(weightFromChildCount(500)).toBe(MAX_NODE_WEIGHT); // clamps at 10
    expect(weightFromChildCount(100_000)).toBe(MAX_NODE_WEIGHT);
  });

  it('never returns below the floor for junk input', () => {
    expect(weightFromChildCount(-5)).toBe(MIN_NODE_WEIGHT);
    expect(weightFromChildCount(NaN)).toBe(MIN_NODE_WEIGHT);
  });
});

describe('computeNodeWeight — source order & fail-open', () => {
  it('uses Wikidata child-count when it resolves (no LLM call)', async () => {
    let llmCalled = false;
    const result = await computeNodeWeight('Shakespearean Tragedy', {
      wikidataChildCount: async () => 50,
      llmDepthScore: async () => {
        llmCalled = true;
        return 5;
      },
    });
    expect(result).toEqual({ weight: 7, source: 'wikidata' });
    expect(llmCalled).toBe(false);
  });

  it('falls back to the LLM when Wikidata does not resolve', async () => {
    const result = await computeNodeWeight('Spy School Books 1-6', {
      wikidataChildCount: async () => null,
      llmDepthScore: async () => 4,
    });
    expect(result).toEqual({ weight: 4, source: 'llm' });
  });

  it('falls back to the LLM when Wikidata throws (fail-open)', async () => {
    const result = await computeNodeWeight('X', {
      wikidataChildCount: async () => {
        throw new Error('wikidata down');
      },
      llmDepthScore: async () => 8,
    });
    expect(result).toEqual({ weight: 8, source: 'llm' });
  });

  it('clamps an out-of-range LLM score', async () => {
    const hi = await computeNodeWeight('X', {
      wikidataChildCount: async () => null,
      llmDepthScore: async () => 99,
    });
    expect(hi.weight).toBe(MAX_NODE_WEIGHT);
  });

  it('returns unseeded (null) when neither source resolves', async () => {
    const result = await computeNodeWeight('X', {
      wikidataChildCount: async () => null,
      llmDepthScore: async () => null,
    });
    expect(result).toEqual({ weight: null, source: 'none' });
  });

  it('returns unseeded for a blank label without calling any source', async () => {
    let touched = false;
    const result = await computeNodeWeight('   ', {
      wikidataChildCount: async () => {
        touched = true;
        return 10;
      },
    });
    expect(result).toEqual({ weight: null, source: 'none' });
    expect(touched).toBe(false);
  });
});
