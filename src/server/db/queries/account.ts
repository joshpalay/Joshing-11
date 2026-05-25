import { eq, sql } from 'drizzle-orm';

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
  | { ok: false; reason: 'invalid_display_name' | 'empty_patch' };

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
};

export async function getDiscoverability(
  userId: string,
): Promise<DiscoverabilityState | null> {
  const [row] = await db
    .select({
      discoverableByContacts: users.discoverableByContacts,
      discoverableByMutualFriends: users.discoverableByMutualFriends,
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
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!current) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.contacts !== undefined) set.discoverableByContacts = patch.contacts;
    if (patch.mutualFriends !== undefined) set.discoverableByMutualFriends = patch.mutualFriends;

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
    };
  });
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from "FeedItem" where "recipientUserId" = ${userId} or "sourceUserId" = ${userId} or "joshingGameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "ActivityItem" where "userId" = ${userId}`);
    await tx.execute(sql`update "ActivityItem" set "actorUserId" = null where "actorUserId" = ${userId}`);

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
      await tx.execute(sql`delete from "QuestionReaction" where "senderUserId" = ${userId} or "recipientUserId" = ${userId} or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    } else if (
      questionReactionColumnNames.has('answerer_id')
      && questionReactionColumnNames.has('creator_id')
      && questionReactionColumnNames.has('question_id')
    ) {
      await tx.execute(sql`delete from "QuestionReaction" where "answerer_id" = ${userId} or "creator_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    }
    const creatorNoteTableResult = await tx.execute<{ exists: boolean }>(sql`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'CreatorNote'
      ) as "exists"
    `);

    if (creatorNoteTableResult.rows[0]?.exists) {
      await tx.execute(sql`delete from "CreatorNote" where "authorUserId" = ${userId} or "recipientUserId" = ${userId} or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    }

    await tx.execute(sql`delete from "GradeDispute" where "creator_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);

    await tx.execute(sql`delete from "JoshingGameResponse" where "userId" = ${userId} or "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGameRecipient" where "userId" = ${userId} or "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGameQuestion" where "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGame" where "creatorId" = ${userId}`);

    await tx.execute(sql`delete from "Friendship" where "userAId" = ${userId} or "userBId" = ${userId} or "requestedByUserId" = ${userId} or "removedByUserId" = ${userId}`);
    await tx.execute(sql`delete from "FriendInvitation" where "inviterUserId" = ${userId}`);
    await tx.execute(sql`update "FriendInvitation" set "inviteeUserId" = null where "inviteeUserId" = ${userId}`);
    await tx.execute(sql`update "DailyPreference" set "friend_ids" = array_remove("friend_ids", ${userId}) where ${userId} = any("friend_ids")`);

    await tx.execute(sql`delete from "SkippedDailyQuestion" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId}) or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "DailyQueue" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "DailyPreference" where "user_id" = ${userId}`);

    await tx.execute(sql`delete from "QuestionFeedback" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId}) or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "QuestionRating" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "UserQuestionBank" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "QuestionAudienceTag" where "creator_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "MASTERY_EVENTS" where "user_id" = ${userId} or "answered_by_user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);

    await tx.execute(sql`delete from "Question" where "creator_id" = ${userId}`);
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
