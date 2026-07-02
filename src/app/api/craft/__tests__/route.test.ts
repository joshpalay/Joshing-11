import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

const { getSessionMock, hasInvitationMock, draftMock, keepMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'player-1', id: 's-1' }) as { userId: string; id: string } | null),
  hasInvitationMock: vi.fn(async () => true),
  draftMock: vi.fn(async () => ({ ok: true as const, candidates: [] })),
  keepMock: vi.fn(async () => ({
    ok: true as const,
    id: 'q-new',
    publicStatus: 'eligible_pending',
    vetReason: 'clean',
  })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/author-invitations', () => ({ hasActiveInvitation: hasInvitationMock }));
vi.mock('@/server/crafter/draft-candidates', () => ({ draftCandidatesForDomain: draftMock }));
vi.mock('@/server/crafter/keep-candidate', () => ({ keepCandidate: keepMock }));

import { POST } from '@/app/api/craft/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/craft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'player-1', id: 's-1' });
  hasInvitationMock.mockResolvedValue(true);
});

describe('POST /api/craft (player creation surface)', () => {
  it('401s the unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await post({ action: 'draft', domain: 'Tears of the Kingdom', tier: 'deep' });
    expect(res.status).toBe(401);
  });

  it('404s (never reveals) without an active invitation for the domain', async () => {
    hasInvitationMock.mockResolvedValueOnce(false);
    const res = await post({ action: 'draft', domain: 'Tears of the Kingdom', tier: 'deep' });
    expect(res.status).toBe(404);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it('the invitation gate is checked against THIS domain', async () => {
    await post({ action: 'draft', domain: 'Tennis', tier: 'shallow' });
    expect(hasInvitationMock).toHaveBeenCalledWith('player-1', 'Tennis');
  });

  it('drafts for an invited player without persisting', async () => {
    const res = await post({ action: 'draft', domain: 'Tears of the Kingdom', tier: 'deep', count: 4 });
    expect(res.status).toBe(200);
    expect(draftMock).toHaveBeenCalledWith({ domain: 'Tears of the Kingdom', tier: 'deep', count: 4 });
    expect(keepMock).not.toHaveBeenCalled();
  });

  it('keep enters the shared rail attributed to the player', async () => {
    const res = await post({
      action: 'keep',
      domain: 'Tears of the Kingdom',
      tier: 'deep',
      questionText: 'Which sage grants the vow of wind?',
      answer: 'Tulin',
      machineDraftAnswer: 'Tulin',
      difficultyEstimate: 'specialist',
      broadCategory: 'Video Games',
    });
    expect(res.status).toBe(201);
    expect(keepMock).toHaveBeenCalledWith(
      expect.objectContaining({ keeperUserId: 'player-1', domain: 'Tears of the Kingdom' }),
    );
  });

  it('maps a safety-fail keep to 422', async () => {
    keepMock.mockResolvedValueOnce({ ok: false, reason: 'failed_content_check', id: 'q-blocked' });
    const res = await post({
      action: 'keep',
      domain: 'Tennis',
      tier: 'shallow',
      questionText: 'bad',
      answer: 'bad',
      difficultyEstimate: 'accessible',
      broadCategory: 'Sports',
    });
    expect(res.status).toBe(422);
  });
});
