import { describe, expect, it, vi } from 'vitest';

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
}));

import {
  canViewSection,
  PROFILE_SECTIONS,
  type ProfileSection,
  type SectionVisibility,
} from '@/server/profile/visibility';

function settings(
  overrides: Partial<Record<ProfileSection, SectionVisibility>> = {},
): Record<ProfileSection, SectionVisibility> {
  const base: Record<ProfileSection, SectionVisibility> = {
    knowledge_base: 'public',
    friends_list: 'friends',
    authored_questions: 'public',
  };
  return { ...base, ...overrides };
}

describe('canViewSection', () => {
  it('always returns true for the owner regardless of section visibility', () => {
    const s = settings({
      knowledge_base: 'private',
      authored_questions: 'private',
    });
    for (const section of PROFILE_SECTIONS) {
      expect(canViewSection(s, section, 'self')).toBe(true);
    }
  });

  it('public sections are visible to friends and strangers', () => {
    const s = settings({ knowledge_base: 'public' });
    expect(canViewSection(s, 'knowledge_base', 'friend')).toBe(true);
    expect(canViewSection(s, 'knowledge_base', 'stranger')).toBe(true);
  });

  it('friends-only sections are visible to friends but hidden from strangers', () => {
    const s = settings({ authored_questions: 'friends' });
    expect(canViewSection(s, 'authored_questions', 'friend')).toBe(true);
    expect(canViewSection(s, 'authored_questions', 'stranger')).toBe(false);
  });

  it('private sections are hidden from both friends and strangers', () => {
    const s = settings({ knowledge_base: 'private' });
    expect(canViewSection(s, 'knowledge_base', 'friend')).toBe(false);
    expect(canViewSection(s, 'knowledge_base', 'stranger')).toBe(false);
  });

  it('uses the friends_list default of friends-only when no setting is provided', () => {
    const s = settings();
    expect(canViewSection(s, 'friends_list', 'friend')).toBe(true);
    expect(canViewSection(s, 'friends_list', 'stranger')).toBe(false);
  });
});
