import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db, pool, users, generatedQuestions, dailyQueues } from '../src/server/db';
import { persistDailyQueue, createDailyQueueItemFromPresence } from '../src/server/db/queries/daily';
import { asQueueSlots } from '../src/server/daily/catchup';
import type { QueueSlot } from '../src/server/daily/types';

// Live-DB reproduction AND fix-verification for
// diagnosis/daily-build-latency-deferral-plan.md's open question 5: build
// `123cd09b-b28b-4760-809b-537d45b9884d` recorded `final_size: 5` but its
// persisted queue had only 3 real core slots, with bonus questions sitting at
// slot_index 3 and 4 -- positions that should not have been available given 5
// real core slots.
//
// ROOT CAUSE, CONFIRMED (see Scenario A): two builds racing to persist the
// same user+date. `persistDailyQueue`'s insert itself is race-safe
// (`onConflictDoNothing` keyed on user_id+queue_date) -- but its return value,
// which says whether THIS call's insert won or lost, used to be discarded at
// every call site in queue-orchestrator.ts. A build that lost had no way to
// know, and its deferred bonus tail proceeded to call
// `createDailyQueueItemFromPresence` using ITS OWN (losing) core count as the
// append position. That function does a naive
// `filter(slot_index !== position) + append` against whatever queue is
// CURRENTLY persisted -- now the WINNER's -- so a losing position that landed
// inside the winner's real core range silently destroyed real questions there.
//
// THE FIX: persistDailyQueue now returns `{ row, won } | null`
// (src/server/db/queries/daily.ts). queue-orchestrator.ts checks `won` and
// bails BEFORE the deferred tail on a loss -- see Scenario B.
//
// Both scenarios are deterministic by construction (call order alone decides
// who wins `onConflictDoNothing`; no real timing race is needed to prove
// either the damage or the fix). Idempotent + self-cleaning: every seeded row
// is namespaced by a unique run id and removed in `finally`, even on
// assertion failure. Touches only rows this script creates.
//
// Usage: npx tsx scripts/build-latency-anomaly.verify.ts

