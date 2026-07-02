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
vi.mock('@/server/db/queries/knowledge-graph', () => ({
  createKnowledgeNode: createNodeMock,
  updateKnowledgeNode: updateNodeMock,
  createKnowledgeEdge: createEdgeMock,
  deleteKnowledgeEdge: deleteEdgeMock,
  ratifyProposedParent: ratifyMock,
}));
vi.mock('@/server/knowledge/nearness-tree', () => ({ getOrBuildDomainRungs: rungsMock }));

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

  // ─── ADMIN P3: the LLM proposal queue ───

  it('propose returns parent/grandparent rungs only, and commits NOTHING', async () => {
    const res = await post({ action: 'propose', childLabel: 'Medici Family' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposals: Array<{ label: string; rung: string }> };
    expect(body.proposals.map((p) => p.label)).toEqual(['Renaissance Italy', 'European History']);
    expect(body.proposals.some((p) => p.rung === 'sibling')).toBe(false);
    expect(createNodeMock).not.toHaveBeenCalled();
    expect(createEdgeMock).not.toHaveBeenCalled();
    expect(ratifyMock).not.toHaveBeenCalled(); // proposals never auto-commit (§4)
  });

  it('propose degrades to an empty queue when the near-ness module fails', async () => {
    rungsMock.mockRejectedValueOnce(new Error('no cache'));
    const res = await post({ action: 'propose', childLabel: 'Medici Family' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { proposals: unknown[] }).proposals).toEqual([]);
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
});
