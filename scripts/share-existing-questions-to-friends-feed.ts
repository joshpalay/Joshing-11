/**
 * Repair FeedItems for authored questions that should have been shared to friends,
 * but were saved before the share-to-feed flow completed.
 *
 * This script is intentionally explicit: pass the affected question id(s). Do not
 * blanket-share every Question where "sharedToFriendsFeed" is false, because false
 * is also the correct value for questions the author saved only to their bank.
 *
 * Usage:
 *   QUESTION_IDS=961bcf31-f0be-4d73-84ba-34c44136ea8e,bcfcf65c-7d8f-43eb-8a4a-155645886b4f \
 *     npx tsx scripts/share-existing-questions-to-friends-feed.ts --dry-run
 *
 *   QUESTION_IDS=961bcf31-f0be-4d73-84ba-34c44136ea8e,bcfcf65c-7d8f-43eb-8a4a-155645886b4f \
 *     npx tsx scripts/share-existing-questions-to-friends-feed.ts --apply
 *
 * You can also repeat --question-id on the command line:
 *   npx tsx scripts/share-existing-questions-to-friends-feed.ts --apply --question-id=<id>
 */

import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const BLOCKING_FEED_STATES = ['active', 'skipped', 'dismissed'];

type QuestionRow = {
  id: string;
  creator_id: string | null;
  question_text: string;
  visibility: string;
  deleted_at: Date | null;
  canonical_subcategory: string | null;
  sharedToFriendsFeed: boolean;
};

type FriendRow = { friend_id: string };

type RepairResult = {
  questionId: string;
  friendCount: number;
  createdCount: number;
  skippedDismissedDomainRecipientIds: string[];
  skippedExistingFeedRecipientIds: string[];
  skippedInvalidQuestion: string | null;
};

