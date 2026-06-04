import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, getSessionMock, selectCallChain, updateSetMock } = vi.hoisted(() => {
  const selectCallChain: Array<() => Promise<unknown[]>> = [];
  const updateSetMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  const dbMock = {
    select: vi.fn(() => {
      const handler = selectCallChain.shift() ?? (async () => []);
      return {
        from: () => ({
          where: () => ({
            limit: handler,
          }),
        }),
      };
    }),
    update: vi.fn(() => ({ set: updateSetMock })),
  };
  return {
    dbMock,
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    selectCallChain,
    updateSetMock,
  };
});

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/server/db', () => ({
  db: dbMock,
  dailyQueues: { id: 'q.id', userId: 'q.userId' },
  feedItems: {
    id: 'f.id',
    recipientUserId: 'f.recipient',
    catchupResolvedAt: 'f.catchupResolvedAt',
  },
}));

vi.mock('@/server/daily/catchup', () => ({
  asQueueSlots: (v: unknown) => (Array.isArray(v) ? v : []),
  findQueueSlotBySlotIndex: (slots: { slot_index: number }[], idx: number) =>
    slots.find((s) => s.slot_index === idx),
  replaceQueueSlot: (slots: { slot_index: number }[], idx: number, fn: (s: unknown) => unknown) =>
    slots.map((s) => (s.slot_index === idx ? fn(s) : s)),
  parseCatchupItemId: (id: string) => {
    if (id.startsWith('feed:')) return { surface: 'feed', feedItemId: id.slice(5) };
    const [queueId, slotIndexValue] = id.split(':');
    if (!queueId || !Number.isInteger(Number(slotIndexValue))) return null;
    return { surface: 'daily', queueId, slotIndex: Number(slotIndexValue) };
  },
}));

vi.mock('@/server/play/catch-up-submit-error', () => ({
  catchUpErrorResponse: (status: number, code: string, message?: string) =>
    Response.json({ error: code, message }, { status }),
}));

import { POST } from '@/app/api/daily/catchup/undismiss/route';

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/daily/catchup/undismiss', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/daily/catchup/undismiss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallChain.length = 0;
    getSessionMock.mockResolvedValue({ userId: 'user-1', id: 's-1' });
  });

  it('clears dismissed_at/dismissed_reason on a daily slot', async () => {
    selectCallChain.push(async () => [
      {
        id: 'queue-1',
        userId: 'user-1',
        slots: [
          {
            slot_index: 0,
            answered: false,
            dismissed_at: '2026-06-01T00:00:00.000Z',
            dismissed_reason: 'not_interested',
          },
        ],
      },
    ]);

    const response = await POST(jsonRequest({ dailyQueueItemId: 'queue-1:0' }) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restored: true });
    const setArg = updateSetMock.mock.calls[0]![0] as {
      slots: Array<{ dismissed_at?: string; dismissed_reason?: string }>;
    };
    expect(setArg.slots[0].dismissed_at).toBeUndefined();
    expect(setArg.slots[0].dismissed_reason).toBeUndefined();
  });

  it('clears catchupResolvedAt on a feed item', async () => {
    selectCallChain.push(async () => [
      { id: 'feed-1', recipientUserId: 'user-1', catchupResolvedAt: new Date() },
    ]);

    const response = await POST(jsonRequest({ dailyQueueItemId: 'feed:feed-1' }) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restored: true });
    expect(updateSetMock).toHaveBeenCalledWith({ catchupResolvedAt: null });
  });

  it('401s when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null as never);
    const response = await POST(jsonRequest({ dailyQueueItemId: 'queue-1:0' }) as never);
    expect(response.status).toBe(401);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('400s on a missing dailyQueueItemId', async () => {
    const response = await POST(jsonRequest({}) as never);
    expect(response.status).toBe(400);
  });

  it('404s when the daily queue belongs to another user', async () => {
    selectCallChain.push(async () => [{ id: 'queue-1', userId: 'someone-else', slots: [] }]);
    const response = await POST(jsonRequest({ dailyQueueItemId: 'queue-1:0' }) as never);
    expect(response.status).toBe(404);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('404s when the feed item belongs to another user', async () => {
    selectCallChain.push(async () => [
      { id: 'feed-1', recipientUserId: 'someone-else', catchupResolvedAt: new Date() },
    ]);
    const response = await POST(jsonRequest({ dailyQueueItemId: 'feed:feed-1' }) as never);
    expect(response.status).toBe(404);
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
