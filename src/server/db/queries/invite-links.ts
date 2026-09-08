import { randomBytes } from 'node:crypto';

import { and, count, eq, isNull } from 'drizzle-orm';

import { db, userInviteLinks, users } from '@/server/db';
import {
  sanitizeInviteLinkCategories,
  sanitizeInviteLinkTitle,
  type InviteLinkCategory,
} from '@/lib/invite-links';

// B-FRIENDS-INVITE-LINKS-01 — up to 3 named links per user, replacing the
// single evergreen users.invite_token. See the comment on userInviteLinks in
// schema.ts for the slot model (0 = untagged, 1-3 = a specific standing
// topic slot).
export const MAX_LIVE_INVITE_LINKS = 3;

// Same primitive as the pre-existing FriendInvitation tokens
// (src/server/friends/invitations.ts) and the single-token model this
// replaces: randomBytes(32).toString('base64url') yields a 43-char
// URL-safe string.
export function generateUserInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export type InviteLinkRow = {
  id: string;
  token: string;
  slot: number;
  /** null means the link predates editable titles. */
  title: string | null;
  /** null means a legacy slot-based link; [] means stored legacy junk was filtered. */
  categories: InviteLinkCategory[] | null;
  createdAt: Date;
  joinedCount: number;
};

// Live (non-deleted) links for a user, oldest first — slot 0 (untagged) may
// repeat; slots 1-3 cannot, enforced by UserInviteLink_user_id_slot_live_key.
export async function listLiveInviteLinks(userId: string): Promise<InviteLinkRow[]> {
  const rows = await db
    .select({
      id: userInviteLinks.id,
      token: userInviteLinks.token,
      slot: userInviteLinks.slot,
      title: userInviteLinks.title,
      categories: userInviteLinks.categories,
      createdAt: userInviteLinks.createdAt,
      joinedCount: count(users.id),
    })
    .from(userInviteLinks)
    .leftJoin(users, eq(users.joinedViaInviteLinkId, userInviteLinks.id))
    .where(and(eq(userInviteLinks.userId, userId), isNull(userInviteLinks.deletedAt)))
    .groupBy(userInviteLinks.id)
    .orderBy(userInviteLinks.createdAt);

  return rows.map((row) => ({
    ...row,
    categories: row.categories === null ? null : sanitizeInviteLinkCategories(row.categories),
  }));
}

export type CreateInviteLinkResult =
  | { ok: true; link: InviteLinkRow }
  | { ok: false; error: 'limit_reached' | 'invalid_categories' | 'invalid_title' };

// New links own an exact category set. We still allocate one of slots 1–3 as a
// concurrency-safe active-link position: the existing partial unique index
// makes two simultaneous creators race for the same free position instead of
// silently creating a fourth link. The categories themselves no longer depend
// on what occupies the creator's legacy global topic slot.
export async function createInviteLink(
  userId: string,
  inputTitle: unknown,
  inputCategories: unknown,
): Promise<CreateInviteLinkResult> {
  const title = sanitizeInviteLinkTitle(inputTitle);
  if (!title) return { ok: false, error: 'invalid_title' };
  const categories = sanitizeInviteLinkCategories(inputCategories);
  if (categories.length === 0) return { ok: false, error: 'invalid_categories' };

  const live = await listLiveInviteLinks(userId);
  if (live.length >= MAX_LIVE_INVITE_LINKS) return { ok: false, error: 'limit_reached' };
  const allocatedSlot = [1, 2, 3].find((slot) => !live.some((link) => link.slot === slot));
  if (!allocatedSlot) return { ok: false, error: 'limit_reached' };

  const token = generateUserInviteToken();
  try {
    const [row] = await db
      .insert(userInviteLinks)
      .values({ userId, token, slot: allocatedSlot, title, categories })
      .returning({
        id: userInviteLinks.id,
        token: userInviteLinks.token,
        slot: userInviteLinks.slot,
        title: userInviteLinks.title,
        categories: userInviteLinks.categories,
        createdAt: userInviteLinks.createdAt,
      });

    if (!row) return { ok: false, error: 'limit_reached' };
    return {
      ok: true,
      link: {
        ...row,
        categories: sanitizeInviteLinkCategories(row.categories),
        joinedCount: 0,
      },
    };
  } catch {
    // A concurrent request can race the app-layer live-link cap. Keep the
    // public error bounded and actionable rather than leaking a DB failure.
    return { ok: false, error: 'limit_reached' };
  }
}

