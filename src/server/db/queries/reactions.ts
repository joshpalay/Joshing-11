import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { CANNED_REACTIONS, getCannedReaction, type ReactionKey } from '@/lib/reactions';
import { activityItems, db, questionReactions, questions, users } from '@/server/db';
import { sendSms } from '@/server/sms';

export type ReactionContextType = 'feed' | 'joshing_game';

export type ReactionView = {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  questionId: string;
  contextType: ReactionContextType;
  contextId: string | null;
  reactionType: ReactionKey | string;
  reactionLabel: string;
  reactionEmoji: string;
  customMessage: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  sender: { displayName: string };
  question: { text: string };
};

type CreateReactionParams = {
  senderUserId: string;
  recipientUserId: string;
  questionId: string;
  contextType: ReactionContextType;
  contextId: string | null;
  reactionType: ReactionKey;
  customMessage?: string | null;
};

function displayName(value: string | null, fallback = 'Someone'): string {
  return value?.trim() || fallback;
}

function reactionCopy(key: string) {
  return getCannedReaction(key) ?? { key, label: key, emoji: '' };
}

export async function createReaction(params: CreateReactionParams): Promise<{ id: string }> {
  const [sender, recipient] = await Promise.all([
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, params.senderUserId))
      .limit(1),
    db
      .select({ phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
      .from(users)
      .where(eq(users.id, params.recipientUserId))
      .limit(1),
  ]);

  const [created] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(questionReactions)
      .values({
        senderUserId: params.senderUserId,
        recipientUserId: params.recipientUserId,
        questionId: params.questionId,
        contextType: params.contextType,
        contextId: params.contextId,
        reactionType: params.reactionType,
        customMessage: params.customMessage?.trim() ? params.customMessage.trim().slice(0, 160) : null,
      })
      .returning({ id: questionReactions.id });

    await tx.insert(activityItems).values({
      userId: params.recipientUserId,
      type: 'reaction_received',
      actorUserId: params.senderUserId,
      referenceId: inserted[0].id,
      referenceType: 'question_reaction',
      read: false,
    });

    return inserted;
  });

  const recipientRow = recipient[0];
  if (recipientRow?.phoneNumber && recipientRow.smsOptIn === 'opted_in') {
    const reaction = reactionCopy(params.reactionType);
    const senderName = displayName(sender[0]?.displayName ?? null);
    const body = `${senderName} reacted to your question: ${reaction.label}`;
    sendSms(recipientRow.phoneNumber, body, 'question_reaction', params.recipientUserId).catch((error) => {
      console.error('Reaction SMS failed', error);
    });
  }

  return created;
}

export async function getReactionsForUser(userId: string): Promise<ReactionView[]> {
  const rows = await db
    .select()
    .from(questionReactions)
    .where(eq(questionReactions.recipientUserId, userId))
    .orderBy(desc(questionReactions.createdAt))
    .limit(100);

  if (rows.length === 0) return [];

  const senderIds = [...new Set(rows.map((reaction) => reaction.senderUserId))];
  const questionIds = [...new Set(rows.map((reaction) => reaction.questionId))];

  const [senderRows, questionRows] = await Promise.all([
    senderIds.length
      ? db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, senderIds))
      : Promise.resolve([]),
    questionIds.length
      ? db
          .select({ id: questions.id, questionText: questions.questionText })
          .from(questions)
          .where(inArray(questions.id, questionIds))
      : Promise.resolve([]),
  ]);

  const sendersById = new Map(senderRows.map((sender) => [sender.id, sender]));
  const questionsById = new Map(questionRows.map((question) => [question.id, question]));

  return rows.map((row) => {
    const reaction = reactionCopy(row.reactionType);
    return {
      id: row.id,
      senderUserId: row.senderUserId,
      recipientUserId: row.recipientUserId,
      questionId: row.questionId,
      contextType: row.contextType,
      contextId: row.contextId,
      reactionType: row.reactionType,
      reactionLabel: reaction.label,
      reactionEmoji: reaction.emoji,
      customMessage: row.customMessage,
      repliedAt: row.repliedAt,
      createdAt: row.createdAt,
      sender: { displayName: displayName(sendersById.get(row.senderUserId)?.displayName ?? null) },
      question: { text: questionsById.get(row.questionId)?.questionText ?? 'A question' },
    };
  });
}

export async function getUnrepliedReactionCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: questionReactions.id })
    .from(questionReactions)
    .where(and(eq(questionReactions.recipientUserId, userId), isNull(questionReactions.repliedAt)));

  return rows.length;
}

export async function markReactionReplied(reactionId: string, userId: string): Promise<boolean> {
  const updated = await db
    .update(questionReactions)
    .set({ repliedAt: new Date() })
    .where(and(eq(questionReactions.id, reactionId), eq(questionReactions.recipientUserId, userId)))
    .returning({ id: questionReactions.id });

  return updated.length > 0;
}

export const CANNED_REACTION_KEYS = CANNED_REACTIONS.map((reaction) => reaction.key);
