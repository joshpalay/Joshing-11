import { and, eq, gt, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { writeActivity } from '@/server/activity/write-activity';
import { getSession } from '@/server/auth/session';
import { db, feedItems, generatedQuestions, questions, users } from '@/server/db';
import {
  createFeedItem,
  rollOffOldItems,
  userAnsweredQuestionCorrectly,
  userHasQuestionInBlockingFeed,
} from '@/server/db/queries/feed';
import { getFriends } from '@/server/db/queries/friends';
import { isQuestionReportSuppressed } from '@/server/db/queries/content-reports';
import { sendSms } from '@/server/sms';
import { DIRECT_SENT_FEED_SOURCE_TYPE } from '@/server/feed/visibility';
import { findCanonicalQuestionIdForGenerated } from '@/server/questions/persist-generated-question';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: 'validation', message: 'question_id and recipient_user_id are required' },
      { status: 400 },
    );
  }
  if (parsed.recipientUserId === session.userId) {
    return NextResponse.json({ error: 'validation', message: 'Choose a friend to send this to.' }, { status: 400 });
  }

  const friends = await getFriends(session.userId);
  if (!friends.some((friend) => friend.id === parsed.recipientUserId)) {
    return NextResponse.json({ error: 'Recipient is not a friend.' }, { status: 403 });
  }

  // B-Report-3: a question under an open/upheld content report can't enter a new
  // surface. Check the RAW incoming id (which may be a GeneratedQuestion) before
  // resolveQuestionIdForSend mints it into a fresh curated Question — otherwise a
  // report on the original would be laundered away by the new id.
  if (await isQuestionReportSuppressed(parsed.questionId)) {
    return NextResponse.json(
      { error: 'under_review', message: 'This question is under review and can’t be sent right now.' },
      { status: 409 },
    );
  }

  const sendableQuestionId = await resolveQuestionIdForSend(parsed.questionId);

  const [question, recipient, senderNameRow] = await Promise.all([
    sendableQuestionId
      ? db.select().from(questions).where(eq(questions.id, sendableQuestionId)).limit(1)
      : Promise.resolve([]),
    db.select().from(users).where(eq(users.id, parsed.recipientUserId)).limit(1),
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, session.userId)).limit(1),
  ]);

  if (!question[0] || !recipient[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Defensive: house/editorial questions are content infrastructure, never
  // peer-to-peer sendable (D-3). No UI path forwards one and feed fan-out would
  // reject it (null creatorId, non-LLM origin), but reject it explicitly here so
  // the invariant is enforced at the entry point rather than implicitly downstream.
  if (question[0].source === 'house_authored') {
    return NextResponse.json(
      { error: 'invalid_question', message: 'House questions cannot be sent.' },
      { status: 400 },
    );
  }

  // Safety hard-block: a question that failed the safety vet is marked
  // visibility='blocked' and can never be sent to a recipient, even by its
  // author. The feed render predicate would hide it anyway, but reject at the
  // entry point so no feed row is written. Non-graphic message; category not named.
  if (question[0].visibility === 'blocked') {
    return NextResponse.json(
      { error: 'invalid_question', message: "That question can't be sent because it didn't pass a content check." },
      { status: 400 },
    );
  }

  // An unverified question (its answer was never machine-confirmed) is a private
  // ask between the author and the people they hand it to directly. The author
  // may keep direct-sending it, but a recipient cannot forward it onward — an
  // unconfirmed answer should not travel beyond the people its author chose. The
  // author's own send is allowed (creatorId === sender); anyone else is forwarding.
  if (question[0].status === 'unverified' && question[0].creatorId !== session.userId) {
    return NextResponse.json(
      { error: 'unverified_no_forward', message: "This question isn't verified, so it can't be forwarded. Only the person who wrote it can send it." },
      { status: 400 },
    );
  }

  const [alreadyCorrect, alreadyInFeed] = await Promise.all([
    userAnsweredQuestionCorrectly(parsed.recipientUserId, sendableQuestionId!),
    userHasQuestionInBlockingFeed(parsed.recipientUserId, sendableQuestionId!),
  ]);
  if (alreadyCorrect) {
    return NextResponse.json(
      { error: 'already_answered', message: 'That friend has already answered this one correctly.' },
      { status: 409 },
    );
  }
  if (alreadyInFeed) {
    return NextResponse.json(
      { error: 'already_in_feed', message: 'That question is already waiting in their Feed.' },
      { status: 409 },
    );
  }

  const [sentToday] = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, parsed.recipientUserId),
      eq(feedItems.sourceUserId, session.userId),
      eq(feedItems.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE),
      gt(feedItems.createdAt, lastTwentyFourHours()),
    ));

  if (Number(sentToday?.count ?? 0) >= 5) {
    return NextResponse.json(
      { error: "You've sent this person 5 questions today. Try again tomorrow." },
      { status: 429 },
    );
  }

  // D-4 via-attribution (two-hop relay). Stamp the user THIS sender (the
  // forwarder) received this question from, so the downstream recipient can
  // discover them ("via {source}"). It's the sourceUserId of the forwarder's
  // own inbound forward row for this question — NOT propagated from that row's
  // own viaUserId, so the lookback is capped at exactly one hop above the
  // forwarder. NULL when the sender authored it or got it organically (no
  // inbound forward). Earliest inbound row wins (the forwarder's true entry
  // point). Null it out if the source is the recipient themselves (a "via you"
  // is pointless). See the D-4 amendment in PRD-D-4-…-SPEC.md.
  const [inboundForward] = await db
    .select({ sourceUserId: feedItems.sourceUserId })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, session.userId),
      eq(feedItems.questionId, sendableQuestionId!),
      eq(feedItems.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE),
    ))
    .orderBy(feedItems.sourceEventAt)
    .limit(1);
  const viaUserId =
    inboundForward && inboundForward.sourceUserId !== parsed.recipientUserId
      ? inboundForward.sourceUserId
      : null;

  const created = await createFeedItem({
    recipientUserId: parsed.recipientUserId,
    questionId: sendableQuestionId!,
    sourceType: DIRECT_SENT_FEED_SOURCE_TYPE,
    sourceUserId: session.userId,
    viaUserId,
    sourceEventAt: new Date(),
    personalMessage: parsed.personalMessage,
    state: 'active',
    isPinned: true,
  });

  await writeActivity({
    userId: parsed.recipientUserId,
    type: 'received_direct_question',
    actorUserId: session.userId,
    referenceId: created.id,
    referenceType: 'feed_item',
  });

  await rollOffOldItems(parsed.recipientUserId);

  const recipientUser = recipient[0];
  if (recipientUser.phoneNumber && recipientUser.smsOptIn !== 'opted_out') {
    const senderName = senderNameRow[0]?.displayName?.trim() || 'A friend';
    const feedUrl = `${request.nextUrl.origin}/feed`;
    await sendSms(
      recipientUser.phoneNumber,
      `${senderName} sent you a question. ${feedUrl}`,
      'question_reaction' as never,
      recipientUser.id,
    );
  }

  return NextResponse.json({ item: created }, { status: 201 });
}

