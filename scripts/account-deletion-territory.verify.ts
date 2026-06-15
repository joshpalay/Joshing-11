import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import {
  db,
  pool,
  users,
  questions,
  masteryEvents,
  feedItems,
  userQuestionBank,
  contentReports,
} from '../src/server/db';
import { deleteUserAccount } from '../src/server/db/queries/account';

// Live-DB conformance run for D-ACCOUNT-DELETION-TERRITORY-01 (the 🔁 re-audit
// gate). The query test suite is DB-mocked and cannot exercise the raw-SQL
// transaction in deleteUserAccount; this seeds the territory scenario against a
// REAL database, deletes the author, and asserts the ratified behavior:
//
//   #1 a retained answerer's proven-territory MASTERY_EVENTS survive.
//   #2 each authored question a retained user depends on is TOMBSTONED
//      (creator_id NULL, source 'house_authored', author_deleted true, content +
//      asked/correct counts retained) — never hard-deleted.
//   B  an authored question with NO retained dependency hard-deletes.
//   B  a friend's bank save is a retained dependency → that question tombstones.
//   #3 the departed author's author_credit events are removed.
//   #4 the departed author's own proven events are removed.
//   C  a retained event that named the author as answerer keeps the fact, loses
//      the name (answered_by_user_id nulled).
//   D  a feed actor card the author sourced onto a retained feed is stripped; a
//      retained card pointing at a tombstoned question survives.
//   ContentReport: the author's own + reports targeting a vanishing question are
//      deleted (one_target CHECK forbids nulling the target); a report targeting
//      a surviving tombstone is preserved.
//
// Idempotent + self-cleaning: every seeded row is namespaced by a unique run id
// and removed in `finally`, even on assertion failure. Read-only to all other
// data. Usage:  npx tsx scripts/account-deletion-territory.verify.ts

const RUN = `acctdel-${randomUUID().slice(0, 8)}`;
const id = (label: string) => `${RUN}-${label}`;
let phoneSeq = 0;
const phone = () => `+1999${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(2, '0')}`;

// Stable ids so seeding, assertions, and cleanup all reference the same rows.
const AUTHOR = id('author'); // deletes their account
const ANSWERER = id('answerer'); // retained — must keep proven territory
const FRIEND = id('friend'); // retained — banked one of the author's questions
const Q_TOMB = id('q-tomb'); // authored by AUTHOR, answered by ANSWERER → tombstone
const Q_ORPHAN = id('q-orphan'); // authored by AUTHOR, no retained dep → hard-delete
const Q_BANK = id('q-bank'); // authored by AUTHOR, banked by FRIEND → tombstone
const Q_BY_R = id('q-by-r'); // authored by ANSWERER → survives untouched
const DOMAIN = `verify_${RUN}`;

const ME_RETAINED = id('me-retained'); // ANSWERER proven on Q_TOMB (#1, survives)
const ME_AUTHOR_OWN = id('me-author-own'); // AUTHOR proven on Q_ORPHAN (#4, deleted)
const ME_AUTHOR_CREDIT = id('me-author-credit'); // AUTHOR credit (#3, deleted)
const ME_RETAINED_NAMED = id('me-retained-named'); // ANSWERER credit, answered_by=AUTHOR (C)

const FI_ACTOR = id('fi-actor'); // sourced by AUTHOR onto ANSWERER feed (D, stripped)
const FI_SURVIVE = id('fi-survive'); // ANSWERER feed, sourced by FRIEND, q=Q_TOMB (survives)

const CR_OWN = id('cr-own'); // by AUTHOR (deleted)
const CR_ORPHAN_TARGET = id('cr-orphan'); // by ANSWERER targeting Q_ORPHAN (deleted)
const CR_TOMB_TARGET = id('cr-tomb'); // by ANSWERER targeting Q_TOMB (preserved)

