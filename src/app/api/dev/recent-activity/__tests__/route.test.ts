import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_ACTIVITY_COOKIE } from '@/lib/recent-activity-version'

const fixture = vi.hoisted(() => ({ userId: 'admin' as string | null, readVersion: vi.fn(async () => 'shared') }))
vi.mock('@/server/auth/session', () => ({ getSession: vi.fn(async () => fixture.userId ? { userId: fixture.userId } : null) }))
vi.mock('@/server/auth/admin', () => ({ isAdminUser: (userId: string) => userId === 'admin' }))
vi.mock('@/server/home/recent-activity-version', () => ({ getRecentActivityVersion: fixture.readVersion }))
import { GET, PATCH } from '../route'

const request = (body: unknown) => new Request('http://localhost/api/dev/recent-activity', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => { fixture.userId = 'admin'; fixture.readVersion.mockClear() })

describe('Recent Activity developer preference API', () => {
  it.each([null, 'ordinary-player'])('denies reading or changing developer preferences for %s', async userId => {
    fixture.userId = userId
    expect((await GET()).status).toBe(404)
    const response = await PATCH(request({ version: 'current' }))
    expect(response.status).toBe(404)
    expect(response.cookies.get(RECENT_ACTIVITY_COOKIE)).toBeUndefined()
    expect(fixture.readVersion).not.toHaveBeenCalled()
  })
  it('reads the current account’s saved preference without caching', async () => {
    const response = await GET()
    expect(await response.json()).toEqual({ version: 'shared' })
    expect(fixture.readVersion).toHaveBeenCalledWith('admin')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it.each(['current', 'shared'])('remembers %s only for the signed-in account and this browser', async version => {
    const response = await PATCH(request({ version }))
    expect(await response.json()).toEqual({ version })
    const cookie = response.cookies.get(RECENT_ACTIVITY_COOKIE)!
    expect(JSON.parse(cookie.value)).toEqual({ userId: 'admin', version })
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe('lax')
    expect(cookie.path).toBe('/')
    expect(cookie.maxAge).toBe(30 * 24 * 60 * 60)
  })
  it.each([null, {}, { version: 'invalid' }, { version: 'current', userId: 'other' }])('rejects invalid preference input (%j)', async body => {
    const response = await PATCH(request(body))
    expect(response.status).toBe(400)
    expect(response.cookies.get(RECENT_ACTIVITY_COOKIE)).toBeUndefined()
  })
})
