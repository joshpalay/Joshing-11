import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readSessionClaimsMock } = vi.hoisted(() => ({
  readSessionClaimsMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  readSessionClaims: readSessionClaimsMock,
}));

import { proxy } from '@/proxy';

function makeRequest(pathname: string, options: { cookie?: string; search?: string } = {}) {
  const url = `http://localhost${pathname}${options.search ?? ''}`;
  return {
    nextUrl: new URL(url),
    url,
    method: 'GET',
    headers: {
      get: () => null,
    },
    cookies: {
      get: (name: string) =>
        options.cookie && name === 'joshing_session' ? { value: options.cookie } : undefined,
    },
  } as unknown as import('next/server').NextRequest;
}

describe('proxy (invitation gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionClaimsMock.mockReset();
  });

  describe('unauthenticated', () => {
    it('redirects page requests with no cookie to /login with next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null);
      const res = await proxy(makeRequest('/knowledge'));
      expect(res.status).toBe(307); // NextResponse.redirect default
      expect(res.headers.get('location')).toContain('/login');
      expect(res.headers.get('location')).toContain('next=%2Fknowledge');
    });

    it('returns 401 JSON for API requests with no cookie', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null);
      const res = await proxy(makeRequest('/api/feed'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('unauthenticated');
    });

    it('rejects requests with a present-but-invalid JWT (readSessionClaims returns null)', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null);
      const res = await proxy(makeRequest('/knowledge', { cookie: 'tampered.jwt.value' }));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login');
    });
  });

  describe('authenticated with invitation claim', () => {
    it('lets API requests through when JWT has inv: true', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      });
      const res = await proxy(makeRequest('/api/feed', { cookie: 'valid.jwt' }));
      expect(res.status).toBe(200);
    });

    it('passes onboarded users through to the requested page', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      });
      const res = await proxy(makeRequest('/knowledge', { cookie: 'valid.jwt' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('redirects an onboarded user away from /login', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      });
      const res = await proxy(makeRequest('/login', { cookie: 'valid.jwt' }));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/\/$/);
    });

    it('redirects an onboarded user away from /onboarding', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      });
      const res = await proxy(makeRequest('/onboarding', { cookie: 'valid.jwt' }));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/\/$/);
    });
  });

  describe('authenticated but onboarding not yet complete', () => {
    it('lets the user reach /onboarding without bouncing', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: false,
      });
      const res = await proxy(makeRequest('/onboarding', { cookie: 'valid.jwt' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('redirects any other page to the onboarding-claim refresh endpoint with a next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: false,
      });
      const res = await proxy(makeRequest('/knowledge', { cookie: 'valid.jwt' }));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/api/auth/refresh-onboarding-claim');
      expect(res.headers.get('location')).toContain('next=%2Fknowledge');
    });
  });

  describe('legacy session (valid JWT, missing inv claim)', () => {
    it('redirects page requests to /api/auth/refresh-session with next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: false,
        onboardingComplete: false,
      });
      const res = await proxy(makeRequest('/knowledge', { cookie: 'legacy.jwt' }));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/api/auth/refresh-session');
      expect(res.headers.get('location')).toContain('next=%2Fknowledge');
    });

    it('returns 401 JSON with refresh marker for API requests', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: false,
        onboardingComplete: false,
      });
      const res = await proxy(makeRequest('/api/feed', { cookie: 'legacy.jwt' }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('session_refresh_required');
    });
  });
});
