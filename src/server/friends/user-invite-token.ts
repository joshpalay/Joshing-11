import { and, eq, sql } from 'drizzle-orm'

import { domainKey } from '@/lib/knowledge/domain-key'
import { db, follows, profileDomainVisibility, users } from '@/server/db'
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests'
import { getDailyPreferences } from '@/server/db/queries/daily-preferences'
import {
  attributeInviteLinkJoin,
  findLiveInviteLinkByToken,
  getJoinedInviteLink,
} from '@/server/db/queries/invite-links'
import { parsePreSeededInterests, type PreSeededInterest } from '@/server/db/queries/users'
import { backfillInviterFeedItems } from '@/server/feed/backfill-inviter-feed'
import { upsertInvitationFriendship } from '@/server/friends/friendships'

export { generateUserInviteToken } from '@/server/db/queries/invite-links'

// Cap applies to both sources: a curated inviteSeedInterests set and the
// automatic fallback below.
const SEED_TOPIC_CAP = 3

// Resolves the topics a per-user invite link carries: whatever the inviter
// curated in users.invite_seed_interests, or — when that's empty — an
// automatic fallback ordered "what they play most first": their declared
// interests set to 'often' frequency (DailyPreference.domainPreferenceFrequency),
// then the rest of their active declared interests in first-picked order.
// The automatic fallback is what makes a link useful on day one with zero
// setup.
//
// `slot` selects what a SPECIFIC link carries: 0 (default) returns the full
// resolved set (untagged links carry all of it); 1-3 returns just the one
// topic at that position, or [] if the inviter doesn't have that many yet —
// a tagged link only ever shows the one topic it was made for.
//
// Unfiltered by profile domain visibility — this is the raw resolution used
// by both the public invite card (resolveInviteLink, which DOES filter before
// exposing it to a not-yet-friend visitor) and onboarding (where the invitee
// is already a mutual-approved friend by the time this is read, so the public
// visibility bar doesn't apply).
export async function getInviteLinkSeedTopics(
  inviterUserId: string,
  slot = 0,
): Promise<PreSeededInterest[]> {
  const [row] = await db
    .select({ inviteSeedInterests: users.inviteSeedInterests })
    .from(users)
    .where(eq(users.id, inviterUserId))
    .limit(1)

  const curated = parsePreSeededInterests(row?.inviteSeedInterests).slice(0, SEED_TOPIC_CAP)
  let resolved = curated

  if (resolved.length === 0) {
    const [declared, dailyPreferences] = await Promise.all([
      getActiveDeclaredInterests(inviterUserId),
      getDailyPreferences(inviterUserId),
    ])
    const often = declared.filter((interest) => dailyPreferences.domainPreferenceFrequency[interest.domain] === 'often')
    const rest = declared.filter((interest) => dailyPreferences.domainPreferenceFrequency[interest.domain] !== 'often')
    resolved = [...often, ...rest].slice(0, SEED_TOPIC_CAP).map((interest) => ({
      label: interest.domain,
      broadCategory: interest.broadCategory,
    }))
  }

  if (slot === 0) return resolved
  const single = resolved[slot - 1]
  return single ? [single] : []
}

// Slot-aware resolution for an already-joined invitee: reads which specific
// link they came through (users.joined_via_invite_link_id) and resolves that
// link's exact topic set. Returns null when there's no attribution at all —
// pre-migration accounts, named-invite joins, or the rare organic mutual
// follow getInviterForUser's fallback window also catches — so the caller can
// fall back to its own unslotted resolution.
export async function getSeedTopicsForJoinedLink(inviteeUserId: string): Promise<PreSeededInterest[] | null> {
  const joined = await getJoinedInviteLink(inviteeUserId)
  if (!joined) return null
  return getInviteLinkSeedTopics(joined.inviterUserId, joined.slot)
}

// The curated set only — no automatic-fallback resolution. This is what the
// topic editor (PrivacyForm, and the Friends page's link-creation panel)
// shows and edits; it must read back "nothing curated" as empty, not
// silently pre-fill the inviter's declared interests as though they were a
// saved choice (that fallback is invisible/implicit by design).
export async function getCuratedInviteSeedTopics(userId: string): Promise<string[]> {
  const [row] = await db
    .select({ inviteSeedInterests: users.inviteSeedInterests })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return parsePreSeededInterests(row?.inviteSeedInterests)
    .slice(0, SEED_TOPIC_CAP)
    .map((interest) => interest.label)
}

// Overwrites the curated set. Callers are responsible for validating each
// topic (e.g. isTooBroadInterest) before calling this — it trusts its input
// and just cleans/caps/persists. An empty array clears the curated set,
// reverting the link to the automatic fallback.
export async function setCuratedInviteSeedTopics(userId: string, topics: string[]): Promise<void> {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of topics) {
    const topic = raw.trim()
    if (!topic) continue
    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(topic)
    if (cleaned.length === SEED_TOPIC_CAP) break
  }

  await db
    .update(users)
    .set({
      inviteSeedInterests: cleaned.map((label) => ({ label })),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
}

// The bar for a visitor who is not yet a friend of the inviter: PUBLIC and
// visible, full stop. Deliberately stricter than knowledge.ts's
// getHiddenDomainKeys (which only excludes 'private'/isVisible=false and is
// used for contexts where the viewer already clears a lower bar) — a random
// visitor of an evergreen link posted in a bio has cleared no bar at all.
// Absence of a PROFILE_DOMAIN_VISIBILITY row means the schema default
// (public, visible), so only rows that exist AND fail the public+visible
// check count as hidden.
async function getPubliclyHiddenDomainKeys(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      domain: profileDomainVisibility.domain,
      canonicalSubcategory: profileDomainVisibility.canonicalSubcategory,
      visibility: profileDomainVisibility.visibility,
      isVisible: profileDomainVisibility.isVisible,
    })
    .from(profileDomainVisibility)
    .where(eq(profileDomainVisibility.userId, userId))

  const hidden = new Set<string>()
  for (const row of rows) {
    if (row.visibility === 'public' && row.isVisible) continue
    const label = row.domain ?? row.canonicalSubcategory
    if (label) hidden.add(domainKey(label))
  }
  return hidden
}

