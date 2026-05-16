import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readSessionClaimsMock } = vi.hoisted(() => ({
  readSessionClaimsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  readSessionClaims: readSessionClaimsMock,
}))

import { middleware } from '@/middleware'

function makeRequest(
  pathname: string,
  options: { cookie?: string; search?: string } = {},
) {
  const url = `http://localhost${pathname}${options.search ?? ''}`
  return {
    nextUrl: new URL(url),
    url,
    cookies: {
      get: (name: string) =>
        options.cookie && name === 'joshing_session'
          ? { value: options.cookie }
          : undefined,
    },
  } as unknown as import('next/server').NextRequest
}

describe('middleware (invitation gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readSessionClaimsMock.mockReset()
  })

  describe('unauthenticated', () => {
    it('redirects page requests with no cookie to /login with next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null)
      const res = await middleware(makeRequest('/feed'))
      expect(res.status).toBe(307) // NextResponse.redirect default
      expect(res.headers.get('location')).toContain('/login')
      expect(res.headers.get('location')).toContain('next=%2Ffeed')
    })

    it('returns 401 JSON for API requests with no cookie', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null)
      const res = await middleware(makeRequest('/api/feed'))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('unauthenticated')
    })

    it('rejects requests with a present-but-invalid JWT (readSessionClaims returns null)', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null)
      const res = await middleware(
        makeRequest('/feed', { cookie: 'tampered.jwt.value' }),
      )
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/login')
    })
  })

  describe('authenticated with invitation claim', () => {
    it('lets page requests through when JWT has inv: true', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
      })
      const res = await middleware(
        makeRequest('/feed', { cookie: 'valid.jwt' }),
      )
      // NextResponse.next() returns 200 with no special headers
      expect(res.status).toBe(200)
    })

    it('lets API requests through when JWT has inv: true', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
      })
      const res = await middleware(
        makeRequest('/api/feed', { cookie: 'valid.jwt' }),
      )
      expect(res.status).toBe(200)
    })
  })

  describe('legacy session (valid JWT, missing inv claim)', () => {
    it('redirects page requests to /api/auth/refresh-session with next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: false,
      })
      const res = await middleware(
        makeRequest('/knowledge', { cookie: 'legacy.jwt' }),
      )
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain(
        '/api/auth/refresh-session',
      )
      expect(res.headers.get('location')).toContain('next=%2Fknowledge')
    })

    it('returns 401 JSON with refresh marker for API requests', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: false,
      })
      const res = await middleware(
        makeRequest('/api/feed', { cookie: 'legacy.jwt' }),
      )
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('session_refresh_required')
    })
  })
})