export type UpdateInviteLinkResult =
  | { ok: true; title: string; categories: InviteLinkCategory[] }
  | { ok: false; error: 'invalid_categories' | 'invalid_title' | 'not_found' };

export async function updateInviteLink(
  userId: string,
  linkId: string,
  inputTitle: unknown,
  inputCategories: unknown,
): Promise<UpdateInviteLinkResult> {
  const title = sanitizeInviteLinkTitle(inputTitle);
  if (!title) return { ok: false, error: 'invalid_title' };
  const categories = sanitizeInviteLinkCategories(inputCategories);
  if (categories.length === 0) return { ok: false, error: 'invalid_categories' };

  const [row] = await db
    .update(userInviteLinks)
    .set({ title, categories })
    .where(
      and(
        eq(userInviteLinks.id, linkId),
        eq(userInviteLinks.userId, userId),
        isNull(userInviteLinks.deletedAt),
      ),
    )
    .returning({ title: userInviteLinks.title, categories: userInviteLinks.categories });

  if (!row) return { ok: false, error: 'not_found' };
  return {
    ok: true,
    title: sanitizeInviteLinkTitle(row.title),
    categories: sanitizeInviteLinkCategories(row.categories),
  };
}

// Soft-deletes a live link the caller owns. No-op (returns false) if the link
// doesn't exist, isn't theirs, or is already deleted — callers treat false as
// "nothing to do" rather than an error, since a double-delete from a slow
// network retry shouldn't surface as a failure.
export async function softDeleteInviteLink(userId: string, linkId: string): Promise<boolean> {
  const result = await db
    .update(userInviteLinks)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(userInviteLinks.id, linkId),
        eq(userInviteLinks.userId, userId),
        isNull(userInviteLinks.deletedAt),
      ),
    )
    .returning({ id: userInviteLinks.id });

  return result.length > 0;
}

export type LiveInviteLinkLookup = {
  id: string;
  userId: string;
  slot: number;
  categories: InviteLinkCategory[] | null;
};

// The /u/<handle>/<token> and accept-time resolution primitive: the specific
// LIVE link for this user+token pair, or null if it doesn't exist, belongs to
// someone else, or was deleted. Handle is matched by the caller (via a lookup
// on users.handle) before this is reached; the userId here is the
// authoritative check paired with the token.
export async function findLiveInviteLinkByToken(
  userId: string,
  token: string,
): Promise<LiveInviteLinkLookup | null> {
  const [row] = await db
    .select({
      id: userInviteLinks.id,
      userId: userInviteLinks.userId,
      slot: userInviteLinks.slot,
      categories: userInviteLinks.categories,
    })
    .from(userInviteLinks)
    .where(
      and(
        eq(userInviteLinks.userId, userId),
        eq(userInviteLinks.token, token),
        isNull(userInviteLinks.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    categories: row.categories === null ? null : sanitizeInviteLinkCategories(row.categories),
  };
}

// Records which link an invitee joined through. Called once, at accept time
// (acceptUserInviteLink) — never overwritten afterward, so it survives the
// link being later deleted (the row stays; only deletedAt is set) and stays
// meaningful even if the inviter's topics change under the slot later.
export async function attributeInviteLinkJoin(
  inviteeUserId: string,
  linkId: string,
): Promise<void> {
  await db
    .update(users)
    .set({ joinedViaInviteLinkId: linkId })
    .where(and(eq(users.id, inviteeUserId), isNull(users.joinedViaInviteLinkId)));
}

export type JoinedLinkInfo = {
  inviterUserId: string;
  slot: number;
  categories: InviteLinkCategory[] | null;
};

// The link a user joined through, if any and if attributed. NULL for anyone
// who joined before this table existed, joined via the named FriendInvitation
// path, or (rarely) formed a mutual follow within the getInviterForUser
// fallback window without going through a link at all — callers fall back to
// the unslotted "all curated/declared topics" resolution in that case.
export async function getJoinedInviteLink(inviteeUserId: string): Promise<JoinedLinkInfo | null> {
  const [row] = await db
    .select({
      userId: userInviteLinks.userId,
      slot: userInviteLinks.slot,
      categories: userInviteLinks.categories,
    })
    .from(users)
    .innerJoin(userInviteLinks, eq(userInviteLinks.id, users.joinedViaInviteLinkId))
    .where(eq(users.id, inviteeUserId))
    .limit(1);

  return row
    ? {
        inviterUserId: row.userId,
        slot: row.slot,
        categories: row.categories === null ? null : sanitizeInviteLinkCategories(row.categories),
      }
    : null;
}