const RUN = `latency-anomaly-${randomUUID().slice(0, 8)}`;
const id = (label: string) => `${RUN}-${label}`;
const phone = () =>
  `+1999${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

const DOMAIN = `verify_${RUN}`;
const ALL_USER_IDS: string[] = [];

async function seedUser(label: string): Promise<string> {
  const userId = id(label);
  await db.insert(users).values({ id: userId, phoneNumber: phone(), displayName: `${RUN} ${label}` });
  ALL_USER_IDS.push(userId);
  return userId;
}

async function seedGeneratedQuestion(userId: string, label: string, index: number) {
  const [row] = await db
    .insert(generatedQuestions)
    .values({
      userId,
      canonicalSubcategory: DOMAIN,
      broadCategory: 'General Knowledge',
      questionText: `[${RUN}] ${label} question ${index}`,
      answer: `answer-${index}`,
      explainer: 'test fixture',
      difficultyEstimate: 'accessible',
      basePoints: 10,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();
  return row;
}

function coreSlot(index: number, questionId: string, label: string): QueueSlot {
  return {
    slot_index: index,
    source: 'bot',
    generated_question_id: questionId,
    domain: DOMAIN,
    broad_category: 'General Knowledge',
    category: null,
    question_text: `[${RUN}] ${label} core question ${index}`,
    answered: false,
    difficulty_stepped_up: false,
  };
}

async function appendBonus(userId: string, questionId: string, questionText: string, position: number) {
  await createDailyQueueItemFromPresence(
    userId,
    questionId,
    { sourceId: id('friend'), sourceName: 'Friend', extraCount: 0 },
    position,
  );
  void questionText; // kept for signature symmetry with buildPresenceSlot's inputs
}

async function scenarioA_unchecked(): Promise<void> {
  console.log('\n=== Scenario A: unchecked return value (the historical bug) ===');
  const USER = await seedUser('a-user');

  // ---- Build WIN generates 5 real core questions and persists. ----
  const winQuestions = [];
  for (let i = 0; i < 5; i++) winQuestions.push(await seedGeneratedQuestion(USER, 'win', i));
  const winSlots: QueueSlot[] = winQuestions.map((q, i) => coreSlot(i, q.id, 'WIN'));

  const winResult = await persistDailyQueue(
    USER,
    winSlots,
    winQuestions.map((q) => q.id),
  );
  assert.ok(winResult, 'Build WIN insert should succeed (nothing else exists yet)');
  assert.equal(winResult!.won, true, 'Build WIN should be reported as the winner');
  console.log(`Build WIN persisted: ${asQueueSlots(winResult!.row.slots).length} slots, won=${winResult!.won}`);

  // ---- Build LOSE generates 3 real core questions, attempts to persist. ----
  // Its INSERT is a no-op (onConflictDoNothing) since WIN already holds the
  // row for this user+date. persistDailyQueue correctly reports won=false --
  // this scenario now deliberately IGNORES that signal, reproducing exactly
  // what every call site in queue-orchestrator.ts used to do.
  const loseQuestions = [];
  for (let i = 0; i < 3; i++) loseQuestions.push(await seedGeneratedQuestion(USER, 'lose', i));
  const loseSlots: QueueSlot[] = loseQuestions.map((q, i) => coreSlot(i, q.id, 'LOSE'));

  const loseResult = await persistDailyQueue(
    USER,
    loseSlots,
    loseQuestions.map((q) => q.id),
  );
  assert.equal(loseResult!.won, false, 'Build LOSE must be correctly reported as the loser');
  assert.equal(loseResult!.row.id, winResult!.row.id, "LOSE's insert must have no-op'd onto WIN's row");
  assert.equal(
    asQueueSlots(loseResult!.row.slots).length,
    5,
    'persistDailyQueue correctly returns the WINNING queue on conflict -- the row is not corrupted at THIS call. The question is what an UNCHECKED caller does next.',
  );
  console.log(
    `Build LOSE's persist correctly reported won=${loseResult!.won} (row is WIN's ${asQueueSlots(loseResult!.row.slots).length}-slot queue) -- this scenario now discards that signal on purpose, exactly as production used to.`,
  );

  // ---- Build LOSE's deferred bonus tail runs anyway, ignoring `won`, ----
  // using ITS OWN local slot count (3) as the append position.
  const bonusQuestions = [
    await seedGeneratedQuestion(USER, 'lose-bonus', 0),
    await seedGeneratedQuestion(USER, 'lose-bonus', 1),
  ];
  let position = loseSlots.length; // = 3, Build LOSE's own (losing) core count
  for (const q of bonusQuestions) {
    await appendBonus(USER, q.id, q.questionText, position);
    position += 1;
  }

  // ---- Inspect the damage. ----
  const [finalRow] = await db.select().from(dailyQueues).where(eq(dailyQueues.userId, USER)).limit(1);
  const finalSlots = asQueueSlots(finalRow!.slots).sort((a, b) => a.slot_index - b.slot_index);

  console.log('\nFinal persisted queue:');
  for (const s of finalSlots) {
    const isBonus = Boolean(s.presence_source_id);
    console.log(`  slot_index ${s.slot_index}  ${isBonus ? 'BONUS' : 'core '}  gen_question_id=${s.generated_question_id}`);
  }

  const bonusIndices = finalSlots.filter((s) => s.presence_source_id).map((s) => s.slot_index);
  const survivingWinIds = new Set(finalSlots.filter((s) => !s.presence_source_id).map((s) => s.generated_question_id));
  const winIds = new Set(winQuestions.map((q) => q.id));
  const destroyedWinCount = [...winIds].filter((wid) => !survivingWinIds.has(wid)).length;

  console.log(`\nTotal slots: ${finalSlots.length} (diagnosis doc observed: 5)`);
  console.log(`Bonus slot indices: [${bonusIndices.join(', ')}] (diagnosis doc observed: [3, 4])`);
  console.log(`WIN's real core questions destroyed: ${destroyedWinCount} of 5 (diagnosis doc observed: 2)`);

  const reproduced =
    finalSlots.length === 5 &&
    JSON.stringify(bonusIndices) === JSON.stringify([3, 4]) &&
    destroyedWinCount === 2;

  console.log(`${reproduced ? 'REPRODUCED' : 'NOT REPRODUCED'}: this ${reproduced ? 'matches' : 'does not match'} the diagnosis doc's exact observation.`);
  assert.ok(reproduced, 'Expected the exact anomaly shape from the diagnosis doc when the return value is ignored');
}

