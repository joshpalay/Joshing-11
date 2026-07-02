import { and, countDistinct, desc, eq, gte, inArray, isNull, max, min, sql } from 'drizzle-orm';

import { authorInvitations, db, masteryEvents, users } from '@/server/db';

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the manual "invitation to author" state
// (decision 2026-07-01: manual checkbox first; automatic exhaustion signals can
// feed suggestions later, behind the same human flip). An ACTIVE invitation
// (resolvedAt IS NULL) does three jobs:
//   1. lights the player's full-screen completion takeover ONCE (seenAt),
//   2. gates the player's access to the creation surface for that domain,
//   3. records which door they took (doorChoice: author | expand | wait).
// 'domain_exhausted' is the first invitation reason of a couple — keep new
// reasons as data, not new tables. No hard-delete: revoke = resolvedAt stamp.

export type InvitationReason = 'domain_exhausted';
export type DoorChoice = 'author' | 'expand' | 'wait';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

// ─── crafter side (Panel B) ──────────────────────────────────────────────────

export type DomainPlayer = {
  userId: string;
  displayName: string | null;
  lastPlayed: Date | null;
  invited: boolean;
  invitationSeen: boolean;
};

// The players active in a domain over the lookback window, each with their
// invitation state — Panel B's expandable "who's here / who's invited" list.
export async function getDomainPlayersWithInvitationState(
  domain: string,
  opts: { activeLookbackDays?: number } = {},
): Promise<DomainPlayer[]> {
  const lookbackDays = opts.activeLookbackDays ?? 14;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const [players, invitations] = await Promise.all([
    db
      .select({
        userId: masteryEvents.answeredByUserId,
        lastPlayed: max(masteryEvents.createdAt),
        events: countDistinct(masteryEvents.id),
      })
      .from(masteryEvents)
      .where(
        and(
          eq(masteryEvents.canonicalSubcategory, domain),
          gte(masteryEvents.createdAt, since),
        ),
      )
      .groupBy(masteryEvents.answeredByUserId),
    db
      .select({
        userId: authorInvitations.userId,
        seenAt: authorInvitations.seenAt,
      })
      .from(authorInvitations)
      .where(and(eq(authorInvitations.domain, domain), isNull(authorInvitations.resolvedAt))),
  ]);

  const invitationByUser = new Map(invitations.map((row) => [row.userId, row]));
  const playerIds = players.map((p) => p.userId).filter((id): id is string => Boolean(id));
  if (playerIds.length === 0) return [];

  const names = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, playerIds));
  const nameById = new Map(names.map((row) => [row.id, row.displayName]));

  return players
    .filter((p): p is typeof p & { userId: string } => Boolean(p.userId))
    .map((p) => {
      const invitation = invitationByUser.get(p.userId);
      return {
        userId: p.userId,
        displayName: nameById.get(p.userId) ?? null,
        lastPlayed: p.lastPlayed,
        invited: Boolean(invitation),
        invitationSeen: Boolean(invitation?.seenAt),
      };
    })
    .sort((a, b) => (b.lastPlayed?.getTime() ?? 0) - (a.lastPlayed?.getTime() ?? 0));
}

export type InviteResult =
  | { ok: true; action: 'invited' | 'already_invited' | 'revoked' }
  | { ok: false; reason: 'not_found' };

// Flip the checkbox ON: one active invitation per (player, domain) — the
// partial unique index makes a re-flip an idempotent no-op.
export async function inviteToAuthor(params: {
  userId: string;
  domain: string;
  invitedBy: string;
  reason?: InvitationReason;
}): Promise<InviteResult> {
  try {
    await db.insert(authorInvitations).values({
      userId: params.userId,
      domain: params.domain,
      invitedBy: params.invitedBy,
      reason: params.reason ?? 'domain_exhausted',
    });
    return { ok: true, action: 'invited' };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, action: 'already_invited' };
    throw err;
  }
}

// Flip the checkbox OFF: soft-close (resolvedAt), never delete. A no-op when
// nothing is active.
export async function revokeInvitation(userId: string, domain: string): Promise<InviteResult> {
  const updated = await db
    .update(authorInvitations)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(authorInvitations.userId, userId),
        eq(authorInvitations.domain, domain),
        isNull(authorInvitations.resolvedAt),
      ),
    )
    .returning({ id: authorInvitations.id });
  return updated.length > 0 ? { ok: true, action: 'revoked' } : { ok: false, reason: 'not_found' };
}

