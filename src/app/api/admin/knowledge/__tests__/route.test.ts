import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

const {
  getSessionMock,
  isAdminUserMock,
  createNodeMock,
  updateNodeMock,
  createEdgeMock,
  deleteEdgeMock,
  ratifyMock,
  rungsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'admin-1', id: 's-1' }) as { userId: string; id: string } | null),
  isAdminUserMock: vi.fn(() => true),
  createNodeMock: vi.fn(async () => ({ ok: true as const, node: { id: 'n1', label: 'Renaissance Italy' } })),
  updateNodeMock: vi.fn(async () => ({ ok: true as const, node: { id: 'n1', label: 'Renaissance Italy' } })),
  createEdgeMock: vi.fn(async () => ({ ok: true as const, edge: { id: 'e1' } })),
  deleteEdgeMock: vi.fn(async () => ({ ok: true as const })),
  ratifyMock: vi.fn(async () => ({ ok: true as const, edge: { id: 'e2' } })),
  rungsMock: vi.fn(async () => [
    { domain: 'Renaissance Italy', broadCategory: 'History', rung: 'parent' },
    { domain: 'European History', broadCategory: 'History', rung: 'grandparent' },
    { domain: 'Tudor England', broadCategory: 'History', rung: 'sibling' }, // filtered out
  ]),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
const { attachChildMock } = vi.hoisted(() => ({
  attachChildMock: vi.fn(async () => ({ ok: true as const, edge: { id: 'e3' } })),
}));
vi.mock('@/server/db/queries/knowledge-graph', () => ({
  createKnowledgeNode: createNodeMock,
  updateKnowledgeNode: updateNodeMock,
  createKnowledgeEdge: createEdgeMock,
  deleteKnowledgeEdge: deleteEdgeMock,
  ratifyProposedParent: ratifyMock,
  ratifyStructureGroup: ratifyGroupMock,
  attachChild: attachChildMock,
  invertKnowledgeEdge: invertEdgeMock,
  listQuestionsForDomain: listQuestionsMock,
}));
const { listQuestionsMock } = vi.hoisted(() => ({
  listQuestionsMock: vi.fn(async () => ({
    label: 'Shakespearean Drama',
    questions: [
      { text: 'Who wrote Hamlet?', answer: 'Shakespeare', source: 'canonical', suppressed: false },
    ],
  })),
}));
vi.mock('@/server/knowledge/nearness-tree', () => ({ getOrBuildDomainRungs: rungsMock }));
const { wikidataStructureMock } = vi.hoisted(() => ({
  wikidataStructureMock: vi.fn(async () => ({
    entity: { qid: 'Q170173', label: 'Medici', description: 'Italian banking family' },
    parents: [
      { qid: 'Q4692', label: 'Italian Renaissance', description: 'cultural period' },
      // Dedupe probe: the LLM proposes this same label below — Wikidata wins.
      { qid: 'Q7787', label: 'European History', description: null },
    ],
    children: [],
    siblings: [],
  })),
}));
vi.mock('@/server/knowledge/wikidata', () => ({ getWikidataStructure: wikidataStructureMock }));
const { proposeStructureMock, ratifyGroupMock } = vi.hoisted(() => ({
  proposeStructureMock: vi.fn(async () => ({
    ok: true as const,
    groups: [
      {
        parentLabel: 'Renaissance Italy',
        broadCategory: 'History',
        suggestedThreshold: 1200,
        children: [
          { label: 'Medici Family', machineDepth: 9, humanAuthored: 0 },
          { label: 'Florentine Art', machineDepth: 4, humanAuthored: 0 },
        ],
      },
    ],
    corpusSize: 12,
    alreadyStructured: 3,
  })),
  ratifyGroupMock: vi.fn(async () => ({ ok: true as const, parentKey: 'renaissance italy', edgesCreated: 2 })),
}));
vi.mock('@/server/knowledge/propose-structure', () => ({
  proposeKnowledgeStructure: proposeStructureMock,
}));
const { invertEdgeMock } = vi.hoisted(() => ({
  invertEdgeMock: vi.fn(async () => ({ ok: true as const })),
}));
const { mergeDomainMock } = vi.hoisted(() => ({
  mergeDomainMock: vi.fn(async () => ({
    ok: true as const,
    targetLabel: 'Shakespearean Drama',
    sourceLabels: ['Shakespeare'],
    retargeted: 3,
    consolidated: 2,
  })),
}));
vi.mock('@/server/knowledge/merge-domain', () => ({ mergeDomainIntoTarget: mergeDomainMock }));

