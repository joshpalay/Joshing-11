import { describe, expect, it } from 'vitest';

import { analyzeCategoryIntegrity } from '../category-integrity';

describe('category integrity diagnostic', () => {
  it('reports exact-key splits without treating related but distinct topics as duplicates', () => {
    const report = analyzeCategoryIntegrity({
      labels: [
        { label: 'Rock & Roll', rows: 2 },
        { label: 'Rock and Roll', rows: 3 },
        { label: 'Rock Music', rows: 4 },
        { label: 'Other', rows: 1 },
        { label: 'other', rows: 1 },
      ],
      bankLabels: [], nodes: [], edges: [],
    });
    expect(report.splitKeys).toEqual([{
      key: 'rock and roll',
      labels: [{ label: 'Rock & Roll', rows: 2 }, { label: 'Rock and Roll', rows: 3 }],
    }]);
  });

  it('flags malformed graph links, cycles, and Tidy merges of authored nodes', () => {
    const report = analyzeCategoryIntegrity({
      labels: [],
      bankLabels: [{ label: 'Rock & Roll', key: 'wrong-key', rows: 1 }],
      nodes: [
        { label: 'Hamlet', domainKey: 'hamlet' },
        { label: 'Shakespearean Tragedy', domainKey: 'shakespearean tragedy' },
        { label: 'Miskeyed', domainKey: 'not-miskeyed' },
      ],
      edges: [
        { childDomainKey: 'hamlet', parentDomainKey: 'shakespearean tragedy' },
        { childDomainKey: 'shakespearean tragedy', parentDomainKey: 'hamlet' },
        { childDomainKey: 'missing', parentDomainKey: 'hamlet' },
      ],
      recentMerges: [{ sources: ['Shakespearean Tragedy'], target: 'Hamlet' }],
    });
    expect(report.hasCycle).toBe(true);
    expect(report.orphanEdges).toHaveLength(1);
    expect(report.nodeKeyMismatches).toHaveLength(1);
    expect(report.bankKeyMismatches).toHaveLength(1);
    expect(report.graphSourceMerges).toEqual([{ source: 'Shakespearean Tragedy', target: 'Hamlet' }]);
  });

  it('allows a same-topic spelling consolidation of an authored node', () => {
    const report = analyzeCategoryIntegrity({
      labels: [], bankLabels: [],
      nodes: [{ label: 'Rock and Roll', domainKey: 'rock and roll' }],
      edges: [],
      recentMerges: [{ sources: ['Rock & Roll'], target: 'Rock and Roll' }],
    });
    expect(report.graphSourceMerges).toEqual([]);
  });
});
