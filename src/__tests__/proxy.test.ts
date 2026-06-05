import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readSessionClaimsMock } = vi.hoisted(() => ({
  readSessionClaimsMock: vi.fn(),
}))

vi.mock('@/server/auth/session', () => ({
  readSessionClaims: readSessionClaimsMock,
}))

import { proxy } from '@/proxy'

function makeRequest(path: string) {
  return new NextRequest(new URL(path, 'https://joshing.test'))
}

describe('proxy unauthenticated route preservation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    readSessionClaimsMock.mockReset()
  })

  it('passes invite pages through without clearing or rewriting the invite token', async () => {
    readSessionClaimsMock.mockResolvedValueOnce(null)

    const response = await proxy(makeRequest('/invite/keep-this-token'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('location')).toBeNull()
  })

  it('passes the per-user invite landing (/u/<handle>/<token>) through logged-out so the invite params survive to /login', async () => {
    readSessionClaimsMock.mockResolvedValueOnce(null)

    const response = await proxy(makeRequest('/u/josh/keep-this-token'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects other unauthenticated pages to login, preserving the original path via next', async () => {
    readSessionClaimsMock.mockResolvedValueOnce(null)

    const response = await proxy(
      makeRequest('/dashboard?invitationToken=drop-me'),
    )

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('https://joshing.test/login')
    expect(location).toContain('next=')
  })
})
