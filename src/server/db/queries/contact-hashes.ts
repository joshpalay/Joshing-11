import { and, count, desc, eq, gt, ne, sql } from 'drizzle-orm'

import { contactHashes, db, friendInvitations, users } from '@/server/db'
import { getRelationships, type RelationshipResult } from '@/server/db/queries/friend-requests'

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Count of other users who (a) have uploaded a ContactHash that matches the
// caller's phoneHash AND (b) are discoverableByContacts. Used by the upload
// endpoint to return a preview after the user uploads their own hashes.
export async function countMatchableUsers(callerId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .innerJoin(contactHashes, eq(contactHashes.phoneHash, users.phoneHash))
    .where(
      and(
        eq(contactHashes.userId, callerId),
        ne(users.id, callerId),
        eq(users.discoverableByContacts, true),
      ),
    )

  return row?.value ?? 0
}

export type ContactMatch = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  createdAt: Date
  relationship: RelationshipResult
}

// Users whose phoneHash equals one of the caller's uploaded ContactHash rows
// AND who have opted into contact-based discovery. Block detection (via
// getRelationships.isBlocked) silently filters anyone who has soft-removed
// the caller.
export async function listContactMatches(callerId: string): Promise<ContactMatch[]> {
  const rows = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      avatarColor: users.avatarColor,
      createdAt: users.createdAt,
    })
    .from(contactHashes)
    .innerJoin(users, eq(users.phoneHash, contactHashes.phoneHash))
    .where(
      and(
        eq(contactHashes.userId, callerId),
        ne(users.id, callerId),
        eq(users.discoverableByContacts, true),
      ),
    )
    .orderBy(desc(users.createdAt))

  if (rows.length === 0) return []

  const relationships = await getRelationships(callerId, rows.map((r) => r.id))

  const result: ContactMatch[] = []
  for (const row of rows) {
    const relationship = relationships.get(row.id)
    if (!relationship || relationship.isBlocked) continue
    result.push({ ...row, relationship })
  }
  return result
}

// MAX(uploadedAt) for the caller's ContactHash rows. NULL when they've never
// uploaded. Used to drive the weekly "Refresh contact matches?" prompt.
export async function getLastContactHashUpload(callerId: string): Promise<Date | null> {
  const [row] = await db
    .select({ uploadedAt: sql<Date>`MAX(${contactHashes.uploadedAt})`.as('uploaded_at') })
    .from(contactHashes)
    .where(eq(contactHashes.userId, callerId))

  if (!row?.uploadedAt) return null
  return row.uploadedAt instanceof Date ? row.uploadedAt : new Date(row.uploadedAt)
}

// "Has anything new happened in the discovery space since this user last
// checked Find Friends?" Two sources:
//   • A contact-match user joined since lastFriendDiscoveryCheckAt AND no
//     active/pending Friendship exists with the caller.
//   • An SMS-invite reflection: someone the caller invited has joined since
//     the threshold and there's no active/pending Friendship.
//
// The threshold is users.last_friend_discovery_check_at. NULL is treated as
// "show everything" — the user has never visited Find Friends so every
// reachable discovery row is "new".
//
// Result is opaque to callers: `{ hasNew, count }` only. No row data is
// surfaced from this helper; the actual rendering pulls fresh data via
// listContactMatches / listInviteReflections.
export type NewDiscoveryStatus = { hasNew: boolean; count: number }

export async function getNewDiscoveryStatus(callerId: string): Promise<NewDiscoveryStatus> {
  const [thresholdRow] = await db
    .select({ threshold: users.lastFriendDiscoveryCheckAt })
    .from(users)
    .where(eq(users.id, callerId))
    .limit(1)

  if (!thresholdRow) return { hasNew: false, count: 0 }
  const threshold = thresholdRow.threshold ?? new Date(0)

  // Friend-pair filter: "no active or pending Friendship between caller and X".
  // Reused for both halves.
  const noFriendshipExists = (otherId: typeof users.id) => sql`NOT EXISTS (
    SELECT 1 FROM "Friendship" f
    WHERE f."status" IN ('active', 'pending')
      AND (
        (f."userAId" = ${callerId} AND f."userBId" = ${otherId})
        OR (f."userAId" = ${otherId} AND f."userBId" = ${callerId})
      )
  )`

  // Contact-hash matches who joined since the threshold.
  const contactMatchRows = await db
    .select({ id: users.id })
    .from(contactHashes)
    .innerJoin(users, eq(users.phoneHash, contactHashes.phoneHash))
    .where(
      and(
        eq(contactHashes.userId, callerId),
        ne(users.id, callerId),
        eq(users.discoverableByContacts, true),
        gt(users.createdAt, threshold),
        noFriendshipExists(users.id),
      ),
    )

  // SMS-invite reflections — users the caller invited who joined since the
  // threshold AND aren't already friends/pending.
  const reflectionRows = await db
    .select({ id: users.id })
    .from(friendInvitations)
    .innerJoin(users, eq(users.id, friendInvitations.inviteeUserId))
    .where(
      and(
        eq(friendInvitations.inviterUserId, callerId),
        gt(users.createdAt, threshold),
        noFriendshipExists(users.id),
      ),
    )

  // Dedupe — a single user could be both a contact match AND an invite
  // reflection. Both are valid signals but they shouldn't double-count.
  const ids = new Set<string>()
  for (const row of contactMatchRows) ids.add(row.id)
  for (const row of reflectionRows) ids.add(row.id)

  return { hasNew: ids.size > 0, count: ids.size }
}

// Stamp NOW() onto users.last_friend_discovery_check_at. Called on every
// visit to /friends/find. Idempotent.
export async function markDiscoveryChecked(callerId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(users)
    .set({ lastFriendDiscoveryCheckAt: now })
    .where(eq(users.id, callerId))
}

export function isRefreshDue(lastUploadedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastUploadedAt) return true
  return now.getTime() - lastUploadedAt.getTime() > ONE_WEEK_MS
}

// Replaces all ContactHash rows for a user in one transaction. Returns the
// count uploaded and a preview of how many of those resolve to a
// discoverable user.
export async function replaceContactHashes(callerId: string, hashes: string[]): Promise<{ uploaded: number; matchCount: number }> {
  await db.transaction(async (tx) => {
    await tx.delete(contactHashes).where(eq(contactHashes.userId, callerId))
    if (hashes.length > 0) {
      await tx
        .insert(contactHashes)
        .values(hashes.map((phoneHash) => ({ userId: callerId, phoneHash })))
        .onConflictDoNothing()
    }
  })

  const matchCount = hashes.length === 0 ? 0 : await countMatchableUsers(callerId)
  return { uploaded: hashes.length, matchCount }
}

export async function clearContactHashes(callerId: string): Promise<void> {
  await db.delete(contactHashes).where(eq(contactHashes.userId, callerId))
}

// Re-export so callers don't need a second import path.
export { contactHashes }
