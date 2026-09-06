import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db, pool, users, generatedQuestions, dailyQueues } from '../src/server/db';
import {
  persistDailyQueue,
  createDailyQueueItemFromPresence,
  buildPresenceSlot,
} from '../src/server/db/queries/daily';
import { getDailyAssignmentBounds } from '../src/lib/games/timezone';
import { asQueueSlots } from '../src/server/daily/catchup';
import type { QueueSlot } from '../src/server/daily/types';

// Live-DB reproduction of diagnosis/daily-build-latency-deferral-plan.md's
// open question 5: build `123cd09b-b28b-4760-809b-537d45b9884d` recorded
// `final_size: 5` but its persisted queue had only 3 real core slots, with
// bonus questions sitting at slot_index 3 and 4 -- positions that should not
// have been available to the append given 5 real core slots.
//
// HYPOTHESIS, derived by reading (not yet proven): two concurrent builds for
// the SAME user+date. `persistDailyQueue`'s initial insert is race-safe
// (`onConflictDoNothing` keyed on user_id+queue_date) -- but its RETURN VALUE,
// which tells the caller whether its own insert won or lost, is discarded at
// every call site in queue-orchestrator.ts. A build that loses the insert race
// has no way of knowing it lost, and its deferred bonus tail proceeds to call
// `createDailyQueueItemFromPresence` using ITS OWN (losing) core count as the
// append position. That function does a naive
// `filter(slot_index !== position) + append`, re-reading whatever the CURRENT
// persisted queue is -- which is now the WINNING build's queue, not the
// loser's. If the loser's position happens to fall inside the winner's real
// core range, the append silently DESTROYS a real core question and replaces
// it with a bonus one.
//
// This script reproduces that sequence deterministically (no timing/race
// needed -- the outcome of `onConflictDoNothing` depends only on call order,
// not on real concurrency) against the real functions and the real DB:
//
//   1. "Build WIN": 5 real core slots, wins the insert.
//   2. "Build LOSE": 3 real core slots, loses the insert (onConflictDoNothing
//      no-ops it) -- exactly as queue-orchestrator.ts's discarded return value
//      means neither build would ever notice.
//   3. Build LOSE's deferred tail appends 2 bonus slots using ITS OWN core
//      count (3) as the starting position -- oblivious to having lost.
//   4. Assert on the FINAL persisted queue: does it match the diagnosis doc's
//      description exactly (5 slots total, bonus at index 3 and 4, and --
//      the actual damage -- two of WIN's five real core questions are GONE)?
//
// Idempotent + self-cleaning: every seeded row is namespaced by a unique run
// id and removed in `finally`, even on assertion failure. Touches only rows
// this script creates. Usage:  npx tsx scripts/build-latency-anomaly.verify.ts