import { POST } from '@/app/api/admin/knowledge/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/admin/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'admin-1', id: 's-1' });
  isAdminUserMock.mockReturnValue(true);
});

describe('POST /api/admin/knowledge', () => {
  it('returns 404 (not 403) for a non-admin and writes nothing', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ action: 'create_node', label: 'Tennis', nodeKind: 'leaf' });
    expect(res.status).toBe(404);
    expect(createNodeMock).not.toHaveBeenCalled();
  });

  it('creates a node with the human-set mastery threshold', async () => {
    const res = await post({
      action: 'create_node',
      label: 'Renaissance Italy',
      nodeKind: 'parent',
      masteryThreshold: 2000,
      fieldHue: 'history',
    });
    expect(res.status).toBe(201);
    expect(createNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Renaissance Italy', nodeKind: 'parent', masteryThreshold: 2000 }),
      'admin-1',
    );
  });

  it('a domainKey collision returns 409 WITH the existing node, never a second row', async () => {
    createNodeMock.mockResolvedValueOnce({
      ok: false,
      reason: 'domain_key_collision',
      existing: { id: 'n0', label: 'Renaissance Italy' },
    });
    const res = await post({ action: 'create_node', label: 'Renaissance – Italy', nodeKind: 'leaf' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { existing?: { label: string } };
    expect(body.existing?.label).toBe('Renaissance Italy'); // surfaced, offer edit
  });

  it('creates a typed edge', async () => {
    const res = await post({
      action: 'create_edge',
      childDomainKey: 'medici family',
      parentDomainKey: 'renaissance italy',
      edgeType: 'substantive',
    });
    expect(res.status).toBe(201);
    expect(createEdgeMock).toHaveBeenCalledWith(
      { childDomainKey: 'medici family', parentDomainKey: 'renaissance italy', edgeType: 'substantive' },
      'admin-1',
    );
  });

  it('maps self-edge to 400 and duplicate to 409', async () => {
    createEdgeMock.mockResolvedValueOnce({ ok: false, reason: 'self_edge' });
    expect((await post({ action: 'create_edge', childDomainKey: 'x', parentDomainKey: 'x', edgeType: 'substantive' })).status).toBe(400);
    createEdgeMock.mockResolvedValueOnce({ ok: false, reason: 'duplicate' });
    expect((await post({ action: 'create_edge', childDomainKey: 'a', parentDomainKey: 'b', edgeType: 'collection' })).status).toBe(409);
  });

  it('deletes exactly one edge pair', async () => {
    const res = await post({ action: 'delete_edge', childDomainKey: 'medici family', parentDomainKey: 'renaissance italy' });
    expect(res.status).toBe(200);
    expect(deleteEdgeMock).toHaveBeenCalledWith(
      { childDomainKey: 'medici family', parentDomainKey: 'renaissance italy' },
      'admin-1',
    );
  });

  it('rejects an invalid edge type', async () => {
    const res = await post({ action: 'create_edge', childDomainKey: 'a', parentDomainKey: 'b', edgeType: 'friendly' });
    expect(res.status).toBe(400);
    expect(createEdgeMock).not.toHaveBeenCalled();
  });

  // ─── ADMIN P3: the two-source proposal queue (Wikidata primary, LLM secondary) ───

  it('propose merges Wikidata first (with QID provenance), LLM after, deduped — and commits NOTHING', async () => {
    const res = await post({ action: 'propose', childLabel: 'Medici Family' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proposals: Array<{ label: string; rung: string; source: string; qid: string | null }>;
    };
    // Wikidata's two parents lead; the LLM's 'European History' folds onto
    // Wikidata's (dedupe), leaving its unique 'Renaissance Italy' last.
    expect(body.proposals.map((p) => [p.label, p.source, p.qid])).toEqual([
      ['Italian Renaissance', 'wikidata', 'Q4692'],
      ['European History', 'wikidata', 'Q7787'],
      ['Renaissance Italy', 'llm', null],
    ]);
    expect(body.proposals.some((p) => p.rung === 'sibling')).toBe(false);
    expect(createNodeMock).not.toHaveBeenCalled();
    expect(createEdgeMock).not.toHaveBeenCalled();
    expect(ratifyMock).not.toHaveBeenCalled(); // proposals never auto-commit (§4)
  });

  it('propose still serves the LLM source when Wikidata is unavailable', async () => {
    wikidataStructureMock.mockResolvedValueOnce(null as never); // label unresolved / egress blocked
    const res = await post({ action: 'propose', childLabel: 'Spy School Books 1-6' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposals: Array<{ label: string; source: string }> };
    expect(body.proposals.map((p) => p.source)).toEqual(['llm', 'llm']);
  });

  it('propose degrades to an empty queue when BOTH sources fail — never an error', async () => {
    wikidataStructureMock.mockRejectedValueOnce(new Error('egress blocked'));
    rungsMock.mockRejectedValueOnce(new Error('no cache'));
    const res = await post({ action: 'propose', childLabel: 'Medici Family' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { proposals: unknown[] }).proposals).toEqual([]);
  });

  it('propose never proposes the child as its own parent', async () => {
    wikidataStructureMock.mockResolvedValueOnce({
      entity: { qid: 'Q1', label: 'Tennis', description: null },
      parents: [{ qid: 'Q2', label: 'Tennis', description: null }], // self by domainKey fold
      children: [],
      siblings: [],
    } as never);
    rungsMock.mockResolvedValueOnce([]);
    const res = await post({ action: 'propose', childLabel: 'Tennis' });
    expect(((await res.json()) as { proposals: unknown[] }).proposals).toEqual([]);
  });

  // ─── the tree editor ───

  it('attach_child MOVE passes the from-parent for removal', async () => {
    const res = await post({
      action: 'attach_child',
      childDomainKey: 'beethoven piano sonatas',
      toParentDomainKey: 'beethoven',
      moveFromParentDomainKey: 'classical music',
    });
    expect(res.status).toBe(201);
    expect(attachChildMock).toHaveBeenCalledWith(
      {
        childDomainKey: 'beethoven piano sonatas',
        toParentDomainKey: 'beethoven',
        moveFromParentDomainKey: 'classical music',
      },
      'admin-1',
    );
  });

  it('attach_child COPY omits the from-parent — the node lives under both', async () => {
    await post({
      action: 'attach_child',
      childDomainKey: 'hamlet',
      toParentDomainKey: 'branagh films',
    });
    expect(attachChildMock).toHaveBeenCalledWith(
      { childDomainKey: 'hamlet', toParentDomainKey: 'branagh films', moveFromParentDomainKey: null },
      'admin-1',
    );
  });

  it('a cycle/self placement maps to 400', async () => {
    attachChildMock.mockResolvedValueOnce({ ok: false, reason: 'self_edge' });
    const res = await post({
      action: 'attach_child',
      childDomainKey: 'classical music',
      toParentDomainKey: 'beethoven',
    });
    expect(res.status).toBe(400);
  });

  // ─── flip + peek ───

  it('invert_edge flips a child above its own parent', async () => {
    const res = await post({
      action: 'invert_edge',
      childDomainKey: 'shakespeare',
      parentDomainKey: 'shakespearean drama',
    });
    expect(res.status).toBe(200);
    expect(invertEdgeMock).toHaveBeenCalledWith(
      { childDomainKey: 'shakespeare', parentDomainKey: 'shakespearean drama' },
      'admin-1',
    );
  });

  it('list_questions returns the peek read-only', async () => {
    const res = await post({ action: 'list_questions', domainKey: 'shakespearean drama' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: Array<{ text: string }> };
    expect(body.questions[0].text).toContain('Hamlet');
    expect(createNodeMock).not.toHaveBeenCalled();
    expect(createEdgeMock).not.toHaveBeenCalled();
  });

  // ─── merge (fold a duplicate territory into its twin) ───

  it('merge_node folds source into target as the admin', async () => {
    const res = await post({
      action: 'merge_node',
      sourceDomainKey: 'shakespeare',
      targetDomainKey: 'shakespearean drama',
    });
    expect(res.status).toBe(200);
    expect(mergeDomainMock).toHaveBeenCalledWith(
      { sourceDomainKey: 'shakespeare', targetDomainKey: 'shakespearean drama' },
      'admin-1',
    );
  });

  it('merge_node maps census-abort to 409 with the unhandled tables', async () => {
    mergeDomainMock.mockResolvedValueOnce({
      ok: false,
      reason: 'unhandled_tables',
      detail: ['SomeNewTable.domain (4 rows)'],
    } as never);
    const res = await post({ action: 'merge_node', sourceDomainKey: 'a', targetDomainKey: 'b' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { detail: string[] };
    expect(body.detail[0]).toContain('SomeNewTable');
  });

  it('merge_node self-merge maps to 400', async () => {
    mergeDomainMock.mockResolvedValueOnce({ ok: false, reason: 'self_merge' } as never);
    const res = await post({ action: 'merge_node', sourceDomainKey: 'a', targetDomainKey: 'a' });
    expect(res.status).toBe(400);
  });

  // ─── the structure suggester ───

  it('propose_structure returns draft groups and commits NOTHING', async () => {
    const res = await post({ action: 'propose_structure' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: Array<{ parentLabel: string }> };
    expect(body.groups[0].parentLabel).toBe('Renaissance Italy');
    expect(createNodeMock).not.toHaveBeenCalled();
    expect(createEdgeMock).not.toHaveBeenCalled();
    expect(ratifyGroupMock).not.toHaveBeenCalled(); // suggestions never auto-commit (§4)
  });

  it('ratify_structure_group is the human commit, with the tuned threshold', async () => {
    const res = await post({
      action: 'ratify_structure_group',
      parentLabel: 'Renaissance Italy',
      broadCategory: 'History',
      masteryThreshold: 1500, // human tuned it up from the suggested 1200
      childLabels: ['Medici Family', 'Florentine Art'],
    });
    expect(res.status).toBe(201);
    expect(ratifyGroupMock).toHaveBeenCalledWith(
      {
        parentLabel: 'Renaissance Italy',
        broadCategory: 'History',
        masteryThreshold: 1500,
        childLabels: ['Medici Family', 'Florentine Art'],
      },
      'admin-1',
    );
  });

  it('non-admins get 404 from the suggester too', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ action: 'propose_structure' });
    expect(res.status).toBe(404);
    expect(proposeStructureMock).not.toHaveBeenCalled();
  });

  it('ratify creates exactly one edge with the HUMAN-chosen edge type', async () => {
    const res = await post({
      action: 'ratify',
      childDomainKey: 'medici family',
      parentLabel: 'Renaissance Italy',
      parentBroadCategory: 'History',
      edgeType: 'collection',
    });
    expect(res.status).toBe(201);
    expect(ratifyMock).toHaveBeenCalledTimes(1);
    expect(ratifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ edgeType: 'collection', parentLabel: 'Renaissance Italy' }),
      'admin-1',
    );
  });

  it('ratify of a Wikidata proposal carries the QID for provenance', async () => {
    const res = await post({
      action: 'ratify',
      childDomainKey: 'medici family',
      parentLabel: 'Italian Renaissance',
      edgeType: 'substantive',
      wikidataQid: 'Q4692',
    });
    expect(res.status).toBe(201);
    expect(ratifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ wikidataQid: 'Q4692', edgeType: 'substantive' }),
      'admin-1',
    );
  });

  it('ratify rejects a malformed QID', async () => {
    const res = await post({
      action: 'ratify',
      childDomainKey: 'medici family',
      parentLabel: 'Italian Renaissance',
      edgeType: 'substantive',
      wikidataQid: 'not-a-qid',
    });
    expect(res.status).toBe(400);
    expect(ratifyMock).not.toHaveBeenCalled();
  });
});