function parseQuestionIds(): string[] {
  const fromEnv = (process.env.QUESTION_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const fromArgs = process.argv.flatMap((arg, index, args) => {
    if (arg.startsWith('--question-id=')) return [arg.slice('--question-id='.length).trim()];
    if (arg === '--question-id') return [args[index + 1]?.trim() ?? ''];
    return [];
  }).filter(Boolean);

  return [...new Set([...fromEnv, ...fromArgs])];
}

async function getActiveFriendIds(client: PoolClient, userId: string): Promise<string[]> {
  const { rows } = await client.query<FriendRow>(`
    SELECT CASE WHEN "userAId" = $1 THEN "userBId" ELSE "userAId" END AS friend_id
    FROM "Friendship"
    WHERE status = 'active'
      AND ($1 IN ("userAId", "userBId"))
    ORDER BY friend_id
  `, [userId]);

  return rows.map((row) => row.friend_id);
}

async function getDismissedRecipientIds(
  client: PoolClient,
  friendIds: string[],
  canonicalSubcategory: string | null,
): Promise<Set<string>> {
  if (friendIds.length === 0 || !canonicalSubcategory) return new Set();

  const { rows } = await client.query<{ userId: string }>(`
    SELECT "userId"
    FROM "FeedDismissedDomain"
    WHERE "userId" = ANY($1::text[])
      AND "canonicalSubcategory" = $2
      AND "reinstatedAt" IS NULL
  `, [friendIds, canonicalSubcategory]);

  return new Set(rows.map((row) => row.userId));
}

async function hasBlockingFeedItem(client: PoolClient, recipientUserId: string, questionId: string): Promise<boolean> {
  const { rowCount } = await client.query(`
    SELECT 1
    FROM "FeedItem"
    WHERE "recipientUserId" = $1
      AND "questionId" = $2
      AND state = ANY($3::text[])
    LIMIT 1
  `, [recipientUserId, questionId, BLOCKING_FEED_STATES]);

  return Boolean(rowCount);
}

async function repairQuestion(client: PoolClient, question: QuestionRow): Promise<RepairResult> {
  const invalidReason = !question.creator_id
    ? 'missing_creator'
    : question.deleted_at
      ? 'deleted_question'
      : question.visibility !== 'public'
        ? 'non_public_question'
        : null;

  const result: RepairResult = {
    questionId: question.id,
    friendCount: 0,
    createdCount: 0,
    skippedDismissedDomainRecipientIds: [],
    skippedExistingFeedRecipientIds: [],
    skippedInvalidQuestion: invalidReason,
  };

  if (invalidReason || !question.creator_id) return result;

  const friendIds = await getActiveFriendIds(client, question.creator_id);
  const dismissedRecipientIds = await getDismissedRecipientIds(client, friendIds, question.canonical_subcategory);
  result.friendCount = friendIds.length;

  for (const friendId of friendIds) {
    if (dismissedRecipientIds.has(friendId)) {
      result.skippedDismissedDomainRecipientIds.push(friendId);
      continue;
    }

    if (await hasBlockingFeedItem(client, friendId, question.id)) {
      result.skippedExistingFeedRecipientIds.push(friendId);
      continue;
    }

    result.createdCount += 1;
    if (!DRY_RUN) {
      await client.query(`
        INSERT INTO "FeedItem" (
          id, "recipientUserId", "questionId", "sourceType", "sourceUserId", "sourceEventAt", state, "isPinned", "createdAt"
        )
        VALUES (gen_random_uuid()::text, $1, $2, 'authored_shared', $3, now(), 'active', false, now())
      `, [friendId, question.id, question.creator_id]);
    }
  }

  if (!DRY_RUN && result.createdCount > 0) {
    await client.query(`
      UPDATE "Question"
      SET "sharedToFriendsFeed" = true,
          updated_at = now()
      WHERE id = $1
    `, [question.id]);
  }

  return result;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

  const questionIds = parseQuestionIds();
  if (questionIds.length === 0) {
    throw new Error('Pass QUESTION_IDS as a comma-separated env var or pass --question-id=<id>.');
  }

  console.log(DRY_RUN ? '[dry-run] No changes will be made. Pass --apply to mutate.' : '[apply] Changes will be written.');
  console.log(`Repairing ${questionIds.length} question(s).`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: questions } = await pool.query<QuestionRow>(`
      SELECT id, creator_id, question_text, visibility, deleted_at, canonical_subcategory, "sharedToFriendsFeed"
      FROM "Question"
      WHERE id = ANY($1::text[])
      ORDER BY created_at DESC
    `, [questionIds]);

    const foundIds = new Set(questions.map((question) => question.id));
    const missingIds = questionIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) console.warn('Missing question ids:', missingIds);

    console.table(questions.map((question) => ({
      id: question.id,
      creator_id: question.creator_id,
      sharedToFriendsFeed: question.sharedToFriendsFeed,
      visibility: question.visibility,
      deleted_at: question.deleted_at,
      canonical_subcategory: question.canonical_subcategory,
      question_text: question.question_text,
    })));

    const results: RepairResult[] = [];
    for (const question of questions) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await repairQuestion(client, question);
        results.push(result);
        await client.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    console.table(results.map((result) => ({
      questionId: result.questionId,
      friendCount: result.friendCount,
      createdCount: result.createdCount,
      skippedDismissedDomainCount: result.skippedDismissedDomainRecipientIds.length,
      skippedExistingFeedCount: result.skippedExistingFeedRecipientIds.length,
      skippedInvalidQuestion: result.skippedInvalidQuestion,
    })));

    for (const result of results) {
      if (result.skippedDismissedDomainRecipientIds.length > 0 || result.skippedExistingFeedRecipientIds.length > 0) {
        console.log(`Question ${result.questionId} skipped recipient ids:`, {
          skippedDismissedDomainRecipientIds: result.skippedDismissedDomainRecipientIds,
          skippedExistingFeedRecipientIds: result.skippedExistingFeedRecipientIds,
        });
      }
    }

    if (DRY_RUN) console.log('[dry-run] No changes applied. Re-run with --apply to execute.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
