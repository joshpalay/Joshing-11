import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, generateBreadcrumbMock, getSessionMock, selectCallChain, updateSetSpy } =
  vi.hoisted(() => {
    const selectCallChain: Array<() => Promise<unknown[]>> = [];
    const updateSetSpy = vi.fn(async () => undefined);

    function makeChainable(): Record<string, unknown> {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.innerJoin = () => chain;
      chain.where = () => chain;
      chain.limit = () => {
        const handler = selectCallChain.shift() ?? (async () => []);
        return handler();
      };
      return chain;
    }

    const dbMock = {
      select: vi.fn(() => makeChainable()),
      update: vi.fn(() => ({
        set: vi.fn((updates: unknown) => ({
          where: vi.fn(async () => {
            await updateSetSpy(updates);
          }),
        })),
      })),
    };

    return {
      dbMock,
      generateBreadcrumbMock: vi.fn(),
      getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
      selectCallChain,
      updateSetSpy,
    };
  });

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/server/db', () => ({
  db: dbMock,
  dailyQueues: { id: 'q.id', userId: 'q.userId' },
  joshingGames: { id: 'g.id', creatorId: 'g.creatorId' },
  joshingGameRecipients: { id: 'r.id', gameId: 'r.gameId', userId: 'r.userId' },
  joshingGameResponses: {
    id: 'jr.id',
    gameId: 'jr.gameId',
    questionId: 'jr.questionId',
    userId: 'jr.userId',
  },
  questions: {
    id: 'q.id',
    canonicalSubcategory: 'q.cs',
    broadCategory: 'q.bc',
    category: 'q.c',
  },
}));

vi.mock('@/server/daily/generate-breadcrumb', () => ({
  generateBreadcrumb: generateBreadcrumbMock,
}));

vi.mock('@/server/daily/catchup', () => ({
  asQueueSlots: (value: unknown) => (Array.isArray(value) ? value : []),
  findQueueSlotBySlotIndex: (slots: { slot_index: number }[], idx: number) =>
    slots.find((s) => s.slot_index === idx) ?? null,
  replaceQueueSlot: (slots: { slot_index: number }[], idx: number, fn: (s: unknown) => unknown) =>
    slots.map((s) => (s.slot_index === idx ? fn(s) : s)),
}));

import { POST } from '@/app/api/breadcrumb/route';

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/breadcrumb', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/breadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallChain.length = 0;
    generateBreadcrumbMock.mockReset();
  });

  it('returns 401 when unauthorized', async () => {
    getSessionMock.mockResolvedValueOnce(null as never);
    const res = await POST(jsonRequest({ source: 'daily', queueId: 'q-1', slotIndex: 0 }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body shape', async () => {
    const res = await POST(jsonRequest({ source: 'unknown' }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation');
  });

  describe('daily', () => {
    it('returns null breadcrumb for gaveUp (no submitted answer + incorrect)', async () => {
      selectCallChain.push(async () => [
        {
          id: 'queue-1',
          userId: 'user-1',
          slots: [
            {
              slot_index: 0,
              source: 'bot',
              domain: 'history',
              question_text: 'q?',
              answered: true,
              answer_state: 'incorrect',
              submitted_answer: '',
            },
          ],
        },
      ]);

      const res = await POST(
        jsonRequest({ source: 'daily', queueId: 'queue-1', slotIndex: 0 }) as never,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ breadcrumb: null });
      expect(generateBreadcrumbMock).not.toHaveBeenCalled();
    });

    it('returns existing breadcrumb without calling LLM when slot already has one', async () => {
      selectCallChain.push(async () => [
        {
          id: 'queue-1',
          userId: 'user-1',
          slots: [
            {
              slot_index: 0,
              source: 'bot',
              domain: 'history',
              question_text: 'q?',
              answered: true,
              answer_state: 'correct',
              submitted_answer: 'A',
              reveal_canonical_answer: 'A',
              reveal_breadcrumb: 'cached crumb',
            },
          ],
        },
      ]);

      const res = await POST(
        jsonRequest({ source: 'daily', queueId: 'queue-1', slotIndex: 0 }) as never,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ breadcrumb: 'cached crumb' });
      expect(generateBreadcrumbMock).not.toHaveBeenCalled();
    });

    it('generates, persists to slot, and returns breadcrumb for a fresh answer', async () => {
      selectCallChain.push(async () => [
        {
          id: 'queue-1',
          userId: 'user-1',
          slots: [
            {
              slot_index: 0,
              source: 'bot',
              generated_question_id: 'gen-q-1',
              domain: 'history',
              question_text: 'q?',
              answered: true,
              answer_state: 'correct',
              submitted_answer: 'A',
              reveal_canonical_answer: 'A',
            },
          ],
        },
      ]);
      generateBreadcrumbMock.mockResolvedValueOnce('fresh crumb');

      const res = await POST(
        jsonRequest({ source: 'daily', queueId: 'queue-1', slotIndex: 0 }) as never,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ breadcrumb: 'fresh crumb' });
      expect(generateBreadcrumbMock).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: 'gen-q-1',
          isCorrect: true,
          domain: 'history',
          correctAnswer: 'A',
          submittedAnswer: 'A',
        }),
      );
      expect(updateSetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slots: expect.arrayContaining([
            expect.objectContaining({ reveal_breadcrumb: 'fresh crumb' }),
          ]),
        }),
      );
    });

    it('returns null without persisting when generator times out', async () => {
      selectCallChain.push(async () => [
        {
          id: 'queue-1',
          userId: 'user-1',
          slots: [
            {
              slot_index: 0,
              source: 'bot',
              domain: 'history',
              question_text: 'q?',
              answered: true,
              answer_state: 'correct',
              submitted_answer: 'A',
              reveal_canonical_answer: 'A',
            },
          ],
        },
      ]);
      generateBreadcrumbMock.mockResolvedValueOnce(null);

      const res = await POST(
        jsonRequest({ source: 'daily', queueId: 'queue-1', slotIndex: 0 }) as never,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ breadcrumb: null });
      expect(updateSetSpy).not.toHaveBeenCalled();
    });

    it('rejects unanswered slots', async () => {
      selectCallChain.push(async () => [
        {
          id: 'queue-1',
          userId: 'user-1',
          slots: [
            {
              slot_index: 0,
              source: 'bot',
              domain: 'history',
              question_text: 'q?',
              answered: false,
            },
          ],
        },
      ]);

      const res = await POST(
        jsonRequest({ source: 'daily', queueId: 'queue-1', slotIndex: 0 }) as never,
      );
      expect(res.status).toBe(400);
      expect(generateBreadcrumbMock).not.toHaveBeenCalled();
    });
  });
});
