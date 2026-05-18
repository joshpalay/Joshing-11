import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieStoreMock, dbUpdateSpy, selectChainMock } = vi.hoisted(() => {
  const cookieStoreMock = {
    get: vi.fn<(name: string) => { value: string } | undefined>(),
    set: vi.fn(),
    delete: vi.fn(),
  }
  const selectChainMock = vi.fn<() => Promise<Array<{ id: string; expiresAt: Date }>>>(
    async () => [],
  )
  const dbUpdateSpy = vi.fn(async () => undefined)
  return { cookieStoreMock, dbUpdateSpy, selectChainMock }
})

vi.mock('next/headers', () => ({
  cookies: async () => cookieStoreMock,
}))

vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectChainMock(),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => dbUpdateSpy(),
      }),
    }),
    insert: () => ({
      values: async () => undefined,
    }),
    delete: () => ({
      where: async () => undefined,
    }),
  },
  userSessions: {
    id: 'userSessions.id',
    userId: 'userSessions.userId',
    token: 'userSessions.token',
    expiresAt: 'userSessions.expiresAt',
  },
}))

import {
  readSessionClaims,
  refreshSessionOnboardingClaim,
} from '@/server/auth/session'

const SECRET = 'test-secret-for-session-tests'

// Mirror session.ts's getJwtSecret(): a non-empty base64-decodable string is
// used as raw bytes. Buffer.from(_, 'base64') will return a non-empty buffer
// for any non-empty input, so we must decode the same way the module does.
function secretBytes(): Uint8Array {
  const decoded = Buffer.from(SECRET, 'base64')
  if (decoded.length > 0) return new Uint8Array(decoded)
  return new TextEncoder().encode(SECRET)
}

async function mintJwt(opts: {
  sub: string
  sid: string
  inv?: boolean
  onb?: boolean
  expiresIn?: string
}) {
  const payload: Record<string, unknown> = { sid: opts.sid }
  if (opts.inv !== undefined) payload.inv = opts.inv
  if (opts.onb !== undefined) payload.onb = opts.onb
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.sub)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '90d')
    .sign(secretBytes())
}

describe('readSessionClaims', () => {
  const originalSecret = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET
    cookieStoreMock.get.mockReset()
    cookieStoreMock.set.mockReset()
    selectChainMock.mockReset()
    dbUpdateSpy.mockReset()
  })

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret
  })

  it('returns null for an empty token', async () => {
    expect(await readSessionClaims(null)).toBeNull()
    expect(await readSessionClaims('')).toBeNull()
  })

  it('exposes onboardingComplete=true when the JWT carries onb', async () => {
    const token = await mintJwt({ sub: 'u1', sid: 's1', inv: true, onb: true })
    const claims = await readSessionClaims(token)
    expect(claims).toEqual({
      userId: 'u1',
      sessionId: 's1',
      invitationAccepted: true,
      onboardingComplete: true,
    })
  })

  it('defaults onboardingComplete to false when the claim is absent', async () => {
    const token = await mintJwt({ sub: 'u1', sid: 's1', inv: true })
    const claims = await readSessionClaims(token)
    expect(claims?.onboardingComplete).toBe(false)
    expect(claims?.invitationAccepted).toBe(true)
  })

  it('returns null for a tampered token', async () => {
    const claims = await readSessionClaims('not.a.jwt')
    expect(claims).toBeNull()
  })
})

describe('refreshSessionOnboardingClaim', () => {
  const originalSecret = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET
    cookieStoreMock.get.mockReset()
    cookieStoreMock.set.mockReset()
    selectChainMock.mockReset()
    dbUpdateSpy.mockReset()
  })

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret
  })

  it('returns false when there is no session cookie', async () => {
    cookieStoreMock.get.mockReturnValue(undefined)
    expect(await refreshSessionOnboardingClaim()).toBe(false)
    expect(cookieStoreMock.set).not.toHaveBeenCalled()
  })

  it('returns false when the cookie is not a valid JWT', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'garbage' })
    expect(await refreshSessionOnboardingClaim()).toBe(false)
    expect(cookieStoreMock.set).not.toHaveBeenCalled()
  })

  it('returns false when the underlying DB session has expired', async () => {
    const token = await mintJwt({ sub: 'u1', sid: 's1', inv: true })
    cookieStoreMock.get.mockReturnValue({ value: token })
    selectChainMock.mockResolvedValueOnce([
      { id: 'row-1', expiresAt: new Date(Date.now() - 1000) },
    ])
    expect(await refreshSessionOnboardingClaim()).toBe(false)
    expect(cookieStoreMock.set).not.toHaveBeenCalled()
  })

  it('returns false when the DB row is missing', async () => {
    const token = await mintJwt({ sub: 'u1', sid: 's1', inv: true })
    cookieStoreMock.get.mockReturnValue({ value: token })
    selectChainMock.mockResolvedValueOnce([])
    expect(await refreshSessionOnboardingClaim()).toBe(false)
    expect(cookieStoreMock.set).not.toHaveBeenCalled()
  })

  it('re-signs the JWT with onb=true while preserving inv, and resets the cookie', async () => {
    const token = await mintJwt({ sub: 'u1', sid: 's1', inv: true })
    cookieStoreMock.get.mockReturnValue({ value: token })
    selectChainMock.mockResolvedValueOnce([
      { id: 'row-1', expiresAt: new Date(Date.now() + 86_400_000) },
    ])

    expect(await refreshSessionOnboardingClaim()).toBe(true)
    expect(dbUpdateSpy).toHaveBeenCalledTimes(1)
    expect(cookieStoreMock.set).toHaveBeenCalledTimes(1)

    const [name, newToken, opts] = cookieStoreMock.set.mock.calls[0]!
    expect(name).toBe('joshing_session')
    expect(typeof newToken).toBe('string')
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })

    const claims = await readSessionClaims(newToken as string)
    expect(claims?.userId).toBe('u1')
    expect(claims?.sessionId).toBe('s1')
    expect(claims?.invitationAccepted).toBe(true)
    expect(claims?.onboardingComplete).toBe(true)
  })

  it('does not flip inv to true on a legacy (inv=false) session', async () => {
    const token = await mintJwt({ sub: 'u1', sid: 's1' })
    cookieStoreMock.get.mockReturnValue({ value: token })
    selectChainMock.mockResolvedValueOnce([
      { id: 'row-1', expiresAt: new Date(Date.now() + 86_400_000) },
    ])

    expect(await refreshSessionOnboardingClaim()).toBe(true)

    const newToken = cookieStoreMock.set.mock.calls[0]?.[1] as string
    const claims = await readSessionClaims(newToken)
    expect(claims?.invitationAccepted).toBe(false)
    expect(claims?.onboardingComplete).toBe(true)
  })
})