async function seed() {
  await db.insert(users).values([
    { id: AUTHOR, phoneNumber: phone(), displayName: `Author ${RUN}` },
    { id: ANSWERER, phoneNumber: phone(), displayName: `Answerer ${RUN}` },
    { id: FRIEND, phoneNumber: phone(), displayName: `Friend ${RUN}` },
  ]);

  const baseQ = {
    source: 'authored' as const,
    questionText: `verify question ${RUN}`,
    answerText: 'answer',
    canonicalSubcategory: DOMAIN,
    difficultyEstimate: 'moderate' as const,
    askedCount: 7,
    correctCount: 4,
  };
  await db.insert(questions).values([
    { ...baseQ, id: Q_TOMB, creatorId: AUTHOR },
    { ...baseQ, id: Q_ORPHAN, creatorId: AUTHOR },
    { ...baseQ, id: Q_BANK, creatorId: AUTHOR },
    { ...baseQ, id: Q_BY_R, creatorId: ANSWERER },
  ]);

  await db.insert(masteryEvents).values([
    // #1 — retained answerer's proven territory off the author's question.
    {
      id: ME_RETAINED, userId: ANSWERER, canonicalSubcategory: DOMAIN,
      sourceType: 'live_correct', questionId: Q_TOMB, answeredByUserId: ANSWERER,
      basePoints: 50, weight: 1, awardedPoints: 50, answerState: 'first_correct',
    },
    // #4 — the author's OWN proven event.
    {
      id: ME_AUTHOR_OWN, userId: AUTHOR, canonicalSubcategory: DOMAIN,
      sourceType: 'live_correct', questionId: Q_ORPHAN, answeredByUserId: AUTHOR,
      basePoints: 50, weight: 1, awardedPoints: 50, answerState: 'first_correct',
    },
    // #3 — author credit accrued TO the departing author.
    {
      id: ME_AUTHOR_CREDIT, userId: AUTHOR, canonicalSubcategory: DOMAIN,
      sourceType: 'author_credit', questionId: Q_TOMB, answeredByUserId: ANSWERER,
      basePoints: 50, weight: 1, awardedPoints: 50,
    },
    // C — a retained answerer's credit row that NAMES the author as the answerer.
    {
      id: ME_RETAINED_NAMED, userId: ANSWERER, canonicalSubcategory: DOMAIN,
      sourceType: 'author_credit', questionId: Q_BY_R, answeredByUserId: AUTHOR,
      basePoints: 50, weight: 1, awardedPoints: 50,
    },
  ]);

  // B — FRIEND banked one of the author's questions → retained dependency.
  await db.insert(userQuestionBank).values({ id: id('bank'), userId: FRIEND, questionId: Q_BANK });

  await db.insert(feedItems).values([
    // D — actor card the author sourced onto the answerer's feed → stripped.
    { id: FI_ACTOR, recipientUserId: ANSWERER, sourceUserId: AUTHOR, sourceType: 'friend_answered', questionId: Q_BY_R },
    // D — retained card pointing at the tombstoned question → survives.
    { id: FI_SURVIVE, recipientUserId: ANSWERER, sourceUserId: FRIEND, sourceType: 'friend_answered', questionId: Q_TOMB },
  ]);

  await db.insert(contentReports).values([
    { id: CR_OWN, reporterUserId: AUTHOR, questionId: Q_BY_R, category: 'inappropriate', note: 'x' },
    { id: CR_ORPHAN_TARGET, reporterUserId: ANSWERER, questionId: Q_ORPHAN, category: 'inappropriate', note: 'x' },
    { id: CR_TOMB_TARGET, reporterUserId: ANSWERER, questionId: Q_TOMB, category: 'inappropriate', note: 'x' },
  ]);
}

async function questionRow(qid: string) {
  const [row] = await db.select().from(questions).where(eq(questions.id, qid)).limit(1);
  return row;
}
async function exists(table: typeof users | typeof masteryEvents | typeof feedItems | typeof contentReports, rowId: string) {
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, rowId)).limit(1);
  return Boolean(row);
}

