import { sql } from 'drizzle-orm';

import { db, profileSectionVisibility } from '@/server/db';

/**
 * Sections of a user profile whose visibility can be controlled
 * independently. Mirrors the Postgres `ProfileSection` enum defined in
 * `src/server/db/schema.ts` and migration 0054.
 */
export type ProfileSection = 'knowledge_base' | 'friends_list' | 'authored_questions';

export type SectionVisibility = 'public' | 'friends' | 'private';

/**
 * The kind of viewer evaluating a section. `self` is the owner viewing
 * their own profile (or the owner previewing as themselves). `friend`
 * means an active mutual friendship exists. `stranger` is everything
 * else (logged-out, no friendship, pending friendship, etc.).
 */
export type EffectiveViewer = 'self' | 'friend' | 'stranger';

export const PROFILE_SECTIONS: readonly ProfileSection[] = [
  'knowledge_base',
  'friends_list',
  'authored_questions',
] as const;

/**
 * Defaults used when a user has no row in PROFILE_SECTION_VISIBILITY for
 * the given section. Migration 0054 backfills `knowledge_base` from the
 * legacy `knowledge_map` + `mind_expanding` rows; everything else falls
 * back here on first read.
 */
const DEFAULTS: Record<ProfileSection, SectionVisibility> = {
  knowledge_base: 'public',
  // Friends list defaults to friends-only so that a fresh user's social
  // graph isn't exposed before they make a deliberate choice.
  friends_list: 'friends',
  authored_questions: 'public',
};

function isSectionVisibility(value: unknown): value is SectionVisibility {
  return value === 'public' || value === 'friends' || value === 'private';
}

function isProfileSection(value: unknown): value is ProfileSection {
  return value === 'knowledge_base' || value === 'friends_list' || value === 'authored_questions';
}

/**
 * Batch-fetch all of a user's section visibility settings. Returns a
 * fully-populated record — sections without a row use DEFAULTS.
 *
 * Designed to be called ONCE per profile render so that `canViewSection`
 * can be invoked inline (it is pure). Do not call this inside a loop or
 * inside another query helper — pass the result down instead.
 */
export async function getSectionVisibilities(
  userId: string,
): Promise<Record<ProfileSection, SectionVisibility>> {
  const trimmed = userId.trim();
  if (!trimmed) return { ...DEFAULTS };

  const rows = await db
    .select({
      section: profileSectionVisibility.section,
      visibility: profileSectionVisibility.visibility,
    })
    .from(profileSectionVisibility)
    .where(sql`${profileSectionVisibility.userId} = ${trimmed}`);

  const result: Record<ProfileSection, SectionVisibility> = { ...DEFAULTS };
  for (const row of rows) {
    if (!isProfileSection(row.section)) continue;
    if (!isSectionVisibility(row.visibility)) continue;
    result[row.section] = row.visibility;
  }
  return result;
}

/**
 * Pure predicate: given a settings map and an effective viewer, decide
 * whether a section is visible. Does NOT hit the database — callers must
 * resolve the viewer kind themselves (typically by calling `areFriends`
 * once per page and passing the result in).
 *
 * Precedence note: this gate is **strictly additive** with respect to
 * per-domain knowledge visibility (`PROFILE_DOMAIN_VISIBILITY`). When the
 * `knowledge_base` section is visible, per-domain rules still apply to
 * individual domains inside it; when the section is hidden, no domains
 * render regardless of their per-domain settings.
 */
export function canViewSection(
  settings: Record<ProfileSection, SectionVisibility>,
  section: ProfileSection,
  viewer: EffectiveViewer,
): boolean {
  if (viewer === 'self') return true;
  const v = settings[section];
  if (v === 'public') return true;
  if (v === 'friends') return viewer === 'friend';
  return false;
}

/**
 * Upsert a section's visibility. Mirrors `setDomainVisibility` at
 * `src/server/db/queries/knowledge.ts:817-843`.
 *
 * Non-destructive: this only changes how the section renders to other
 * viewers. Underlying data (authored Question rows, friendships,
 * mastery events, etc.) is never modified, so flipping a section back
 * to `public` restores its prior contents exactly.
 */
export async function setSectionVisibility(
  userId: string,
  section: ProfileSection,
  visibility: SectionVisibility,
): Promise<void> {
  const trimmed = userId.trim();
  if (!trimmed) throw new Error('userId is required');
  await db
    .insert(profileSectionVisibility)
    .values({
      userId: trimmed,
      section,
      visibility,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [profileSectionVisibility.userId, profileSectionVisibility.section],
      set: {
        visibility,
        updatedAt: new Date(),
      },
    });
}
