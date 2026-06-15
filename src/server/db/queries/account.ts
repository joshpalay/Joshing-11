import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import {
  contactHashes,
  db,
  users,
} from '@/server/db';

export type UserProfile = {
  id: string;
  displayName: string;
  handle: string | null;
  phoneNumber: string;
  createdAt: string;
};

export type EditableProfile = {
  id: string;
  displayName: string;
  handle: string | null;
  handleLastChangedAt: string | null;
  phoneNumber: string;
};

export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;

// The onboarding cultural anchor (PRD-D-0 §19): birth year + where the player
// grew up. Captured at onboarding for interest proposal; also consumed by daily
// generation as an era/regional SALIENCE hint (BP-5 / audit Q3d) — same purpose
// class (shaping LLM content for this player), never surfaced to other users
// and never used to adjust difficulty.
export type CulturalAnchor = {
  birthYear: number | null;
  grewUpCountry: string | null;
  grewUpRegion: string | null;
};

export async function getCulturalAnchor(userId: string): Promise<CulturalAnchor | null> {
  const [row] = await db
    .select({
      birthYear: users.birthYear,
      grewUpCountry: users.grewUpCountry,
      grewUpRegion: users.grewUpRegion,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  if (row.birthYear === null && !row.grewUpCountry && !row.grewUpRegion) return null;
  return {
    birthYear: row.birthYear ?? null,
    grewUpCountry: row.grewUpCountry ?? null,
    grewUpRegion: row.grewUpRegion ?? null,
  };
}

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value;
}

function fallbackDisplayName(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  const lastFour = digits.slice(-4);
  return lastFour ? `Player ${lastFour}` : 'Player';
}

export type DisplayNameMatch = {
  id: string;
  displayName: string | null;
};

export async function findDisplayNameMatches(
  displayName: string,
  excludeUserId?: string,
): Promise<DisplayNameMatch[]> {
  const trimmed = displayName.trim();
  if (!trimmed) return [];

  const conditions = [sql`lower(${users.displayName}) = lower(${trimmed})`];
  if (excludeUserId) conditions.push(ne(users.id, excludeUserId));

  return db
    .select({
      id: users.id,
      displayName: users.displayName,
    })
    .from(users)
    .where(and(...conditions));
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      phoneNumber: users.phoneNumber,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  return {
    id: user.id,
    displayName: user.displayName?.trim() || fallbackDisplayName(user.phoneNumber),
    handle: user.handle?.trim() ? user.handle.trim() : null,
    phoneNumber: formatPhoneNumber(user.phoneNumber),
    createdAt: user.createdAt.toISOString(),
  };
}

export async function getEditableProfile(userId: string): Promise<EditableProfile | null> {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
      handleLastChangedAt: users.handleLastChangedAt,
      phoneNumber: users.phoneNumber,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    displayName: row.displayName?.trim() || fallbackDisplayName(row.phoneNumber),
    handle: row.handle?.trim() ? row.handle.trim() : null,
    handleLastChangedAt: row.handleLastChangedAt?.toISOString() ?? null,
    phoneNumber: formatPhoneNumber(row.phoneNumber),
  };
}

export type ProfileFieldsPatch = {
  displayName?: string;
};

export type ProfileFieldsUpdateResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid_display_name' | 'duplicate_display_name' | 'empty_patch';
    };

// Updates the editable profile fields. Migration 0054 dropped bio,
// tagline, and location, leaving only displayName editable on the
// general profile endpoint. Handle changes go through PATCH
// /api/account/handle which owns the 30-day rate-limit.
export async function updateProfileFields(
  userId: string,
  patch: ProfileFieldsPatch,
): Promise<ProfileFieldsUpdateResult> {
  const set: Record<string, unknown> = {};

  if (patch.displayName !== undefined) {
    const displayName = patch.displayName.trim();
    if (displayName.length < 1 || displayName.length > 60) {
      return { ok: false, reason: 'invalid_display_name' };
    }
    const displayNameMatches = await findDisplayNameMatches(displayName, userId);
    if (displayNameMatches.length > 0) {
      return { ok: false, reason: 'duplicate_display_name' };
    }
    set.displayName = displayName;
  }

  if (Object.keys(set).length === 0) {
    return { ok: false, reason: 'empty_patch' };
  }

  set.updatedAt = new Date();
  await db.update(users).set(set).where(eq(users.id, userId));
  return { ok: true };
}

