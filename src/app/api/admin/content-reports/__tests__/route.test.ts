import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

const {
  getSessionMock,
  isAdminUserMock,
  upholdMock,
  dismissMock,
  reverseMock,
  resolveReportsMock,
  restoreDemotedMock,
  retireDemotedMock,
  editContentMock,
  approveMock,
  rerunMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'admin-1', id: 's-1' }) as { userId: string; id: string } | null),
  isAdminUserMock: vi.fn(() => true),
  upholdMock: vi.fn(async () => ({ ok: true, action: 'upheld', category: 'inappropriate', hardRemoved: true })),
  dismissMock: vi.fn(async () => ({ ok: true, action: 'dismissed', category: 'incorrect', hardRemoved: false })),
  reverseMock: vi.fn(async () => ({ ok: true, action: 'reversed', table: 'question', restoredVisibility: 'public' })),
  resolveReportsMock: vi.fn(async () => 1),
  restoreDemotedMock: vi.fn(async () => ({ ok: true, action: 'restored' })),
  retireDemotedMock: vi.fn(async () => ({ ok: true, action: 'retired' })),
  editContentMock: vi.fn(async () => ({ ok: true, action: 'edited' })),
  approveMock: vi.fn(async () => ({ ok: true, resolvedReports: 1 })),
  rerunMock: vi.fn(async () => ({
    suggestedAnswer: 'Demon Dragon',
    alternateAnswers: [],
    explanation: 'His draconification form.',
    verdict: 'ok',
    reason: 'verified',
    usedWeb: true,
    verifiedAnswer: 'Demon Dragon',
  })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: isAdminUserMock }));