// ─── player side ─────────────────────────────────────────────────────────────

export type PlayerInvitation = {
  id: string;
  domain: string;
  reason: string;
  seenAt: Date | null;
  doorChoice: string | null;
  createdAt: Date;
};

// The invitation that should take over the screen after the daily: the oldest
// active UNSEEN one (once-then-quiet — a seen invitation never takes over
// again; it stays reachable from quieter surfaces).
export async function getUnseenInvitation(userId: string): Promise<PlayerInvitation | null> {
  const [row] = await db
    .select({
      id: authorInvitations.id,
      domain: authorInvitations.domain,
      reason: authorInvitations.reason,
      seenAt: authorInvitations.seenAt,
      doorChoice: authorInvitations.doorChoice,
      createdAt: authorInvitations.createdAt,
    })
    .from(authorInvitations)
    .where(
      and(
        eq(authorInvitations.userId, userId),
        isNull(authorInvitations.resolvedAt),
        isNull(authorInvitations.seenAt),
      ),
    )
    .orderBy(authorInvitations.createdAt)
    .limit(1);
  return row ?? null;
}

// All active invitations (seen or not) — the quiet, revisitable list.
export async function getActiveInvitations(userId: string): Promise<PlayerInvitation[]> {
  return db
    .select({
      id: authorInvitations.id,
      domain: authorInvitations.domain,
      reason: authorInvitations.reason,
      seenAt: authorInvitations.seenAt,
      doorChoice: authorInvitations.doorChoice,
      createdAt: authorInvitations.createdAt,
    })
    .from(authorInvitations)
    .where(and(eq(authorInvitations.userId, userId), isNull(authorInvitations.resolvedAt)))
    .orderBy(desc(authorInvitations.createdAt));
}

// Gate for the player creation surface: may this player author in this domain?
export async function hasActiveInvitation(userId: string, domain: string): Promise<boolean> {
  const [row] = await db
    .select({ id: authorInvitations.id })
    .from(authorInvitations)
    .where(
      and(
        eq(authorInvitations.userId, userId),
        eq(authorInvitations.domain, domain),
        isNull(authorInvitations.resolvedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// The takeover was shown — never take over again (once-then-quiet).
export async function markInvitationSeen(userId: string, invitationId: string): Promise<void> {
  await db
    .update(authorInvitations)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(authorInvitations.id, invitationId),
        eq(authorInvitations.userId, userId),
        isNull(authorInvitations.seenAt),
      ),
    );
}

export type PlayerDomainReceipts = {
  answered: number;
  correct: number;
  firstPlayed: Date | null;
};

// The evidence behind "you've played through X" — what this player actually did
// in the domain. The completion framing earns its trophy by showing receipts
// ("47 questions since March — 82% right"), not asserting them.
export async function getPlayerDomainReceipts(
  userId: string,
  domain: string,
): Promise<PlayerDomainReceipts> {
  const [row] = await db
    .select({
      answered: sql<number>`count(*)::int`,
      // AnswerState has no bare 'correct' — the three correct variants are
      // first_correct / first_correct_after_wrong / repeat_correct.
      correct: sql<number>`count(*) filter (where ${masteryEvents.answerState} in ('first_correct', 'first_correct_after_wrong', 'repeat_correct'))::int`,
      firstPlayed: min(masteryEvents.createdAt),
    })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.answeredByUserId, userId),
        eq(masteryEvents.canonicalSubcategory, domain),
      ),
    );
  return {
    answered: row?.answered ?? 0,
    correct: row?.correct ?? 0,
    firstPlayed: row?.firstPlayed ?? null,
  };
}

// Record which door the player took. 'wait' is a genuine subscription marker —
// when new questions land in the domain we can honestly say "there's something
// real now"; it carries NO streak/re-engagement machinery by design.
export async function recordDoorChoice(
  userId: string,
  invitationId: string,
  choice: DoorChoice,
): Promise<void> {
  await db
    .update(authorInvitations)
    .set({ doorChoice: choice })
    .where(and(eq(authorInvitations.id, invitationId), eq(authorInvitations.userId, userId)));
}
