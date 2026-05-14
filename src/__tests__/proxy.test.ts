import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { proxy } from '@/proxy'

function makeRequest(path: string) {
  return new NextRequest(new URL(path, 'https://joshing.test'))
}

describe('proxy unauthenticated route preservation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('passes invite pages through without clearing or rewriting the invite token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ user: null }), { status: 401 })
    )

    const response = await proxy(makeRequest('/invite/keep-this-token'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('location')).toBeNull()
  })

  it('still redirects other unauthenticated pages to login without a stale query', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ user: null }), { status: 401 })
    )

    const response = await proxy(
      makeRequest('/dashboard?invitationToken=drop-me')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://joshing.test/login')
  })
})