vi.mock('@/server/db/queries/content-reports', () => ({
  upholdReport: upholdMock,
  dismissReport: dismissMock,
  reverseBlock: reverseMock,
  resolveActiveIncorrectReportsForQuestion: resolveReportsMock,
}));
vi.mock('@/server/db/queries/machine-demotions', () => ({
  restoreDemotedQuestion: restoreDemotedMock,
  retireDemotedQuestion: retireDemotedMock,
  editQuestionContent: editContentMock,
  approveEditedQuestion: approveMock,
}));
vi.mock('@/server/quality/rerun-question', () => ({ rerunQuestion: rerunMock }));
vi.mock('@/server/db/queries/salvage-proposals', () => ({
  resolveSalvageProposal: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '@/app/api/admin/content-reports/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/admin/content-reports', {
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

describe('POST /api/admin/content-reports', () => {
  it('returns 404 (not 403) for an authenticated non-admin and takes no action', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ reportId: 'r1', action: 'uphold' });
    expect(res.status).toBe(404);
    expect(upholdMock).not.toHaveBeenCalled();
    expect(dismissMock).not.toHaveBeenCalled();
  });

  it('returns 404 for the unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await post({ reportId: 'r1', action: 'uphold' });
    expect(res.status).toBe(404);
  });

  it('upholds for an admin', async () => {
    const res = await post({ reportId: 'r1', action: 'uphold', reviewReason: 'bad' });
    expect(res.status).toBe(200);
    expect(upholdMock).toHaveBeenCalledWith('r1', 'bad');
  });

  it('dismisses for an admin', async () => {
    const res = await post({ reportId: 'r2', action: 'dismiss' });
    expect(res.status).toBe(200);
    expect(dismissMock).toHaveBeenCalledWith('r2', undefined);
  });

  it('rejects an invalid action', async () => {
    const res = await post({ reportId: 'r1', action: 'delete' });
    expect(res.status).toBe(400);
    expect(upholdMock).not.toHaveBeenCalled();
  });

  it('maps an already-resolved result to 409', async () => {
    upholdMock.mockResolvedValueOnce({ ok: false, reason: 'already_resolved' });
    const res = await post({ reportId: 'r1', action: 'uphold' });
    expect(res.status).toBe(409);
  });

  // ─── B-REVIEW-RERUN-01: re-run + approve ───

  it('rerun_verify runs the LLM and persists NOTHING', async () => {
    const res = await post({
      action: 'rerun_verify',
      questionText: 'What dragon form does Ganondorf become?',
    });
    expect(res.status).toBe(200);
    expect(rerunMock).toHaveBeenCalledWith(
      expect.objectContaining({ questionText: 'What dragon form does Ganondorf become?' }),
    );
    expect(approveMock).not.toHaveBeenCalled(); // preview only
    const body = (await res.json()) as { verdict: string; suggestedAnswer: string };
    expect(body.verdict).toBe('ok');
    expect(body.suggestedAnswer).toBe('Demon Dragon');
  });

  it('rerun_verify maps an unavailable LLM to 503', async () => {
    rerunMock.mockResolvedValueOnce(null);
    const res = await post({ action: 'rerun_verify', questionText: 'q?' });
    expect(res.status).toBe(503);
  });

  it('approve persists the edit + verified stamp for a GENERATED target', async () => {
    const res = await post({
      action: 'approve',
      target: { table: 'generated', id: 'g1' },
      questionText: 'Fixed question?',
      answerText: 'Demon Dragon',
      explanation: 'His draconification form.',
    });
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(
      { table: 'generated', id: 'g1' },
      { questionText: 'Fixed question?', answerText: 'Demon Dragon', explanation: 'His draconification form.' },
    );
  });

  it('approve maps a missing target to 404', async () => {
    approveMock.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const res = await post({
      action: 'approve',
      target: { table: 'question', id: 'gone' },
      questionText: 'q?',
      answerText: 'a',
    });
    expect(res.status).toBe(404);
  });

  it('rerun + approve are gated to admins (404, no LLM call)', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ action: 'rerun_verify', questionText: 'q?' });
    expect(res.status).toBe(404);
    expect(rerunMock).not.toHaveBeenCalled();
  });

  // ─── B-CRAFTER-LIFECYCLE-01 Phase 1: machine-demotion actions ───

  it('restores a demoted question for an admin', async () => {
    const res = await post({ action: 'restore_demoted', questionId: 'q1' });
    expect(res.status).toBe(200);
    expect(restoreDemotedMock).toHaveBeenCalledWith('q1');
  });

  it('retires a demoted question for an admin', async () => {
    const res = await post({ action: 'retire_demoted', questionId: 'q1' });
    expect(res.status).toBe(200);
    expect(retireDemotedMock).toHaveBeenCalledWith('q1');
  });

  it('maps a not-demoted restore to 409', async () => {
    restoreDemotedMock.mockResolvedValueOnce({ ok: false, reason: 'not_demoted' });
    const res = await post({ action: 'restore_demoted', questionId: 'q1' });
    expect(res.status).toBe(409);
  });

  it('edit updates content and resolves active incorrect reports as admin_edited', async () => {
    const res = await post({
      action: 'edit',
      questionId: 'q1',
      questionText: 'Fixed question?',
      answerText: 'Fixed answer',
    });
    expect(res.status).toBe(200);
    expect(editContentMock).toHaveBeenCalledWith('q1', {
      questionText: 'Fixed question?',
      answerText: 'Fixed answer',
      factualExplanation: undefined,
    });
    expect(resolveReportsMock).toHaveBeenCalledWith('q1', 'admin_edited');
  });

  it('rejects an edit that changes nothing', async () => {
    const res = await post({ action: 'edit', questionId: 'q1' });
    expect(res.status).toBe(400);
    expect(editContentMock).not.toHaveBeenCalled();
  });

  it('does not resolve reports when the edit itself fails', async () => {
    editContentMock.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const res = await post({ action: 'edit', questionId: 'missing', questionText: 'x?' });
    expect(res.status).toBe(404);
    expect(resolveReportsMock).not.toHaveBeenCalled();
  });

  it('returns 404 for demotion actions from a non-admin', async () => {
    isAdminUserMock.mockReturnValue(false);
    const res = await post({ action: 'restore_demoted', questionId: 'q1' });
    expect(res.status).toBe(404);
    expect(restoreDemotedMock).not.toHaveBeenCalled();
  });
});