async function scenarioB_checked(): Promise<void> {
  console.log('\n=== Scenario B: checked return value (the fix) ===');
  const USER = await seedUser('b-user');

  // ---- Build WIN, same as Scenario A. ----
  const winQuestions = [];
  for (let i = 0; i < 5; i++) winQuestions.push(await seedGeneratedQuestion(USER, 'win', i));
  const winSlots: QueueSlot[] = winQuestions.map((q, i) => coreSlot(i, q.id, 'WIN'));
  const winResult = await persistDailyQueue(
    USER,
    winSlots,
    winQuestions.map((q) => q.id),
  );
  assert.ok(winResult?.won, 'Build WIN should win');

  // ---- Build LOSE, same setup, but THIS TIME the caller checks `won` -- ----
  // exactly what queue-orchestrator.ts now does -- and skips the deferred
  // bonus tail entirely rather than appending against a stale position.
  const loseQuestions = [];
  for (let i = 0; i < 3; i++) loseQuestions.push(await seedGeneratedQuestion(USER, 'lose', i));
  const loseSlots: QueueSlot[] = loseQuestions.map((q, i) => coreSlot(i, q.id, 'LOSE'));
  const loseResult = await persistDailyQueue(
    USER,
    loseSlots,
    loseQuestions.map((q) => q.id),
  );
  assert.equal(loseResult!.won, false, 'Build LOSE should lose');

  if (!loseResult!.won) {
    console.log('Build LOSE correctly detected won=false -- skipping the deferred bonus append entirely.');
    // This is the fix. No appendBonus call happens here at all.
  }

  // ---- Inspect: WIN's queue must be completely untouched. ----
  const [finalRow] = await db.select().from(dailyQueues).where(eq(dailyQueues.userId, USER)).limit(1);
  const finalSlots = asQueueSlots(finalRow!.slots).sort((a, b) => a.slot_index - b.slot_index);

  console.log('\nFinal persisted queue:');
  for (const s of finalSlots) {
    console.log(`  slot_index ${s.slot_index}  core   gen_question_id=${s.generated_question_id}`);
  }

  const winIds = new Set(winQuestions.map((q) => q.id));
  const survivingWinIds = new Set(finalSlots.map((s) => s.generated_question_id));
  const destroyedWinCount = [...winIds].filter((wid) => !survivingWinIds.has(wid)).length;
  const bonusCount = finalSlots.filter((s) => s.presence_source_id).length;

  console.log(`\nTotal slots: ${finalSlots.length} (expected: 5, all WIN's)`);
  console.log(`WIN's real core questions destroyed: ${destroyedWinCount} of 5 (expected: 0)`);
  console.log(`Bonus slots appended by the loser: ${bonusCount} (expected: 0)`);

  assert.equal(finalSlots.length, 5, "WIN's queue must be exactly 5 slots, untouched");
  assert.equal(destroyedWinCount, 0, "None of WIN's real questions may be destroyed when the loser checks `won`");
  assert.equal(bonusCount, 0, 'The loser must not append anything when it correctly detects it lost');

  console.log('FIX VERIFIED: checking `won` and skipping the deferred tail on a loss leaves the winner intact.');
}

async function main() {
  await scenarioA_unchecked();
  await scenarioB_checked();
}

main()
  .then(() => console.log('\nPASS'))
  .catch((error) => {
    console.error('\nFAIL:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Self-cleaning: remove every row either scenario created, regardless of
    // outcome.
    for (const userId of ALL_USER_IDS) {
      await db.delete(dailyQueues).where(eq(dailyQueues.userId, userId)).catch(() => {});
      await db.delete(generatedQuestions).where(eq(generatedQuestions.userId, userId)).catch(() => {});
      await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    }
    await pool.end().catch(() => {});
  });
