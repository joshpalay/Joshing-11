import { randomBytes } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import { db, follows, users } from '@/server/db'
import { upsertInvitationFriendship } from '@/server/friends/friendships'

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

  return {
    inviterUserId: row.id,
    inviterHandle: row.handle,
    inviterDisplayName: row.displayName,
    inviterAvatarColor: row.avatarColor,
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
    return { accepted: true }
  } catch {
    return { accepted: false }
  }
}