export type ReminderOptInState = 'opted_in' | 'opted_out' | 'not_asked';

export type ReminderState = {
  smsOptIn: ReminderOptInState;
  emailOptIn: ReminderOptInState;
  emailVerified: boolean;
  email: string | null;
  pendingEmail: string | null;
  phoneNumber: string;
  reminderPromptDismissedAt: string | null;
};

export async function getReminderState(userId: string): Promise<ReminderState | null> {
  const [row] = await db
    .select({
      smsOptIn: users.smsOptIn,
      emailOptIn: users.emailOptIn,
      emailVerified: users.emailVerified,
      email: users.email,
      pendingEmail: users.pendingEmail,
      phoneNumber: users.phoneNumber,
      reminderPromptDismissedAt: users.reminderPromptDismissedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  return {
    smsOptIn: row.smsOptIn,
    emailOptIn: row.emailOptIn,
    emailVerified: row.emailVerified,
    email: row.email,
    pendingEmail: row.pendingEmail,
    phoneNumber: row.phoneNumber,
    reminderPromptDismissedAt: row.reminderPromptDismissedAt?.toISOString() ?? null,
  };
}

export type ReminderPreferenceUpdate = {
  smsOptIn?: 'opted_in' | 'opted_out';
  emailOptIn?: 'opted_in' | 'opted_out';
  pendingEmail?: string;
  dismissed?: true;
};

export type ReminderPreferenceResult =
  | { ok: true; state: ReminderState }
  | { ok: false; reason: 'not_found' | 'email_not_verified' | 'phone_not_verified' };

export async function updateReminderPreferences(
  userId: string,
  patch: ReminderPreferenceUpdate,
): Promise<ReminderPreferenceResult> {
  const [current] = await db
    .select({
      phoneVerified: users.phoneVerified,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!current) return { ok: false, reason: 'not_found' };

  if (patch.smsOptIn === 'opted_in' && !current.phoneVerified) {
    return { ok: false, reason: 'phone_not_verified' };
  }
  if (patch.emailOptIn === 'opted_in' && !current.emailVerified) {
    return { ok: false, reason: 'email_not_verified' };
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.smsOptIn !== undefined) set.smsOptIn = patch.smsOptIn;
  if (patch.emailOptIn !== undefined) set.emailOptIn = patch.emailOptIn;
  if (patch.pendingEmail !== undefined) set.pendingEmail = patch.pendingEmail;
  if (patch.dismissed === true) set.reminderPromptDismissedAt = new Date();

  await db.update(users).set(set).where(eq(users.id, userId));

  const state = await getReminderState(userId);
  if (!state) return { ok: false, reason: 'not_found' };
  return { ok: true, state };
}

export async function updateDisplayName(params: {
  userId: string;
  displayName: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const displayName = params.displayName.trim();

  if (displayName.length < 2 || displayName.length > 30) {
    return { ok: false, reason: 'invalid' };
  }

  await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, params.userId));

  return { ok: true };
}

export type HandleChangeStatus = {
  handle: string | null;
  handleLastChangedAt: Date | null;
};

export async function getHandleChangeStatus(userId: string): Promise<HandleChangeStatus | null> {
  const [row] = await db
    .select({ handle: users.handle, handleLastChangedAt: users.handleLastChangedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return { handle: row.handle, handleLastChangedAt: row.handleLastChangedAt };
}

export type UpdateHandleResult =
  | { ok: true; handle: string }
  | { ok: false; reason: 'rate_limited'; retryAfter: Date };

// Writes a new handle, stamping handleLastChangedAt to now. Rate-limit: a
// successful change locks the user out of further changes for
// HANDLE_CHANGE_COOLDOWN_DAYS. Callers must validate format/reserved/taken
// upstream (see src/server/lib/handle-validation.ts).
export async function updateHandle(params: {
  userId: string;
  handle: string;
}): Promise<UpdateHandleResult> {
  const handle = params.handle.trim().toLowerCase();
  const now = new Date();

  const status = await getHandleChangeStatus(params.userId);
  if (status?.handleLastChangedAt) {
    const elapsedMs = now.getTime() - status.handleLastChangedAt.getTime();
    const cooldownMs = HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    if (elapsedMs < cooldownMs) {
      const retryAfter = new Date(status.handleLastChangedAt.getTime() + cooldownMs);
      return { ok: false, reason: 'rate_limited', retryAfter };
    }
  }

  await db
    .update(users)
    .set({ handle, handleLastChangedAt: now, updatedAt: now })
    .where(eq(users.id, params.userId));

  return { ok: true, handle };
}

// Initial assignment (no rate-limit gate) — used by the onboarding handle
// picker and the backfill script. Returns ok:false if the handle was claimed
// by another user between validation and write (race).
export async function assignInitialHandle(params: {
  userId: string;
  handle: string;
}): Promise<{ ok: boolean }> {
  const handle = params.handle.trim().toLowerCase();
  const now = new Date();

  try {
    await db
      .update(users)
      .set({ handle, updatedAt: now })
      .where(eq(users.id, params.userId));
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return { ok: false };
    }
    throw err;
  }
  return { ok: true };
}

export type DiscoverabilityState = {
  discoverableByContacts: boolean;
  discoverableByMutualFriends: boolean;
  discoverableByNicheMatch: boolean;
};

export async function getDiscoverability(
  userId: string,
): Promise<DiscoverabilityState | null> {
  const [row] = await db
    .select({
      discoverableByContacts: users.discoverableByContacts,
      discoverableByMutualFriends: users.discoverableByMutualFriends,
      discoverableByNicheMatch: users.discoverableByNicheMatch,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return row;
}

export type DiscoverabilityPatch = {
  contacts?: boolean;
  mutualFriends?: boolean;
  nicheMatch?: boolean;
};

// Updates one or both discoverability flags. Wraps both writes (and the
// optional ContactHash purge below) in a single transaction so the table
// can't be left holding rows after the user has revoked their consent.
//
// Side effect: when discoverableByContacts is flipped TRUE → FALSE, every
// ContactHash row for the user is deleted in the same transaction.
// Re-enabling later requires re-uploading hashes via B-Friends-4 (which
// will land the upload endpoint).
export async function updateDiscoverability(
  userId: string,
  patch: DiscoverabilityPatch,
): Promise<DiscoverabilityState | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        discoverableByContacts: users.discoverableByContacts,
        discoverableByMutualFriends: users.discoverableByMutualFriends,
        discoverableByNicheMatch: users.discoverableByNicheMatch,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!current) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.contacts !== undefined) set.discoverableByContacts = patch.contacts;
    if (patch.mutualFriends !== undefined) set.discoverableByMutualFriends = patch.mutualFriends;
    // No purge side-effect for niche-match: it stores no uploaded data to revoke.
    if (patch.nicheMatch !== undefined) set.discoverableByNicheMatch = patch.nicheMatch;

    await tx.update(users).set(set).where(eq(users.id, userId));

    const turningContactsOff =
      patch.contacts === false && current.discoverableByContacts === true;
    if (turningContactsOff) {
      await tx.delete(contactHashes).where(eq(contactHashes.userId, userId));
    }

    return {
      discoverableByContacts: patch.contacts ?? current.discoverableByContacts,
      discoverableByMutualFriends:
        patch.mutualFriends ?? current.discoverableByMutualFriends,
      discoverableByNicheMatch: patch.nicheMatch ?? current.discoverableByNicheMatch,
    };
  });
}

