import { describe, expect, it, vi } from 'vitest'

// canViewSection is pure, but the visibility module imports @/server/db so
// it can also export DB-touching helpers. Stub the db module so importing
// this file in a test env (with no DATABASE_URL) doesn't blow up.
vi.mock('@/server/db', () => ({
  db: {},
  profileSectionVisibility: {
    userId: 'profileSectionVisibility.userId',
    section: 'profileSectionVisibility.section',
    visibility: 'profileSectionVisibility.visibility',
  },
}))

import {
  canViewSection,
  PROFILE_SECTIONS,
  type ProfileSection,
  type SectionVisibility,
} from '@/server/profile/visibility'

function settings(
  overrides: Partial<Record<ProfileSection, SectionVisibility>> = {}
): Record<ProfileSection, SectionVisibility> {
  const base: Record<ProfileSection, SectionVisibility> = {
    bio: 'public',
    tagline: 'public',
    location: 'public',
    knowledge_map: 'public',
    mind_expanding: 'public',
    friends_list: 'friends',
    authored_questions: 'public',
  }
  return { ...base, ...overrides }
}

describe('canViewSection', () => {
  it('always returns true for the owner regardless of section visibility', () => {
    const s = settings({
      bio: 'private',
      tagline: 'friends',
      knowledge_map: 'private',
    })
    for (const section of PROFILE_SECTIONS) {
      expect(canViewSection(s, section, 'self')).toBe(true)
    }
  })

  it('public sections are visible to friends and strangers', () => {
    const s = settings({ bio: 'public' })
    expect(canViewSection(s, 'bio', 'friend')).toBe(true)
    expect(canViewSection(s, 'bio', 'stranger')).toBe(true)
  })

  it('friends-only sections are visible to friends but hidden from strangers', () => {
    const s = settings({ authored_questions: 'friends' })
    expect(canViewSection(s, 'authored_questions', 'friend')).toBe(true)
    expect(canViewSection(s, 'authored_questions', 'stranger')).toBe(false)
  })

  it('private sections are hidden from both friends and strangers', () => {
    const s = settings({ knowledge_map: 'private' })
    expect(canViewSection(s, 'knowledge_map', 'friend')).toBe(false)
    expect(canViewSection(s, 'knowledge_map', 'stranger')).toBe(false)
  })

  it('uses the friends_list default of friends-only when no setting is provided', () => {
    const s = settings()
    expect(canViewSection(s, 'friends_list', 'friend')).toBe(true)
    expect(canViewSection(s, 'friends_list', 'stranger')).toBe(false)
  })
})
