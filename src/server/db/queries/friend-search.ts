import { eq, sql } from 'drizzle-orm'

import { isUsPhoneNumber, normalizePhone } from '@/server/auth'
import { db, users } from '@/server/db'
import { getRelationship, type RelationshipResult } from '@/server/db/queries/friend-requests'

export type FriendSearchMatch = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  createdAt: Date
  relationship: RelationshipResult
}

// Mirrors the registration format in src/server/lib/handle-validation.ts:58
// (leading letter required). The looser /^@?[a-z0-9_]{3,20}$/i pattern used
// to swallow bare 10-digit phone searches like "7346578284", which then
// missed the phone branch below and silently returned no match.
const HANDLE_QUERY_PATTERN = /^@?[a-z][a-z0-9_]{2,19}$/i

function stripAtSign(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value
}

// Exact-match only — no partial leakage. Handle is case-insensitive,
// phone is normalized to US E.164 before matching. Returns null when no
// match OR when the matched user has soft-removed the viewer (block
// detection via getRelationship.isBlocked).
export async function searchFriendByHandleOrPhone(
  viewerId: string,
  query: string,
): Promise<FriendSearchMatch | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  let candidate: {
    id: string
    handle: string | null
    displayName: string | null
    avatarColor: string | null
    createdAt: Date
  } | null = null

  if (HANDLE_QUERY_PATTERN.test(trimmed)) {
    const bareHandle = stripAtSign(trimmed)
    const [row] = await db
      .select({
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarColor: users.avatarColor,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(sql`LOWER(${users.handle}) = LOWER(${bareHandle})`)
      .limit(1)
    candidate = row ?? null
  } else if (isUsPhoneNumber(trimmed)) {
    const normalized = normalizePhone(trimmed)
    const [row] = await db
      .select({
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarColor: users.avatarColor,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.phoneNumber, normalized))
      .limit(1)
    candidate = row ?? null
  }

  if (!candidate) return null
  // Self-match returns null (don't surface the viewer's own profile).
  if (candidate.id === viewerId) return null

  const relationship = await getRelationship(viewerId, candidate.id)
  if (relationship.isBlocked) return null

  return { ...candidate, relationship }
}
