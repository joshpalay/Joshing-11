import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  getDailyPreferencesMock,
  getKnowledgeBaseMock,
  updateDailyPreferencesMock,
  invalidateUntouchedDailyQueuesMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getDailyPreferencesMock: vi.fn(),
  getKnowledgeBaseMock: vi.fn(),
  updateDailyPreferencesMock: vi.fn(),
  invalidateUntouchedDailyQueuesMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/daily', () => ({
  getKnowledgeBase: getKnowledgeBaseMock,
  invalidateUntouchedDailyQueues: invalidateUntouchedDailyQueuesMock,
}));
vi.mock('@/server/db/queries/daily-preferences', () => ({
  getDailyPreferences: getDailyPreferencesMock,
  updateDailyPreferences: updateDailyPreferencesMock,
}));

import { POST } from '@/app/api/daily/preferences/domain-frequency/route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/daily/preferences/domain-frequency', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/daily/preferences/domain-frequency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'user-1' });
    getKnowledgeBaseMock.mockResolvedValue([
      { domain: 'Harry Potter Book 3' },
      { domain: 'Dune' },
    ]);
    getDailyPreferencesMock.mockResolvedValue({
      userId: 'user-1',
      difficulty: 'adaptive',
      domainMode: 'custom',
      selectedDomains: ['Dune'],
      domainPreferenceFrequency: { Dune: 'often' },
      updatedAt: null,
    });
    updateDailyPreferencesMock.mockImplementation(async (_userId, data) => ({
      userId: 'user-1',
      difficulty: 'adaptive',
      domainMode: 'custom',
      selectedDomains: ['Dune'],
      domainPreferenceFrequency: data.domainPreferenceFrequency,
      updatedAt: new Date(),
    }));
  });

  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await POST(request({ domain: 'Dune', frequency: 'blue_moon' }));
    expect(response.status).toBe(401);
    expect(updateDailyPreferencesMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown frequency', async () => {
    const response = await POST(request({ domain: 'Dune', frequency: 'never' }));
    expect(response.status).toBe(400);
    expect(updateDailyPreferencesMock).not.toHaveBeenCalled();
  });

  it('merges blue_moon in without clobbering other domains and reports no prior value', async () => {
    const response = await POST(request({ domain: 'Harry Potter Book 3', frequency: 'blue_moon' }));

    expect(response.status).toBe(200);
    // Canonical KB casing is used for the new entry; existing entries survive.
    expect(updateDailyPreferencesMock).toHaveBeenCalledWith('user-1', {
      domainPreferenceFrequency: { Dune: 'often', 'Harry Potter Book 3': 'blue_moon' },
    });
    const body = await response.json();
    expect(body.previousFrequency).toBeNull();
    expect(invalidateUntouchedDailyQueuesMock).toHaveBeenCalledWith('user-1');
  });

  it('captures the prior frequency case-insensitively', async () => {
    const response = await POST(request({ domain: 'dune', frequency: 'blue_moon' }));

    expect(response.status).toBe(200);
    expect(updateDailyPreferencesMock).toHaveBeenCalledWith('user-1', {
      domainPreferenceFrequency: { Dune: 'blue_moon' },
    });
    const body = await response.json();
    expect(body.previousFrequency).toBe('often');
  });

  it('clears the entry when frequency is null (undo to default)', async () => {
    const response = await POST(request({ domain: 'Dune', frequency: null }));

    expect(response.status).toBe(200);
    // The Dune entry is dropped entirely, restoring default rotation.
    expect(updateDailyPreferencesMock).toHaveBeenCalledWith('user-1', {
      domainPreferenceFrequency: {},
    });
    const body = await response.json();
    expect(body.previousFrequency).toBe('often');
  });
});
