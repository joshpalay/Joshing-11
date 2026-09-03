import { randomBytes } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import { domainKey } from '@/lib/knowledge/domain-key'
import { db, follows, profileDomainVisibility, users } from '@/server/db'
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests'
import { parsePreSeededInterests, type PreSeededInterest } from '@/server/db/queries/users'
import { backfillInviterFeedItems } from '@/server/feed/backfill-inviter-feed'
import { upsertInvitationFriendship } from '@/server/friends/friendships'

// Cap applies to both sources: a curated inviteSeedInterests set and the
// automatic declared-interests fallback.
const SEED_TOPIC_CAP = 3

// Resolves the topics a per-user invite link carries: whatever the inviter
// curated in users.invite_seed_interests, or — when that's empty — their top
// SEED_TOPIC_CAP active declared interests (already first-picked-first
// ordered by getActiveDeclaredInterests, so slicing keeps that order). The
// automatic fallback is what makes a link useful on day one with zero setup.
//
// Unfiltered by profile domain visibility — this is the raw resolution used
// by both the public invite card (resolveInviteLink, which DOES filter before
// exposing it to a not-yet-friend visitor) and onboarding (where the invitee
// is already a mutual-approved friend by the time this is read, so the public
// visibility bar doesn't apply).
export async function getInviteLinkSeedTopics(inviterUserId: string): Promise<PreSeededInterest[]> {
  const [row] = await db
    .select({ inviteSeedInterests: users.inviteSeedInterests })
    .from(users)
    .where(eq(users.id, inviterUserId))
    .limit(1)

  const curated = parsePreSeededInterests(row?.inviteSeedInterests).slice(0, SEED_TOPIC_CAP)
  if (curated.length > 0) return curated

  const declared = await getActiveDeclaredInterests(inviterUserId)
  return declared.slice(0, SEED_TOPIC_CAP).map((interest) => ({
    label: interest.domain,
    broadCategory: interest.broadCategory,
  }))
}

// The curated set only — no automatic-fallback resolution. This is what the
// PrivacyForm editor shows and edits; it must read back "nothing curated" as
// empty, not silently pre-fill the inviter's declared interests as though
// they were a saved choice (that fallback is invisible/implicit by design).
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
// reverting the link to the automatic declared-interests fallback.
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

// Match the prior-art token primitive used for FriendInvitation tokens at
// src/server/friends/invitations.ts:166 — randomBytes(32).toString('base64url')
// yields a 43-char URL-safe string.
export function generateUserInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export type UserInviteTokenResult = {
  token: string
  handle: string | null
}

// Returns the user's invite token, generating + persisting one if NULL.
// Handle may be null for pre-handle accounts (shouldn't happen post-P0-A
// rollout, but be defensive — callers that need to build a URL should
// surface a "set a handle first" error in that case).
export async function getOrCreateInviteToken(userId: string): Promise<UserInviteTokenResult | null> {
  const [row] = await db
    .select({ inviteToken: users.inviteToken, handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!row) return null
  if (row.inviteToken) return { token: row.inviteToken, handle: row.handle }

  const token = generateUserInviteToken()
  await db
    .update(users)
    .set({ inviteToken: token, updatedAt: new Date() })
    .where(eq(users.id, userId))

  return { token, handle: row.handle }
}

// Always regenerates + persists. The old token, if any, stops resolving
// immediately — /u/<handle>/<old-token> returns 404.
export async function rotateInviteToken(userId: string): Promise<UserInviteTokenResult | null> {
  const [row] = await db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!row) return null

  const token = generateUserInviteToken()
  await db
    .update(users)
    .set({ inviteToken: token, updatedAt: new Date() })
    .where(eq(users.id, userId))

  return { token, handle: row.handle }
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

// Resolves /u/<handle>/<token> by looking up the inviter case-insensitively
// on handle and verifying the token matches exactly.
// Returns null when not found OR mismatched (don't reveal which).
export type InviteLinkResolution = {
  inviterUserId: string
  inviterHandle: string
  inviterDisplayName: string | null
  inviterAvatarColor: string | null
  // Up to 3 topic labels, already filtered to what a not-yet-friend visitor
  // may see (getPubliclyHiddenDomainKeys). Empty when the inviter has no
  // curated set AND no declared interests.
  seedTopics: string[]
}

export async function resolveInviteLink(handle: string, token: string): Promise<InviteLinkResolution | null> {
  const [row] = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      avatarColor: users.avatarColor,
      inviteToken: users.inviteToken,
    })
    .from(users)
    .where(sql`LOWER(${users.handle}) = LOWER(${handle})`)
    .limit(1)

  if (!row || !row.handle || !row.inviteToken) return null
  if (row.inviteToken !== token) return null

  const [topics, hiddenDomainKeys] = await Promise.all([
    getInviteLinkSeedTopics(row.id),
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
// Validates server-side and creates an active Friendship via the existing
// upsertInvitationFriendship helper. Silent failure (don't block login on
// any error path — the worst case is the user logs in without the new
// friendship, which they can fix by tapping Add Friend on the inviter's
// profile).
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
    return { accepted: true }
  } catch {
    return { accepted: false }
  }
}
