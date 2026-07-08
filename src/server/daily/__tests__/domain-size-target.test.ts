import { beforeEach, describe, expect, it, vi } from 'vitest';

// getTargetQuestionCountForDomains: target-count precedence (manual override >
// corpus estimate > depth²) plus the parent subtree-union pass
// (D-MASTERY-FINEST-NODE-01 §3 — a parent's finite set is the union of its
// substantive descendants' sets). The estimate cache, LLM depth scorer, and
// knowledge graph are all mocked; substantiveDescendants is re-implemented as
// the same simple transitive walk so edge fixtures behave like the real graph.
const { state, getDepthEstimates, upsertDepthEstimate, scoreDomainDepth, getClusterContext } =
  vi.hoisted(() => ({
    state: {
      rows: new Map<string, Record<string, unknown>>(),
      graph: {
        nodeKeys: [] as string[],
        edges: [] as { parentDomainKey: string; childDomainKey: string }[],
      },
    },
    getDepthEstimates: vi.fn(),
    upsertDepthEstimate: vi.fn(),
    scoreDomainDepth: vi.fn(),
    getClusterContext: vi.fn(),
  }));

vi.mock('@/server/db/queries/domain-depth-estimate', () => ({
  getDepthEstimates,
  upsertDepthEstimate,
}));
vi.mock('@/server/llm/domain-depth', () => ({ scoreDomainDepth }));
vi.mock('@/server/knowledge/graph', () => ({
  getClusterContext,
  substantiveDescendants: (
    nodeKey: string,
    edges: readonly { parentDomainKey: string; childDomainKey: string }[],
  ) => {
    const out = new Set<string>();
    const stack = [nodeKey];
    while (stack.length > 0) {
      const key = stack.pop()!;
      for (const edge of edges) {
        if (edge.parentDomainKey === key && !out.has(edge.childDomainKey)) {
          out.add(edge.childDomainKey);
          stack.push(edge.childDomainKey);
        }
      }
    }
    return out;
  },
}));

import { depthToTargetCount, getTargetQuestionCountForDomains } from '@/server/daily/domain-size';

function row(domainKey: string, overrides: Record<string, unknown> = {}) {
  return {
    domainKey,
    depthScore: null,
    source: 'corpus',
    sampleLabel: domainKey,
    estimatedQuestions: null,
    manualEstimatedQuestions: null,
    ...overrides,
  };
}

describe('getTargetQuestionCountForDomains — precedence + subtree union', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = new Map();
    state.graph = { nodeKeys: [], edges: [] };
    getDepthEstimates.mockImplementation(async (keys: string[]) => {
      const out = new Map<string, unknown>();
      for (const key of keys) if (state.rows.has(key)) out.set(key, state.rows.get(key));
      return out;
    });
    getClusterContext.mockImplementation(async () => ({
      nodeKeys: new Set(state.graph.nodeKeys),
      labelByKey: new Map(state.graph.nodeKeys.map((key) => [key, key])),
      edges: state.graph.edges,
    }));
    scoreDomainDepth.mockResolvedValue(4);
    upsertDepthEstimate.mockResolvedValue(undefined);
  });

  it('a manual admin override wins over the corpus estimate', async () => {
    state.rows.set(
      'shakespearean tragedy',
      row('shakespearean tragedy', { estimatedQuestions: 27, manualEstimatedQuestions: 90 }),
    );
    const out = await getTargetQuestionCountForDomains(['Shakespearean Tragedy']);
    expect(out.get('Shakespearean Tragedy')).toBe(90);
  });

  it('the corpus estimate still wins over depth² when no override is set', async () => {
    state.rows.set(
      'shakespearean tragedy',
      row('shakespearean tragedy', { estimatedQuestions: 27, depthScore: 8 }),
    );
    const out = await getTargetQuestionCountForDomains(['Shakespearean Tragedy']);
    expect(out.get('Shakespearean Tragedy')).toBe(27);
  });

  it("a parent's target grows to the union of its substantive descendants", async () => {
    state.graph = {
      nodeKeys: ['shakespearean tragedy', 'hamlet', 'king lear', 'macbeth'],
      edges: [
        { parentDomainKey: 'shakespearean tragedy', childDomainKey: 'hamlet' },
        { parentDomainKey: 'shakespearean tragedy', childDomainKey: 'king lear' },
        { parentDomainKey: 'shakespearean tragedy', childDomainKey: 'macbeth' },
      ],
    };
    state.rows.set('shakespearean tragedy', row('shakespearean tragedy', { estimatedQuestions: 27 }));
    state.rows.set('hamlet', row('hamlet', { estimatedQuestions: 30 }));
    // A child's own manual override participates in the union at its value.
    state.rows.set(
      'king lear',
      row('king lear', { estimatedQuestions: 25, manualEstimatedQuestions: 40 }),
    );
    // A child with only a depth score contributes its depth-derived count.
    state.rows.set('macbeth', row('macbeth', { depthScore: 3 }));

    const out = await getTargetQuestionCountForDomains(['Shakespearean Tragedy']);
    expect(out.get('Shakespearean Tragedy')).toBe(30 + 40 + depthToTargetCount(3));
  });

  it('a manual override on the parent wins over the union', async () => {
    state.graph = {
      nodeKeys: ['shakespearean tragedy', 'hamlet'],
      edges: [{ parentDomainKey: 'shakespearean tragedy', childDomainKey: 'hamlet' }],
    };
    state.rows.set(
      'shakespearean tragedy',
      row('shakespearean tragedy', { estimatedQuestions: 27, manualEstimatedQuestions: 35 }),
    );
    state.rows.set('hamlet', row('hamlet', { estimatedQuestions: 300 }));

    const out = await getTargetQuestionCountForDomains(['Shakespearean Tragedy']);
    expect(out.get('Shakespearean Tragedy')).toBe(35);
  });

  it('the union only ever raises — a small subtree never lowers the parent', async () => {
    state.graph = {
      nodeKeys: ['shakespearean tragedy', 'hamlet'],
      edges: [{ parentDomainKey: 'shakespearean tragedy', childDomainKey: 'hamlet' }],
    };
    state.rows.set('shakespearean tragedy', row('shakespearean tragedy', { estimatedQuestions: 27 }));
    state.rows.set('hamlet', row('hamlet', { estimatedQuestions: 20 }));

    const out = await getTargetQuestionCountForDomains(['Shakespearean Tragedy']);
    expect(out.get('Shakespearean Tragedy')).toBe(27);
  });

  it('a graph fault falls back to per-node sizing (never blocks)', async () => {
    getClusterContext.mockRejectedValue(new Error('graph down'));
    state.rows.set('shakespearean tragedy', row('shakespearean tragedy', { estimatedQuestions: 27 }));
    const out = await getTargetQuestionCountForDomains(['Shakespearean Tragedy']);
    expect(out.get('Shakespearean Tragedy')).toBe(27);
  });
});
