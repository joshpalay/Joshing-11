import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readSessionClaimsMock } = vi.hoisted(() => ({
  readSessionClaimsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  readSessionClaims: readSessionClaimsMock,
}))

import { config, proxy } from '@/proxy'

function makeRequest(
  pathname: string,
  options: { cookie?: string; search?: string } = {},
) {
  const url = `http://localhost${pathname}${options.search ?? ''}`
  return {
    nextUrl: new URL(url),
    url,
    method: 'GET',
    headers: {
      get: () => null,
    },
    cookies: {
      get: (name: string) =>
        options.cookie && name === 'joshing_session'
          ? { value: options.cookie }
          : undefined,
    },
  } as unknown as import('next/server').NextRequest
}

describe('proxy (invitation gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readSessionClaimsMock.mockReset()
  })

  describe('unauthenticated', () => {
    it('redirects page requests with no cookie to /login with next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null)
      const res = await proxy(makeRequest('/knowledge'))
      expect(res.status).toBe(307) // NextResponse.redirect default
      expect(res.headers.get('location')).toContain('/login')
      expect(res.headers.get('location')).toContain('next=%2Fknowledge')
    })

    it('returns 401 JSON for API requests with no cookie', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null)
      const res = await proxy(makeRequest('/api/feed'))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('unauthenticated')
    })

    it('rejects requests with a present-but-invalid JWT (readSessionClaims returns null)', async () => {
      readSessionClaimsMock.mockResolvedValueOnce(null)
      const res = await proxy(
        makeRequest('/knowledge', { cookie: 'tampered.jwt.value' }),
      )
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/login')
    })
  })

  describe('authenticated with invitation claim', () => {
    it('lets API requests through when JWT has inv: true', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      })
      const res = await proxy(
        makeRequest('/api/feed', { cookie: 'valid.jwt' }),
      )
      expect(res.status).toBe(200)
    })

    it('passes onboarded users through to the requested page', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      })
      const res = await proxy(
        makeRequest('/knowledge', { cookie: 'valid.jwt' }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
    })

    it('passes an onboarded user through to /login (the page does the DB-checked redirect home)', async () => {
      // The proxy no longer bounces /login on signature-only claims: that
      // trapped "zombie" cookies (valid JWT, no DB session row). The login
      // page now redirects genuinely-authenticated users home via getSession.
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      })
      const res = await proxy(makeRequest('/login', { cookie: 'valid.jwt' }))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
      expect(res.headers.get('location')).toBeNull()
    })

    it('redirects an onboarded user away from /onboarding', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: true,
      })
      const res = await proxy(
        makeRequest('/onboarding', { cookie: 'valid.jwt' }),
      )
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/\/$/)
    })
  })

  describe('authenticated but onboarding not yet complete', () => {
    it('lets the user reach /onboarding without bouncing', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: false,
      })
      const res = await proxy(
        makeRequest('/onboarding', { cookie: 'valid.jwt' }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
    })

    it('redirects any other page to the onboarding-claim refresh endpoint with a next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: true,
        onboardingComplete: false,
      })
      const res = await proxy(
        makeRequest('/knowledge', { cookie: 'valid.jwt' }),
      )
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain(
        '/api/auth/refresh-onboarding-claim',
      )
      expect(res.headers.get('location')).toContain('next=%2Fknowledge')
    })
  })

  describe('legacy session (valid JWT, missing inv claim)', () => {
    it('redirects page requests to /api/auth/refresh-session with next param', async () => {
      readSessionClaimsMock.mockResolvedValueOnce({
        userId: 'u1',
        sessionId: 's1',
        invitationAccepted: false,
        onboardingComplete: false,
      })
      const res = await proxy(
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
        onboardingComplete: false,
      })
      const res = await proxy(
        makeRequest('/api/feed', { cookie: 'legacy.jwt' }),
      )
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('session_refresh_required')
    })
  })

  describe('proxy hygiene (the middleware.ts regression)', () => {
    it('src/middleware.ts must not exist — this repo uses src/proxy.ts', () => {
      // Adding a middleware.ts breaks Next 16's proxy. This consolidation
      // (commit 635abc6) has been reverted at least 5 times; this assertion is
      // the CI tripwire the CLAUDE.md prose warning could never be.
      expect(existsSync(join(__dirname, '..', 'middleware.ts'))).toBe(false)
    })

    it('locks the matcher exclusions (auth, cron, share, telemetry, images, internals)', () => {
      // The matcher regex is declarative config Next evaluates at build time —
      // it can't be exercised through proxy() here, so pin it literally. If
      // this fails, someone changed which surfaces bypass the auth gate:
      // review against the exclusion rationale in src/proxy.ts before updating.
      expect(config.matcher).toEqual([
        '/((?!api/auth|api/cron|api/share|api/telemetry|share|images|_next/static|_next/image|favicon\\.ico|__nextjs).*)',
      ])
    })

    it('short-circuits OPTIONS preflights without reading the session', async () => {
      const request = makeRequest('/api/feed')
      ;(request as { method: string }).method = 'OPTIONS'
      const res = await proxy(request)
      expect(res.status).toBe(200)
      expect(readSessionClaimsMock).not.toHaveBeenCalled()
    })
  })
})
