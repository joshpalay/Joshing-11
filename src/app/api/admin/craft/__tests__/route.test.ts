import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

const { getSessionMock, isAdminUserMock, draftMock, createQuestionMock, vetMock, recordDecisionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'admin-1', id: 's-1' }) as { userId: string; id: string } | null),
  isAdminUserMock: vi.fn(() => true),
  draftMock: vi.fn(async () => ({
    ok: true as const,
    candidates: [
      {
        questionText: 'Which sage grants the vow of wind?',
        answer: 'Tulin',
        explainer: 'Tulin of the Rito.',
        difficultyEstimate: 'specialist' as const,
        factKey: 'sage_wind_tulin',
        broadCategory: 'Video Games',
        canonicalSubcategory: 'Tears of the Kingdom',
        flags: [],
      },
    ],
  })),
  createQuestionMock: vi.fn(async () => ({ id: 'q-new' })),
  vetMock: vi.fn(async () => ({ status: 'approved' as const, score: 0.9, reason: 'clean' })),
  recordDecisionMock: vi.fn(async () => undefined),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/crafter/draft-candidates', () => ({ draftCandidatesForDomain: draftMock }));
vi.mock('@/server/db/queries/questions', () => ({ createQuestion: createQuestionMock }));
vi.mock('@/server/llm/vet-question', () => ({ vetQuestion: vetMock }));
vi.mock('@/server/db/queries/crafter-decisions', () => ({ recordDraftDecision: recordDecisionMock }));

