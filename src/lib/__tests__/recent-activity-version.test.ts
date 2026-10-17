import { describe, expect, it } from 'vitest'
import { resolveRecentActivityVersion } from '@/lib/recent-activity-version'

const saved = (userId: string, version: string) => JSON.stringify({ userId, version })
describe('Recent Activity browser preference', () => {
  it('defaults to the new version and remembers either choice for the same account', () => {
    expect(resolveRecentActivityVersion('me', undefined)).toBe('shared')
    expect(resolveRecentActivityVersion('me', saved('me', 'current'))).toBe('current')
    expect(resolveRecentActivityVersion('me', saved('me', 'shared'))).toBe('shared')
  })
  it('does not carry a preference across accounts or accept corrupt cookies', () => {
    for (const value of [saved('other', 'current'), saved('me', 'invalid'), 'bad-json', 'null', '[]']) {
      expect(resolveRecentActivityVersion('me', value)).toBe('shared')
    }
    expect(resolveRecentActivityVersion(null, saved('me', 'current'))).toBe('shared')
  })
  it('retains explicit developer preview links without saving them', () => {
    expect(resolveRecentActivityVersion('me', saved('me', 'current'), 'shared')).toBe('shared')
    expect(resolveRecentActivityVersion('me', saved('me', 'shared'), 'current')).toBe('current')
    expect(resolveRecentActivityVersion('me', saved('me', 'current'), ['shared'])).toBe('current')
    expect(resolveRecentActivityVersion('me', saved('me', 'current'), 'invalid')).toBe('current')
  })
})