async function verify() {
  await deleteUserAccount(AUTHOR);

  // #4 — the author and all their own rows are gone.
  assert.equal(await exists(users, AUTHOR), false, 'author user should be hard-deleted');
  assert.equal(await exists(masteryEvents, ME_AUTHOR_OWN), false, '#4 author proven event should be deleted');
  assert.equal(await exists(masteryEvents, ME_AUTHOR_CREDIT), false, '#3 author_credit event should be deleted');

  // Retained users untouched.
  assert.equal(await exists(users, ANSWERER), true, 'answerer should be retained');
  assert.equal(await exists(users, FRIEND), true, 'friend should be retained');

  // #1 — the retained answerer's proven territory survives.
  assert.equal(await exists(masteryEvents, ME_RETAINED), true, '#1 retained proven event must survive');

  // C — the retained credit row survives, but the author name is degraded out.
  const [named] = await db.select().from(masteryEvents).where(eq(masteryEvents.id, ME_RETAINED_NAMED)).limit(1);
  assert.ok(named, 'C retained named event must survive');
  assert.equal(named.answeredByUserId, null, 'C answered_by_user_id naming the author must be nulled');

  // #2 / A1 — Q_TOMB tombstoned: re-sourced to house, content + counts retained.
  const tomb = await questionRow(Q_TOMB);
  assert.ok(tomb, 'A1 tombstoned question must persist');
  assert.equal(tomb.creatorId, null, 'A1 creator_id must be nulled');
  assert.equal(tomb.source, 'house_authored', "A1 source must become 'house_authored'");
  assert.equal(tomb.authorDeleted, true, 'A1 author_deleted must be true');
  assert.equal(tomb.questionText, `verify question ${RUN}`, 'A1 content must be retained');
  assert.equal(tomb.askedCount, 7, 'A1 asked_count must be retained for calibration');
  assert.equal(tomb.correctCount, 4, 'A1 correct_count must be retained for calibration');

  // B — a banked question is a retained dependency → also tombstoned, bank kept.
  const bank = await questionRow(Q_BANK);
  assert.ok(bank, 'B banked question must persist as tombstone');
  assert.equal(bank.creatorId, null, 'B banked question creator_id nulled');
  assert.equal(bank.authorDeleted, true, 'B banked question author_deleted true');
  const [bankRow] = await db.select().from(userQuestionBank).where(
    and(eq(userQuestionBank.userId, FRIEND), eq(userQuestionBank.questionId, Q_BANK)),
  ).limit(1);
  assert.ok(bankRow, "B friend's bank save must be preserved");

  // B — Q_ORPHAN (no retained dependency) is hard-deleted.
  assert.equal(await questionRow(Q_ORPHAN), undefined, 'B orphan question must be hard-deleted');

  // The answerer's own authored question is untouched.
  const byR = await questionRow(Q_BY_R);
  assert.ok(byR, "answerer's own question must survive");
  assert.equal(byR.creatorId, ANSWERER, "answerer's question creator_id unchanged");

  // D — actor card stripped; retained card pointing at the tombstone survives.
  assert.equal(await exists(feedItems, FI_ACTOR), false, 'D author-sourced actor card must be stripped');
  assert.equal(await exists(feedItems, FI_SURVIVE), true, 'D retained card on tombstone must survive');

  // ContentReport — own + vanishing-target deleted; surviving-target preserved.
  assert.equal(await exists(contentReports, CR_OWN), false, "author's own report must be deleted");
  assert.equal(await exists(contentReports, CR_ORPHAN_TARGET), false, 'report targeting orphan question must be deleted');
  assert.equal(await exists(contentReports, CR_TOMB_TARGET), true, 'report targeting tombstone must be preserved');

  console.log(`[${RUN}] PASS — all D-ACCOUNT-DELETION-TERRITORY-01 conformance assertions held.`);
}

async function cleanup() {
  // FK-safe order. AUTHOR + its rows are already gone via deleteUserAccount on
  // the happy path; these run regardless so a mid-test failure still cleans up.
  const allQuestionIds = [Q_TOMB, Q_ORPHAN, Q_BANK, Q_BY_R];
  const allUserIds = [AUTHOR, ANSWERER, FRIEND];
  await db.delete(contentReports).where(inArray(contentReports.questionId, allQuestionIds));
  await db.delete(contentReports).where(inArray(contentReports.reporterUserId, allUserIds));
  await db.delete(feedItems).where(inArray(feedItems.recipientUserId, allUserIds));
  await db.delete(feedItems).where(inArray(feedItems.sourceUserId, allUserIds));
  await db.delete(userQuestionBank).where(inArray(userQuestionBank.userId, allUserIds));
  await db.delete(masteryEvents).where(inArray(masteryEvents.userId, allUserIds));
  await db.delete(masteryEvents).where(inArray(masteryEvents.questionId, allQuestionIds));
  await db.delete(questions).where(inArray(questions.id, allQuestionIds));
  await db.delete(users).where(inArray(users.id, allUserIds));
}

async function main() {
  try {
    await seed();
    await verify();
  } finally {
    await cleanup();
  }
}

main()
  .catch((err) => {
    console.error(`[${RUN}] FAIL`, err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