// Batched lookup of the niche-match opt-in flag for the niche-match write-point
// (D-2 WS3). Returns the subset of the supplied ids whose
// discoverableByNicheMatch is currently true. Used to resolve the asymmetric
// two-flag gate in notifyNicheMatch with a single query rather than a
// per-user getDiscoverability round-trip.
export async function getNicheMatchDiscoverable(
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      inArray(users.id, userIds),
      eq(users.discoverableByNicheMatch, true),
    ));
  return new Set(rows.map((r) => r.id));
}

// Builds a parenthesized SQL value list for `… in (…)`. Empty → `(null)`, which
// matches no rows (`x in (null)` is never true), so callers can use it
// unconditionally without a separate empty-set branch.
function idInList(ids: string[]) {
  if (ids.length === 0) return sql`(null)`;
  return sql`(${sql.join(ids.map((id) => sql`${id}`), sql.raw(', '))})`;
}

// Production account deletion (D-ACCOUNT-DELETION-TERRITORY-01). Honors the
// author's exit WITHOUT confiscating third parties' proven territory:
//
//   #1 retained answerers' MASTERY_EVENTS earned off this author's questions are
//      PRESERVED (their evidence of what they know; not contingent on the author).
//   #2 each authored Question a retained user still has territory on is TOMBSTONED
//      (creator_id NULL, source 'house_authored', author_deleted true) so the
//      content/difficulty/asked+correct counts survive for the answerers' math and
//      §8.27 retroactive reclassification — never rendered as a person (H-1).
//   #3 the windowed author-credit (MASTERY_EVENTS user_id = this author) is REMOVED.
//   #4 this user's own declared+proven territory, portrait, profile HARD-DELETE.
//
// Questions with NO retained dependency hard-delete with the account (Decision B).
// Convergence/activity attribution naming this user degrades to anonymized
// (Decision C). Feed actor cards they sourced onto retained feeds are stripped
// (Decision D — 'house' cannot be a real FK, Invariant H-1).
export async function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Decision D — strip this user's own feed and the actor cards they sourced
    // onto retained feeds. Deliberately NOT keyed by questionId: a card on a
    // RETAINED user's feed pointing at a question this user authored must survive
    // (the question is tombstoned below and re-sources to house). Stripping
    // source-actor cards first also lets a question whose only retained tie was
    // such a card fall through to hard-delete.
    await tx.execute(sql`delete from "FeedItem" where "recipientUserId" = ${userId} or "sourceUserId" = ${userId} or "joshingGameId" in (select id from "JoshingGame" where "creatorId" = ${userId})`);
    await tx.execute(sql`delete from "ActivityItem" where "userId" = ${userId}`);
    await tx.execute(sql`update "ActivityItem" set "actorUserId" = null where "actorUserId" = ${userId}`);

    // Partition this author's questions: TOMBSTONE (A1) when a RETAINED user still
    // has proven territory or a save tied to it, else hard-delete (Decision B).
    // Materialize both id sets ONCE, here — before any retained-side dependency
    // rows are removed below — so the partition stays stable for the rest of the tx.
    const retainedDependency = sql`(
      exists (select 1 from "MASTERY_EVENTS" me where me."question_id" = "Question".id and me."user_id" <> ${userId})
      or exists (select 1 from "UserQuestionBank" uqb where uqb."question_id" = "Question".id and uqb."user_id" <> ${userId})
      or exists (select 1 from "JoshingGameResponse" jgr where jgr."questionId" = "Question".id and jgr."userId" <> ${userId})
      or exists (select 1 from "FeedItem" fi where fi."questionId" = "Question".id and fi."recipientUserId" <> ${userId})
    )`;
    const tombstoneResult = await tx.execute<{ id: string }>(
      sql`select id from "Question" where "creator_id" = ${userId} and ${retainedDependency}`,
    );
    const orphanResult = await tx.execute<{ id: string }>(
      sql`select id from "Question" where "creator_id" = ${userId} and not ${retainedDependency}`,
    );
    const tombstoneIds = tombstoneResult.rows.map((row) => row.id);
    const orphanIds = orphanResult.rows.map((row) => row.id);
    const orphanList = idInList(orphanIds);

    const questionReactionColumnsResult = await tx.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'QuestionReaction'
        and column_name in ('senderUserId', 'recipientUserId', 'questionId', 'answerer_id', 'creator_id', 'question_id')
    `);
    const questionReactionColumnNames = new Set(
      questionReactionColumnsResult.rows.map((row) => row.column_name),
    );

    if (
      questionReactionColumnNames.has('senderUserId')
      && questionReactionColumnNames.has('recipientUserId')
      && questionReactionColumnNames.has('questionId')
    ) {
      await tx.execute(sql`delete from "QuestionReaction" where "senderUserId" = ${userId} or "recipientUserId" = ${userId} or "questionId" in ${orphanList}`);
    } else if (
      questionReactionColumnNames.has('answerer_id')
      && questionReactionColumnNames.has('creator_id')
      && questionReactionColumnNames.has('question_id')
    ) {
      await tx.execute(sql`delete from "QuestionReaction" where "answerer_id" = ${userId} or "creator_id" = ${userId} or "question_id" in ${orphanList}`);
    }
    await tx.execute(sql`delete from "GradeDispute" where "creator_id" = ${userId} or "question_id" in ${orphanList}`);

    await tx.execute(sql`delete from "JoshingGameResponse" where "userId" = ${userId} or "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in ${orphanList}`);
    await tx.execute(sql`delete from "JoshingGameRecipient" where "userId" = ${userId} or "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGameQuestion" where "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in ${orphanList}`);
    await tx.execute(sql`delete from "JoshingGame" where "creatorId" = ${userId}`);

    await tx.execute(sql`delete from "Friendship" where "userAId" = ${userId} or "userBId" = ${userId} or "requestedByUserId" = ${userId} or "removedByUserId" = ${userId}`);
    await tx.execute(sql`delete from "FriendInvitation" where "inviterUserId" = ${userId}`);
    await tx.execute(sql`update "FriendInvitation" set "inviteeUserId" = null where "inviteeUserId" = ${userId}`);
    await tx.execute(sql`update "DailyPreference" set "friend_ids" = array_remove("friend_ids", ${userId}) where ${userId} = any("friend_ids")`);

    await tx.execute(sql`delete from "SkippedDailyQuestion" where "user_id" = ${userId} or "question_id" in ${orphanList} or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "DailyQueue" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "DailyPreference" where "user_id" = ${userId}`);

    await tx.execute(sql`delete from "QuestionFeedback" where "user_id" = ${userId} or "question_id" in ${orphanList} or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "QuestionRating" where "user_id" = ${userId} or "question_id" in ${orphanList}`);
    // Decision B: a friend's bank save IS a retained dependency, so a banked
    // question is a tombstone — only THIS user's own bank rows are removed (their
    // saves of a tombstoned question are preserved by the orphan-only question key).
    await tx.execute(sql`delete from "UserQuestionBank" where "user_id" = ${userId} or "question_id" in ${orphanList}`);
    await tx.execute(sql`delete from "QuestionAudienceTag" where "creator_id" = ${userId} or "question_id" in ${orphanList}`);

    // ContentReport: the `ContentReport_one_target` CHECK
    // ((question_id NOT NULL) + (generated_question_id NOT NULL) = 1) forbids
    // nulling a report's target, so a report whose target is going away is
    // deleted, not orphaned. Deleted here: this user's own reports (#4), reports
    // targeting an orphan question (hard-deleted below), and reports targeting
    // this user's generated questions (deleted below). Reports targeting a
    // TOMBSTONE question keep pointing at the surviving row (moderation record
    // preserved). Runs before the orphan-Question and GeneratedQuestion deletes
    // so their RESTRICT FKs don't block.
    await tx.execute(sql`delete from "ContentReport" where "reporter_user_id" = ${userId} or "question_id" in ${orphanList} or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);

    // THE territory-preservation core (#1/#3/#4): delete ONLY this user's own
    // mastery rows (their proven territory + their author-credit). Retained users'
    // events tied to this author's questions are PRESERVED — never deleted by
    // question_id, which is what the old hard-cascade did (the confiscation bug).
    await tx.execute(sql`delete from "MASTERY_EVENTS" where "user_id" = ${userId}`);
    // Decision C — degrade convergence/Lately attribution: a retained user's event
    // that named THIS user as the answerer keeps the fact, loses the name.
    // answered_by_user_id is plain text (not an FK); convergence reads it.
    await tx.execute(sql`update "MASTERY_EVENTS" set "answered_by_user_id" = null where "answered_by_user_id" = ${userId}`);

    // A1 tombstone: retained-dependency questions persist, re-sourced to house.
    if (tombstoneIds.length > 0) {
      await tx.execute(sql`update "Question" set "creator_id" = null, "source" = 'house_authored', "author_deleted" = true, "updated_at" = now() where id in ${idInList(tombstoneIds)}`);
    }
    // Decision B: questions with no retained dependency hard-delete with the user.
    // Their FeedItems were stripped above and their other referencers removed by
    // the orphan-keyed deletes, so no FK blocks this.
    if (orphanIds.length > 0) {
      await tx.execute(sql`delete from "Question" where id in ${idInList(orphanIds)}`);
    }

    await tx.execute(sql`update "Question" set "generated_question_id" = null where "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "GeneratedQuestion" where "user_id" = ${userId}`);

    await tx.execute(sql`delete from "PLAYER_MASTERY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "CritiqueUsageDaily" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "USER_DOMAIN_DIFFICULTY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "USER_DOMAIN_EXCLUSIONS" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "PROFILE_DOMAIN_VISIBILITY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "PROFILE_SECTION_VISIBILITY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "DeclaredInterest" where "userId" = ${userId}`);
    await tx.execute(sql`delete from "FeedDismissedDomain" where "userId" = ${userId}`);
    await tx.execute(sql`delete from "BiweeklyCeremony" where "userId" = ${userId}`);
    await tx.execute(sql`delete from "SmsLog" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "UserSession" where "user_id" = ${userId}`);

    await tx.delete(users).where(eq(users.id, userId));
  });
}