function parseBody(value: unknown): { questionId: string; recipientUserId: string; personalMessage: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId = typeof record.question_id === 'string'
    ? record.question_id
    : typeof record.questionId === 'string'
      ? record.questionId
      : null;
  const recipientUserId = typeof record.recipient_user_id === 'string'
    ? record.recipient_user_id
    : typeof record.friend_id === 'string'
      ? record.friend_id
      : typeof record.recipientUserId === 'string'
        ? record.recipientUserId
        : null;
  const rawMessage = typeof record.personalMessage === 'string'
    ? record.personalMessage
    : typeof record.personal_message === 'string'
      ? record.personal_message
      : '';
  const personalMessage = rawMessage.trim().slice(0, 200) || null;

  return questionId && recipientUserId ? { questionId, recipientUserId, personalMessage } : null;
}

function lastTwentyFourHours(date = new Date()) {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

export async function resolveQuestionIdForSend(questionId: string): Promise<string | null> {
  const [question] = await db.select({ id: questions.id }).from(questions).where(eq(questions.id, questionId)).limit(1);
  if (question) return question.id;

  const [generated] = await db
    .select()
    .from(generatedQuestions)
    .where(eq(generatedQuestions.id, questionId))
    .limit(1);

  if (!generated) return null;

  // Reuse a canonical Question that already represents this generated row rather
  // than minting a second one. The daily-answer path persists it as
  // generated_question_id and a prior send persists it as source_question_id;
  // either is the same fact. Minting a fresh row here forks the question into two
  // ids, which defeats every question_id-keyed dedup downstream (feed "already
  // answered" suppression, the already-in-feed guard above) — the cause of the
  // observed loop where a question you'd answered came back via a friend's feed.
  const existingId = await findCanonicalQuestionIdForGenerated(generated.id);
  if (existingId) return existingId;

  // A sent LLM question keeps its LLM/curated provenance: no author is recorded
  // (creatorId stays null so author/curator credit never accrues to the
  // forwarder), and source is 'curated_sent' so it is queryably distinct from
  // both authored questions and daily-generated ones. Who sent it is preserved
  // separately on the FeedItem (sourceUserId) written by the caller.
  const [created] = await db
    .insert(questions)
    .values({
      creatorId: null,
      sourceQuestionId: generated.id,
      source: 'curated_sent',
      questionText: generated.questionText,
      answerText: generated.answer,
      factualExplanation: generated.explainer,
      category: 'general_knowledge',
      broadCategory: generated.broadCategory,
      canonicalSubcategory: generated.canonicalSubcategory,
      difficultyEstimate: generated.difficultyEstimate === 'accessible' || generated.difficultyEstimate === 'moderate' || generated.difficultyEstimate === 'specialist'
        ? generated.difficultyEstimate
        : null,
    })
    .returning({ id: questions.id });

  return created?.id ?? null;
}