import { POST } from '@/app/api/admin/craft/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/admin/craft', {
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

describe('POST /api/admin/craft', () => {
  it('returns 404 (not 403) for a non-admin and drafts nothing', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ action: 'draft', domain: 'Tears of the Kingdom', tier: 'deep' });
    expect(res.status).toBe(404);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it('drafts candidates for a domain + tier without persisting', async () => {
    const res = await post({ action: 'draft', domain: 'Tears of the Kingdom', tier: 'deep', count: 4 });
    expect(res.status).toBe(200);
    expect(draftMock).toHaveBeenCalledWith({ domain: 'Tears of the Kingdom', tier: 'deep', count: 4 });
    expect(createQuestionMock).not.toHaveBeenCalled(); // draft never persists
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(1);
  });

  it('maps an unavailable LLM to 503', async () => {
    draftMock.mockResolvedValueOnce({ ok: false, reason: 'llm_unavailable' });
    const res = await post({ action: 'draft', domain: 'Tennis', tier: 'shallow' });
    expect(res.status).toBe(503);
  });

  it('keep runs the inline vet and inserts on the authoring rails with honest provenance', async () => {
    const res = await post({
      action: 'keep',
      domain: 'Tears of the Kingdom',
      tier: 'deep',
      questionText: 'Which sage grants the vow of wind?',
      answer: 'Tulin',
      explainer: 'Tulin of the Rito.',
      machineDraftAnswer: 'Tulin',
      difficultyEstimate: 'specialist',
      broadCategory: 'Video Games',
    });
    expect(res.status).toBe(201);
    expect(vetMock).toHaveBeenCalled();
    expect(createQuestionMock).toHaveBeenCalledTimes(1);
    const params = createQuestionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.authorId).toBe('admin-1'); // attributed to the crafter
    expect(params.canonicalSubcategory).toBe('Tears of the Kingdom');
    expect(params.llmSuggestedAnswer).toBe('Tulin'); // machine draft recorded
    expect(params.verified).toBe(true); // unchanged answer → llm_suggested
    expect(params.publicStatus).toBe('eligible_pending'); // from the vet verdict
    // createQuestion leaves verifiedAt NULL → the batch-verify sweep re-checks it.
    expect('verifiedAt' in params).toBe(false);
  });

  it('an edited answer keeps llm_edited provenance (verified=false)', async () => {
    await post({
      action: 'keep',
      domain: 'Tears of the Kingdom',
      tier: 'deep',
      questionText: 'Which sage grants the vow of wind?',
      answer: 'Tulin of the Rito',
      machineDraftAnswer: 'Tulin',
      difficultyEstimate: 'specialist',
      broadCategory: 'Video Games',
    });
    const params = createQuestionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.verified).toBe(false);
    expect(params.llmSuggestedAnswer).toBe('Tulin');
  });

  it('a safety-fail vet verdict blocks and returns 422', async () => {
    vetMock.mockResolvedValueOnce({
      status: 'rejected',
      score: 0,
      reason: 'unsafe',
      rejectionKind: 'safety',
    });
    const res = await post({
      action: 'keep',
      domain: 'Tennis',
      tier: 'shallow',
      questionText: 'bad question',
      answer: 'bad',
      difficultyEstimate: 'accessible',
      broadCategory: 'Sports',
    });
    expect(res.status).toBe(422);
    const params = createQuestionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.visibility).toBe('blocked'); // saved but hard-blocked
  });

  it('rejects an invalid body', async () => {
    const res = await post({ action: 'draft', tier: 'deep' });
    expect(res.status).toBe(400);
  });

  // B-CRAFTER-DECISION-LEDGER-01 — the human's verdicts become teaching data.

  it('kill records the verdict to the decision ledger and persists nothing else', async () => {
    const res = await post({
      action: 'kill',
      domain: 'Tears of the Kingdom',
      tier: 'deep',
      questionText: 'Which sage grants the vow of wind?',
      answer: 'Tulin',
      flags: [{ kind: 'tier_mismatch', note: 'reads as accessible' }],
    });
    expect(res.status).toBe(200);
    expect(recordDecisionMock).toHaveBeenCalledWith({
      deciderId: 'admin-1',
      domain: 'Tears of the Kingdom',
      tier: 'deep',
      questionText: 'Which sage grants the vow of wind?',
      answer: 'Tulin',
      decision: 'killed',
      flags: [{ kind: 'tier_mismatch', note: 'reads as accessible' }],
    });
    expect(createQuestionMock).not.toHaveBeenCalled(); // still nothing servable
  });

  it('keep records a kept verdict, with the human correction as editedAnswer', async () => {
    await post({
      action: 'keep',
      domain: 'Tears of the Kingdom',
      tier: 'deep',
      questionText: 'Which sage grants the vow of wind?',
      answer: 'Tulin of the Rito',
      machineDraftAnswer: 'Tulin',
      difficultyEstimate: 'specialist',
      broadCategory: 'Video Games',
    });
    expect(recordDecisionMock).toHaveBeenCalledTimes(1);
    const record = recordDecisionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(record.decision).toBe('kept');
    expect(record.editedAnswer).toBe('Tulin of the Rito'); // corrected → the lesson
    expect(record.questionId).toBe('q-new');
  });

  it('an unchanged keep records editedAnswer=null', async () => {
    await post({
      action: 'keep',
      domain: 'Tennis',
      tier: 'shallow',
      questionText: 'Who won the 2023 Wimbledon men’s final?',
      answer: 'Carlos Alcaraz',
      machineDraftAnswer: 'Carlos Alcaraz',
      difficultyEstimate: 'accessible',
      broadCategory: 'Sports',
    });
    const record = recordDecisionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(record.editedAnswer).toBeNull();
  });

  it('a vet-blocked keep is still ledgered as kept (the human’s verdict stands)', async () => {
    vetMock.mockResolvedValueOnce({
      status: 'rejected',
      score: 0,
      reason: 'unsafe',
      rejectionKind: 'safety',
    });
    const res = await post({
      action: 'keep',
      domain: 'Tennis',
      tier: 'shallow',
      questionText: 'bad question',
      answer: 'bad',
      difficultyEstimate: 'accessible',
      broadCategory: 'Sports',
    });
    expect(res.status).toBe(422);
    expect(recordDecisionMock).toHaveBeenCalledTimes(1);
    expect((recordDecisionMock.mock.calls[0][0] as Record<string, unknown>).decision).toBe('kept');
  });
});
