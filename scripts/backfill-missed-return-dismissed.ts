/**
 * D-MISSED-RETURN-01 §7-G — one-time backfill of existing slot-level catch-up
 * dismisses into `MissedReturnDismissed`.
 *
 * Before this table existed, a catch-up dismiss was recorded SLOT-scoped:
 *   - `DailyQueue.slots[]` entries with `dismissed_at IS NOT NULL`
 *   - `FeedItem.catchupResolvedAt IS NOT NULL`
 *
 * A return slot is a new slot in a different queue and cannot see either. This
 * script promotes those historical dismisses to (userId, questionId) rows so no
 * previously-waved-off question can resurface when the return feature ships.
 *
 * SCOPE — canonical questions only. A daily slot carrying `generated_question_id`
 * is LLM-origin, has no `Question` row to key on, and is skipped: it is out of
 * this feature's scope by construction (MASTERY_EVENTS.question_id is null for
 * generated questions too, so the Recovered pool excludes them as well).
 *
 * !! THE FEED SOURCE IS NOT A DISMISS MARKER — measured 2026-08-09 !!
 * D-MISSED-RETURN-01 §7-G names `FeedItem.catchupResolvedAt` as a dismiss
 * source. It is not: `catchup/answer/route.ts` stamps the SAME column when the
 * player ANSWERS a feed catch-up item. On live data all 49 resolved feed rows
 * were answers (state='answered', answerResult set on every one — 36 correct,
 * 13 incorrect) and ZERO were clean dismisses. Backfilling that column blind
 * would have permanently suppressed 13 wrong-answered questions — precisely the
 * inventory this feature exists to return — with no player-facing way to undo.
 *
 * So the feed collector below filters to rows bearing NO answer evidence at all.
 * That yields 0 rows today and is the semantically correct rule going forward.
 * Erring toward UNDER-suppression is deliberate: a missed dismiss means a
 * question returns once and can be dismissed again (and now it sticks), while an
 * over-suppression silently kills eligibility forever.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-missed-return-dismissed.ts
 *   npx tsx scripts/backfill-missed-return-dismissed.ts --apply
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db, dailyQueues, feedItems, missedReturnDismissed, questions } from '../src/server/db';

const APPLY = process.argv.includes('--apply');

type Pair = { userId: string; questionId: string; source: 'daily' | 'feed' };

function keyOf(p: Pair): string {
  return `${p.userId}::${p.questionId}`;
}

async function collectDailyPairs(): Promise<Pair[]> {
  // Unnest the slots JSONB and keep dismissed, canonical-question slots.
  const rows = await db.execute<{ userId: string; questionId: string }>(sql`
    SELECT DISTINCT q.user_id AS "userId", slot->>'question_id' AS "questionId"
    FROM "DailyQueue" q,
         LATERAL jsonb_array_elements(q.slots) AS slot
    WHERE slot->>'dismissed_at' IS NOT NULL
      AND slot->>'question_id' IS NOT NULL
      AND slot->>'generated_question_id' IS NULL
  `);
  return (rows as unknown as { userId: string; questionId: string }[]).map((r) => ({
    userId: r.userId,
    questionId: r.questionId,
    source: 'daily' as const,
  }));
}

async function collectFeedPairs(): Promise<Pair[]> {
  // Resolved AND carrying no answer evidence — see the header. `catchupResolvedAt`
  // alone is stamped by the answer path too, so it cannot stand on its own.
  const rows = await db
    .select({ userId: feedItems.recipientUserId, questionId: feedItems.questionId })
    .from(feedItems)
    .where(
      and(
        isNotNull(feedItems.catchupResolvedAt),
        isNotNull(feedItems.questionId),
        isNull(feedItems.answerResult),
        isNull(feedItems.answeredAt),
        isNull(feedItems.submittedAnswer),
      ),
    );
  return rows
    .filter((r): r is { userId: string; questionId: string } => Boolean(r.userId && r.questionId))
    .map((r) => ({ userId: r.userId, questionId: r.questionId, source: 'feed' as const }));
}

async function main() {
  const [dailyPairs, feedPairs] = await Promise.all([collectDailyPairs(), collectFeedPairs()]);

  // Dedupe across both sources.
  const byKey = new Map<string, Pair>();
  for (const p of [...dailyPairs, ...feedPairs]) {
    if (!byKey.has(keyOf(p))) byKey.set(keyOf(p), p);
  }

  // Drop pairs whose question no longer exists (the FK would reject them).
  const allQuestionIds = [...new Set([...byKey.values()].map((p) => p.questionId))];
  const liveQuestionIds = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < allQuestionIds.length; i += CHUNK) {
    const chunk = allQuestionIds.slice(i, i + CHUNK);
    const rows = await db
      .select({ id: questions.id })
      .from(questions)
      .where(sql`${questions.id} = ANY(${chunk})`);
    for (const r of rows) liveQuestionIds.add(r.id);
  }

  // Skip pairs that already have an active row.
  const existing = await db
    .select({ userId: missedReturnDismissed.userId, questionId: missedReturnDismissed.questionId })
    .from(missedReturnDismissed)
    .where(isNull(missedReturnDismissed.reinstatedAt));
  const existingKeys = new Set(existing.map((r) => `${r.userId}::${r.questionId}`));

  const toInsert = [...byKey.values()].filter(
    (p) => liveQuestionIds.has(p.questionId) && !existingKeys.has(keyOf(p)),
  );

  const orphaned = [...byKey.values()].filter((p) => !liveQuestionIds.has(p.questionId));

  console.log('--- MissedReturnDismissed backfill ---');
  console.log(`Daily slot-level dismisses (canonical only): ${dailyPairs.length}`);
  console.log(`Feed dismisses (resolved, no answer):        ${feedPairs.length}`);
  console.log(`Distinct (user, question) pairs:             ${byKey.size}`);
  console.log(`  already present (active row):              ${byKey.size - toInsert.length - orphaned.length}`);
  console.log(`  skipped, question row is gone:             ${orphaned.length}`);
  console.log(`  TO INSERT:                                 ${toInsert.length}`);
  console.log(`Distinct users affected:                     ${new Set(toInsert.map((p) => p.userId)).size}`);
  console.log('');
  console.log(
    'NOTE: feed rows are filtered to those with NO answer evidence. FeedItem.catchupResolvedAt',
  );
  console.log(
    'is also stamped by the catch-up ANSWER path, so it is not a dismiss marker on its own',
  );
  console.log('(see the header). A count above 0 here is unusual — inspect before applying.');

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to write these rows.');
    return;
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    await db
      .insert(missedReturnDismissed)
      .values(chunk.map((p) => ({ userId: p.userId, questionId: p.questionId })))
      .onConflictDoNothing();
    inserted += chunk.length;
    console.log(`  inserted ${inserted}/${toInsert.length}`);
  }
  console.log(`\n✓ Backfill complete — ${inserted} rows written.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