const RUN = `latency-anomaly-${randomUUID().slice(0, 8)}`;
const id = (label: string) => `${RUN}-${label}`;
const phone = () => `+1999${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

const USER = id('user');
const DOMAIN = `verify_${RUN}`;

async function seedGeneratedQuestion(label: string, index: number) {
  const [row] = await db
    .insert(generatedQuestions)
    .values({
      userId: USER,
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

async function main() {
  await db.insert(users).values({
    id: USER,
    phoneNumber: phone(),
    displayName: `${RUN} user`,
  });

  const { assignmentDateStr } = getDailyAssignmentBounds();
  console.log(`Assignment date: ${assignmentDateStr}`);

  // ---- Step 1: Build WIN generates 5 real core questions and persists. ----
  const winQuestions = [];
  for (let i = 0; i < 5; i++) winQuestions.push(await seedGeneratedQuestion('win', i));
  const winSlots: QueueSlot[] = winQuestions.map((q, i) => coreSlot(i, q.id, 'WIN'));

  const winResult = await persistDailyQueue(
    USER,
    winSlots,
    winQuestions.map((q) => q.id),
  );
  assert.ok(winResult, 'Build WIN insert should succeed (nothing else exists yet)');
  console.log(`Build WIN persisted: ${asQueueSlots(winResult!.slots).length} slots`);

  // ---- Step 2: Build LOSE generates 3 real core questions, attempts to ----
  // persist. Its INSERT is a no-op (onConflictDoNothing) since WIN already
  // holds the row for this user+date. `persistDailyQueue` correctly hands
  // back WIN's row -- but exactly like every call site in
  // queue-orchestrator.ts, this reproduction now DISCARDS that return value,
  // because that discard is the bug under test.
  const loseQuestions = [];
  for (let i = 0; i < 3; i++) loseQuestions.push(await seedGeneratedQuestion('lose', i));
  const loseSlots: QueueSlot[] = loseQuestions.map((q, i) => coreSlot(i, q.id, 'LOSE'));

  const loseResult = await persistDailyQueue(
    USER,
    loseSlots,
    loseQuestions.map((q) => q.id),
  );
  // persistDailyQueue's own contract already proves the insert-safety half:
  // it correctly reports WIN's row, not a fabricated success for LOSE.
  assert.equal(loseResult!.id, winResult!.id, 'LOSE\'s insert must have no-op\'d onto WIN\'s row');
  assert.equal(
    asQueueSlots(loseResult!.slots).length,
    5,
    'persistDailyQueue correctly returns the WINNING queue on conflict -- the row is not corrupted at THIS call. The question is what the caller does next.',
  );
  console.log(
    `Build LOSE's persist no-op'd correctly (persistDailyQueue returned WIN's ${asQueueSlots(loseResult!.slots).length}-slot row) -- but its return value is unused in production, exactly as at every call site in queue-orchestrator.ts.`,
  );

  // ---- Step 3: Build LOSE's deferred bonus tail runs anyway, using ITS ----
  // OWN local slot count (3) as the append position -- oblivious to having
  // lost the persist race, because nothing told it.
  const bonusQuestions = [
    await seedGeneratedQuestion('lose-bonus', 0),
    await seedGeneratedQuestion('lose-bonus', 1),
  ];
  let position = loseSlots.length; // = 3, Build LOSE's own (losing) core count
  for (const q of bonusQuestions) {
    const slot = buildPresenceSlot(
      { id: q.id, questionText: q.questionText, canonicalSubcategory: q.canonicalSubcategory, broadCategory: q.broadCategory, difficultyEstimate: q.difficultyEstimate },
      { sourceId: id('friend'), sourceName: 'Friend', extraCount: 0 },
      position,
    );
    await createDailyQueueItemFromPresence(USER, q.id, { sourceId: slot.presence_source_id!, sourceName: slot.presence_source_name ?? null, extraCount: 0 }, position);
    position += 1;
  }

  // ---- Step 4: inspect the damage. ----
  const [finalRow] = await db.select().from(dailyQueues).where(eq(dailyQueues.userId, USER)).limit(1);
  const finalSlots = asQueueSlots(finalRow!.slots).sort((a, b) => a.slot_index - b.slot_index);

  console.log('\n=== Final persisted queue ===');
  for (const s of finalSlots) {
    const isBonus = Boolean(s.presence_source_id);
    const owner = s.question_text.includes('WIN') ? 'WIN' : s.question_text.includes('LOSE') ? 'LOSE-bonus' : '?';
    console.log(`  slot_index ${s.slot_index}  ${isBonus ? 'BONUS' : 'core '}  (${owner})  gen_question_id=${s.generated_question_id}`);
  }

  const bonusIndices = finalSlots.filter((s) => s.presence_source_id).map((s) => s.slot_index);
  const survivingWinIds = new Set(finalSlots.filter((s) => !s.presence_source_id).map((s) => s.generated_question_id));
  const winIds = new Set(winQuestions.map((q) => q.id));
  const destroyedWinCount = [...winIds].filter((wid) => !survivingWinIds.has(wid)).length;

  console.log(`\nTotal slots: ${finalSlots.length} (diagnosis doc observed: 5)`);
  console.log(`Bonus slot indices: [${bonusIndices.join(', ')}] (diagnosis doc observed: [3, 4])`);
  console.log(`WIN's real core questions destroyed: ${destroyedWinCount} of 5 (diagnosis doc observed: 2, since only 3 of 5 survived)`);

  const reproduced =
    finalSlots.length === 5 &&
    JSON.stringify(bonusIndices) === JSON.stringify([3, 4]) &&
    destroyedWinCount === 2;

  console.log(`\n${reproduced ? 'REPRODUCED' : 'NOT REPRODUCED'}: this ${reproduced ? 'matches' : 'does not match'} the diagnosis doc's exact observation.`);

  if (reproduced) {
    console.log(
      '\nRoot cause confirmed: persistDailyQueue\'s onConflictDoNothing return value is\n' +
      'discarded at every call site. A build that loses the insert race has no way to\n' +
      'know, and its deferred bonus tail appends at positions computed from its own\n' +
      '(losing, discarded) core count -- landing inside the WINNING build\'s real core\n' +
      'range and silently destroying whichever real questions sat there.',
    );
  }

  assert.ok(reproduced, 'Expected the exact anomaly shape from the diagnosis doc');
}

main()
  .then(() => console.log('\nPASS'))
  .catch((error) => {
    console.error('\nFAIL:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Self-cleaning: remove every row this run created, regardless of outcome.
    await db.delete(dailyQueues).where(eq(dailyQueues.userId, USER)).catch(() => {});
    await db.delete(generatedQuestions).where(eq(generatedQuestions.userId, USER)).catch(() => {});
    await db.delete(users).where(eq(users.id, USER)).catch(() => {});
    await pool.end().catch(() => {});
  });
