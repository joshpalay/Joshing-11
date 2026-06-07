import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, convergeDomainMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  convergeDomainMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/knowledge/converge-domain', () => ({ convergeDomain: convergeDomainMock }));

import { POST } from '@/app/api/knowledge/converge/route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/knowledge/converge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/knowledge/converge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await POST(request({ label: 'Delta Blues' }));
    expect(response.status).toBe(401);
    expect(convergeDomainMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid input (empty / too long)', async () => {
    expect((await POST(request({ label: '' }))).status).toBe(400);
    expect((await POST(request({ label: 'x'.repeat(101) }))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
    expect(convergeDomainMock).not.toHaveBeenCalled();
  });

  it('returns the convergence result on a valid request', async () => {
    const result = {
      raw: 'Delta Blues',
      candidates: [{ label: 'Delta Blues', broadCategory: 'Music', kind: 'exact', similarity: 1 }],
    };
    convergeDomainMock.mockResolvedValue(result);

    const response = await POST(request({ label: '  Delta Blues ' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(convergeDomainMock).toHaveBeenCalledWith('Delta Blues');
  });
});
