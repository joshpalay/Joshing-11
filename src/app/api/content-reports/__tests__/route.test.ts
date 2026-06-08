import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextRequest } from 'next/server';

const { getSessionMock, insertContentReportMock, countContentReportsTodayMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' }) as { userId: string; id: string } | null),
  insertContentReportMock: vi.fn(async () => 'inserted' as 'inserted' | 'duplicate'),
  countContentReportsTodayMock: vi.fn(async () => 0),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/content-reports', () => ({
  insertContentReport: insertContentReportMock,
  countContentReportsToday: countContentReportsTodayMock,
}));

import { POST } from '@/app/api/content-reports/route';

function post(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/content-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

const validIncorrect = {
  category: 'incorrect',
  incorrectKind: 'answer_key',
  note: 'the answer key is wrong',
  suggestedAnswer: 'Paris',
  surface: 'round_recap',
  questionId: 'q-1',
};

const validInappropriate = {
  category: 'inappropriate',
  note: 'this is offensive',
  surface: 'lately_result',
  questionId: 'q-7',
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: 'user-1', id: 's-1' });
  insertContentReportMock.mockResolvedValue('inserted');
  countContentReportsTodayMock.mockResolvedValue(0);
});

describe('POST /api/content-reports', () => {
  it('rejects unauthenticated requests', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await post(validIncorrect);
    expect(res.status).toBe(401);
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('lands an incorrect report with the curated-question target', async () => {
    const res = await post(validIncorrect);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(insertContentReportMock).toHaveBeenCalledTimes(1);
    expect(insertContentReportMock).toHaveBeenCalledWith({
      reporterUserId: 'user-1',
      questionId: 'q-1',
      generatedQuestionId: null,
      category: 'incorrect',
      incorrectKind: 'answer_key',
      suggestedAnswer: 'Paris',
      note: 'the answer key is wrong',
      surface: 'round_recap',
    });
  });

  it('lands an inappropriate report and nulls incorrect-only fields', async () => {
    const res = await post({ ...validInappropriate, generatedQuestionId: undefined });
    expect(res.status).toBe(200);
    expect(insertContentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'inappropriate',
        incorrectKind: null,
        suggestedAnswer: null,
        questionId: 'q-7',
        generatedQuestionId: null,
      }),
    );
  });

  it('accepts a generated-question target', async () => {
    const res = await post({
      category: 'inappropriate',
      note: 'nope',
      surface: 'round_recap',
      generatedQuestionId: 'gq-3',
    });
    expect(res.status).toBe(200);
    expect(insertContentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: null, generatedQuestionId: 'gq-3' }),
    );
  });

  it('rejects a missing note', async () => {
    const res = await post({ ...validIncorrect, note: '   ' });
    expect(res.status).toBe(400);
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('rejects when both targets are present', async () => {
    const res = await post({ ...validIncorrect, generatedQuestionId: 'gq-1' });
    expect(res.status).toBe(400);
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('rejects when neither target is present', async () => {
    const { questionId: _omit, ...noTarget } = validIncorrect;
    const res = await post(noTarget);
    expect(res.status).toBe(400);
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('rejects incorrectKind on an inappropriate report', async () => {
    const res = await post({ ...validInappropriate, incorrectKind: 'premise' });
    expect(res.status).toBe(400);
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown surface', async () => {
    const res = await post({ ...validIncorrect, surface: 'in_play' });
    expect(res.status).toBe(400);
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('soft-429s at the daily cap without writing', async () => {
    countContentReportsTodayMock.mockResolvedValueOnce(10);
    const res = await post(validIncorrect);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('rate_limited');
    expect(json.message).toBeTruthy();
    expect(insertContentReportMock).not.toHaveBeenCalled();
  });

  it('still writes at one below the cap', async () => {
    countContentReportsTodayMock.mockResolvedValueOnce(9);
    const res = await post(validIncorrect);
    expect(res.status).toBe(200);
    expect(insertContentReportMock).toHaveBeenCalledTimes(1);
  });

  it('treats an idempotent duplicate as success', async () => {
    insertContentReportMock.mockResolvedValueOnce('duplicate');
    const res = await post(validIncorrect);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
  });
});