// Lifted from src/app/api/friend-invitations/route.ts:158-173 so invite-link
// URLs use the same base-resolution as SMS invitation URLs. Accepts either
// a Request (route handlers) or a Headers map (server components reading
// via next/headers).
export function getBaseUrl(source?: Request | Headers): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  if (configured) return configured.replace(/\/$/, '')

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercelProd) return `https://${vercelProd.replace(/\/$/, '')}`

  if (source) {
    const headers = source instanceof Request ? source.headers : source
    const host = headers.get('x-forwarded-host') ?? headers.get('host')
    const protocol = headers.get('x-forwarded-proto') ?? 'https'
    if (host) return `${protocol}://${host}`
    if (source instanceof Request) return new URL(source.url).origin
  }

  return 'http://localhost:3000'
}

export function buildInviteUrl(baseUrl: string, handle: string, token: string): string {
  // Per-user invite URL — see src/app/u/[handle]/[token]/page.tsx for the
  // route handler and why this isn't under /invite/.
  return `${baseUrl}/u/${encodeURIComponent(handle)}/${encodeURIComponent(token)}`
}

// Resolves /u/<handle>/<token>: looks up the inviter case-insensitively on
// handle, then the specific LIVE UserInviteLink matching that user + token.
// Returns null when the handle doesn't resolve, the link doesn't exist,
// belongs to someone else, or was deleted (don't reveal which).
export type InviteLinkResolution = {
  inviterUserId: string
  inviterHandle: string
  inviterDisplayName: string | null
  inviterAvatarColor: string | null
  linkId: string
  slot: number
  // The topics THIS link carries — all of the inviter's resolved set for an
  // untagged (slot 0) link, or just the one tagged topic — already filtered
  // to what a not-yet-friend visitor may see (getPubliclyHiddenDomainKeys).
  seedTopics: string[]
}

export async function resolveInviteLink(handle: string, token: string): Promise<InviteLinkResolution | null> {
  const [row] = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      avatarColor: users.avatarColor,
    })
    .from(users)
    .where(sql`LOWER(${users.handle}) = LOWER(${handle})`)
    .limit(1)

  if (!row || !row.handle) return null

  const link = await findLiveInviteLinkByToken(row.id, token)
  if (!link) return null

  const [topics, hiddenDomainKeys] = await Promise.all([
    getInviteLinkSeedTopics(row.id, link.slot),
    getPubliclyHiddenDomainKeys(row.id),
  ])
  const seedTopics = topics
    .filter((topic) => !hiddenDomainKeys.has(domainKey(topic.label)))
    .map((topic) => topic.label)

  return {
    inviterUserId: row.id,
    inviterHandle: row.handle,
    inviterDisplayName: row.displayName,
    inviterAvatarColor: row.avatarColor,
    linkId: link.id,
    slot: link.slot,
    seedTopics,
  }
}

// True when someone follows `userId` on an approved edge — the footprint left
// by upsertInvitationFriendship when a per-user invite link is accepted (it
// creates a mutual approved follow but NO FriendInvitation row). The onboarding
// route uses this as a second invite-provenance signal so users who arrived via
// /u/<handle>/<token> aren't bounced back to /login (which loops through the
// onboarding-claim refresh). A brand-new user reaching onboarding can only have
// an approved follower through an accepted invitation, so this is a safe gate.
export async function hasInviteLinkFriendship(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followeeId, userId), eq(follows.state, 'approved')))
    .limit(1)

  return Boolean(row)
}

// Called from verify-otp when the user arrives via /u/<handle>/<token>.
// Validates server-side, creates an active Friendship via the existing
// upsertInvitationFriendship helper, and attributes the join to the specific
// link clicked. Silent failure on the friendship itself (don't block login on
// any error path — the worst case is the user logs in without the new
// friendship, which they can fix by tapping Add Friend on the inviter's
// profile). Attribution is best-effort on top of that: a failure there must
// never undo an otherwise-successful accept.
export async function acceptUserInviteLink({
  handle,
  token,
  inviteeUserId,
  now = new Date(),
}: {
  handle: string
  token: string
  inviteeUserId: string
  now?: Date
}): Promise<{ accepted: boolean }> {
  const inviter = await resolveInviteLink(handle, token)
  if (!inviter) return { accepted: false }
  if (inviter.inviterUserId === inviteeUserId) return { accepted: false }

  try {
    await upsertInvitationFriendship(db, {
      inviterUserId: inviter.inviterUserId,
      inviteeUserId,
      formedAt: now,
    })
    // One-time inviter feed backfill (B-HomeSeed-1). Best-effort internally so
    // it can't throw — a backfill hiccup must never fail the link acceptance.
    await backfillInviterFeedItems({
      inviterUserId: inviter.inviterUserId,
      inviteeUserId,
    })
    try {
      await attributeInviteLinkJoin(inviteeUserId, inviter.linkId)
    } catch {
      // Attribution is a nice-to-have (join counts, Suggested-friends
      // provenance) — never worth failing an otherwise-successful accept.
    }
    return { accepted: true }
  } catch {
    return { accepted: false }
  }
}
