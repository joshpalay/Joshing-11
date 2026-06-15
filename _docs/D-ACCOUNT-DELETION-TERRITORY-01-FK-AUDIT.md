# Account-deletion territory — FK inventory & conformance audit

**Audit ID:** D-ACCOUNT-DELETION-TERRITORY-01 (audit stage)
**Date:** 2026-06-15
**Scope:** every foreign key that points at `User` (`users.id`) or `Question`
(`questions.id`), its **live** `onDelete` behavior in the Drizzle schema, and the
disposition each must take so a retained user never loses proven territory when
another user deletes their account.
**Method:** read live `src/server/db/schema.ts` (not the PRD SQL), plus
`src/server/mastery/scoring.ts`, `src/server/db/queries/knowledge.ts`,
`src/server/daily/empirical-difficulty.ts`, `src/lib/questions-types.ts`,
`src/components/knowledge/SharePortraitCard.tsx`,
`src/server/db/queries/lately.ts`.

> Status: **research only.** No schema, query, or endpoint was changed. This
> captures the FK inventory and resolves the code-answerable sub-questions so the
> A–E product forks can be ratified informed. The deletion endpoint and any
> migration remain blocked until A–E are Settled (per the spec's DO-NOT list).

---

## Headline finding — the current posture is "deletion blocked," not "silent cascade"

The territory-critical FKs all carry **no `onDelete`** clause, i.e. Postgres
default `NO ACTION` (RESTRICT-equivalent):

- `questions.creator_id → users.id` — no onDelete
- `MASTERY_EVENTS.user_id → users.id` — no onDelete
- `MASTERY_EVENTS.question_id → questions.id` — no onDelete
- `playerMastery.user_id → users.id` — no onDelete
- `FeedItem.sourceUserId → users.id` — no onDelete
- `FeedItem.questionId → questions.id` — no onDelete

Consequence: a raw `DELETE FROM "User" WHERE id = …` **fails** with an FK
violation. It does not silently cascade away a third party's territory. The
198-question / 83-mastery-event loss in the test cleanup came from the **manual
ordered transaction** that deleted dependents first — it was application code,
not FK cascade.

**Implication for the build:** the production deletion path must be an
**application-level routine** that (a) tombstones questions with retained-user
dependencies and (b) selectively deletes the departed user's own rows. It must
**not** be implemented by adding `ON DELETE CASCADE` along
`User → Question → MASTERY_EVENTS` — the spec's central prohibition — because that
would re-introduce exactly the third-party-territory-confiscation failure the
RESTRICT FKs currently prevent.

---

## Tombstone infrastructure already exists (D-3)

The house/editorial author identity the spec asks about in sub-question 1 is
already shipped (`PRD-D-3`, Settled in `DECISIONS.md`):

- `src/lib/questions-types.ts`: `QUESTION_SOURCES = ['authored', 'daily_generated', 'curated_sent', 'house_authored']`; `HOUSE = { id: 'house', kind: 'house', … }`.
- **Invariant H-1:** `id:'house'` is **never** used as a `users.id` FK; house is
  resolved at render and **never renders as a person** (`resolveAuthorDisplay`
  → `'Joshing'`, asserted by `questions-types.test.ts`).
- `Question` already has `creator_id` **nullable** and a `deleted_at` soft-delete
  column. House questions today are exactly `creator_id = NULL` + `source = 'house_authored'`.

So the tombstone sink (null author + non-person house source + existing
soft-delete column) is already in the schema. What is **not** present: a way to
distinguish a *tombstoned-former-author* question from a *genuine house* question
(no `author_deleted` boolean today) — this is the open product call in
sub-question 1.

---

## FK inventory — every FK → `User` (`users.id`)

`D` = disposition under the proposed model (#1 preserve answerer evidence,
#2 tombstone authored content, #3 remove author credit, #4 hard-delete the
departed user's own data).

| Table.column | DB table | live `onDelete` | nullable | Disposition (D) |
|---|---|---|---|---|
| `userSessions.user_id` | `UserSession` | none (RESTRICT) | no | **delete** (own) |
| `questions.creator_id` | `Question` | none (RESTRICT) | **yes** | **null → house** (tombstone #2) |
| `userQuestionBank.user_id` | `UserQuestionBank` | none | no | **delete** (own saves) |
| `playerMastery.user_id` | `PLAYER_MASTERY` | none | no | **delete** (own portrait, #4) |
| `critiqueUsageDaily.user_id` | … | cascade | no | delete (own) |
| `MASTERY_EVENTS.user_id` | `MASTERY_EVENTS` | none (RESTRICT) | no | **conditional**: delete rows where `user_id = departed` (#3/#4); **PRESERVE** rows where `user_id` = a retained user (#1) |
| `questionReactions.senderUserId` | `QuestionReaction` | none | no | delete own; strip dangling |
| `questionReactions.recipientUserId` | `QuestionReaction` | none | no | delete own; strip dangling |
| `emailVerificationTokens.user_id` | … | cascade | no | delete (own) |
| `generatedQuestions.user_id` | `GeneratedQuestion` | none | no | delete own **unless** a tombstoned `Question.generated_question_id` still points at it (that FK is `set null`) |
| `questionFeedback.user_id` | … | none | no | delete (own) |
| `questionRatings.user_id` | … | none | no | delete (own) |
| `contentReports.reporter_user_id` | `ContentReport` | none | no | **preserve/null** (moderation record) — needs explicit handling |
| `dailyQueues.user_id` | … | none | no | delete (own) |
| `dailyPreferences.user_id` | … | none | no | delete (own) |
| `skippedDailyQuestions.user_id` | … | none | no | delete (own) |
| `userDomainDifficulties.user_id` | … | none | no | delete (own) |
| `userDomainExclusions.user_id` | … | none | no | delete (own) |
| `dailyRefineDecisions.user_id` | … | cascade | no | delete (own) |
| `profileSectionVisibility.user_id` | … | cascade | no | delete (own) |
| `profileDomainVisibility.user_id` | … | cascade | no | delete (own) |
| `declaredInterests.userId` | … | cascade | no | delete (own declared territory, #4) |
| `friendships.userAId` | `Friendship` | cascade | no | delete (relationship) |
| `friendships.userBId` | `Friendship` | cascade | no | delete (relationship) |
| `friendships.requestedByUserId` | `Friendship` | none (RESTRICT) | no | **blocks delete** if departed requested a still-live row — needs null/cascade handling |
| `friendships.removedByUserId` | `Friendship` | none | **yes** | null |
| `follows.followerId` | `Follow` | cascade | no | delete |
| `follows.followeeId` | `Follow` | cascade | no | delete |
| `contactHashes.user_id` | `ContactHash` | cascade | no | delete (own) |
| `joshingGames.creatorId` | `JoshingGame` | cascade | no | **see Decision C** — cascades the game + (cascade) all responses, incl. retained players' responses |
| `feedItems.recipientUserId` | `FeedItem` | cascade | no | delete (own feed) |
| `feedItems.sourceUserId` | `FeedItem` | none (RESTRICT) | no | **Decision D** — re-source to house **or** strip from retained feeds |
| `joshingGameRecipients.userId` | … | cascade | no | delete |
| `joshingGameResponses.userId` | `JoshingGameResponse` | cascade | no | delete own; but see Decision C re: the game cascading off the departed creator |
| `biweeklyCeremonies.userId` | … | cascade | no | delete (own) |
| `activityItems.userId` | `ActivityItem` | cascade | no | delete (own) |
| `activityItems.actorUserId` | `ActivityItem` | **set null** | **yes** | **already correct** — degrades attribution on retained users' activity (aligns with Decision C-style "degrade, don't dangle") |
| `feedDismissedDomains.userId` | … | cascade | no | delete (own) |
| `friendInvitations.inviterUserId` | … | cascade | no | delete |
| `friendInvitations.inviteeUserId` | … | none | **yes** | null |

## FK inventory — every FK → `Question` (`questions.id`)

| Table.column | live `onDelete` | nullable | Disposition (D) |
|---|---|---|---|
| `questionAudienceTags.question_id` | **cascade** | no | tombstone keeps the Question row → tags persist (or strip; not territory-bearing) |
| `userQuestionBank.question_id` | none (RESTRICT) | no | **retained dependency** — a friend banked it (Decision B) → Question must tombstone, bank row preserved |
| `MASTERY_EVENTS.question_id` | none (RESTRICT) | **yes** | **core #1** — PRESERVE; RESTRICT correctly blocks orphaning → Question must **tombstone**, never delete, when any retained mastery event references it |
| `questionReactions.questionId` | none | no | preserve under tombstone / strip dangling |
| `questionFeedback.question_id` | none | **yes** | null-ok |
| `questionRatings.question_id` | none | no | preserve under tombstone |
| `contentReports.question_id` | none | **yes** | preserve (moderation) |
| `skippedDailyQuestions.question_id` | none | **yes** | null-ok |
| `feedItems.questionId` | none (RESTRICT) | **yes** | **Decision D** — tombstone keeps it; render must re-source author |
| `joshingGameQuestions.questionId` | none | no | preserve under tombstone |
| `joshingGameResponses.questionId` | none | no | **retained dependency** if a retained user responded → tombstone |

---

## Code-answerable sub-questions — resolved

**Sub-question 2 (SharePortraitCard hardcodes author names?) — NO.**
`src/components/knowledge/SharePortraitCard.tsx` renders only the portrait
owner's own `playerDisplayName` and domain `PortraitEntry` circles (broad-category
color map). It carries **no third-party author attribution**, so it needs **no**
anonymization path. (Its hardcoded **hex/font** palette drift is a separate issue
and out of scope here.)

**Sub-question 4 (do answerers' tier thresholds depend on author-credit events?) — NO.**
`src/server/mastery/scoring.ts` is pure (no DB). Answerer points come from
`getBasePoints(difficulty, answerState)`; author credit comes from
`creatorMasteryAwardForNthCorrect(...)`, written as `MASTERY_EVENTS` rows with
`source_type = 'author_credit'` and `user_id = the author`. Removing the departed
author's `author_credit` rows (#3) touches only rows whose `user_id` is the
departed author; it cannot move any retained answerer's tier total. `MASTERY_EVENTS`
already denormalizes `base_points`/`weight`/`awarded_points` **and**
`canonical_subcategory` onto each row, so a retained answerer's point total and
domain attribution survive a question deletion **without** the Question row.

**Sub-question 5 (keep tombstoned questions in the difficulty-calibration denominator?) — recommend KEEP.**
`src/server/daily/empirical-difficulty.ts` (D11) reads `Question.asked_count` /
`Question.correct_count` **stored on the Question row** and writes
`Question.calibrated_difficulty` back. The denominator lives on the row, not an
aggregate over `MASTERY_EVENTS`. A tombstoned (retained) Question keeps its
answer counts, so it **stays in calibration automatically** — which is what keeps
§8.27 retroactive reclassification correct for the retained answerers. Hard-delete
would silently remove that question's answer data from the floor's self-correction.

**Sub-question 1 (tombstone identity) — infra exists; one product call remains.**
The D-3 house identity (`creator_id = NULL` + `source = 'house_authored'`, never
renders as a person, Invariant H-1) is the natural sink and is already shipped.
The only open call: distinguish a tombstoned-former-author question from a genuine
house question (today there is no `author_deleted` boolean). See Decision A / fork
below.

**Sub-question 3 (GDPR erasure vs. tombstone)** is a legal/product call, not
code-answerable → fork below (two-path model: A1 for ordinary closure, hard-erase
for explicit erasure requests).

---

## Why A1 (tombstone) is the only option that keeps §8.27 working

`src/server/db/queries/knowledge.ts` computes proven/declared territory by
`leftJoin(questions, eq(MASTERY_EVENTS.question_id, questions.id))` and reads
`difficulty`/category from the **live** Question. Difficulty is **not**
snapshotted onto the mastery event (only points + canonical_subcategory are). So:

- **Points** survive a question deletion (denormalized) → A2's snapshot is
  *partially already built*.
- **Retroactive reclassification** (§8.27, which rewrites portraits when a
  question's calibrated difficulty changes) requires the **live Question row** —
  it cannot run against a deleted question. Only **A1 (tombstone)** keeps it
  working. A2 freezes the answerer's portrait at deletion time and diverges from
  every later recalibration.

---

## Conformance verdict (Done-when item 3)

**Live schema does NOT yet match any ratified A–E decision** — expected at this
stage. Specifically missing before a deletion endpoint can be built:

1. No `author_deleted` (or equivalent) marker on `Question` to distinguish a
   tombstone from genuine house content.
2. No application-level deletion routine; the RESTRICT FKs above
   (`MASTERY_EVENTS.user_id`, `friendships.requestedByUserId`,
   `feedItems.sourceUserId`, `userQuestionBank.question_id`,
   `MASTERY_EVENTS.question_id`, `feedItems.questionId`) will each block a raw
   delete and must be handled explicitly (tombstone / re-source / null / delete).
3. `feedItems.sourceUserId` and `feedItems.questionId` have no degraded-state
   handling (Decision D).
4. Whether `joshingGames.creatorId` cascade is acceptable when the game holds
   **retained** players' responses (Decision C dependency) is unresolved.

This audit closes Done-when item 2 (FK inventory captured, each marked
preserve / null / cascade / tombstone) and resolves the code-answerable
sub-questions. Items 1, 3 (re-audit after ratification) and 4 (pre-launch
checklist) remain pending the A–E product forks below.

---

## Build addendum (2026-06-15)

A–E ratified (recommended defaults; see `DECISIONS.md`) and **built**:

- **Migration `0080_question_author_deleted`** — adds `Question.author_deleted`
  (boolean, default false) + partial index, mirrored by an `instrumentation.ts`
  guard. Journaled at idx 80.
- **`deleteUserAccount` rewritten** (`src/server/db/queries/account.ts`) from the
  hard-cascade to the tombstone model:
  - Partitions the departed author's questions into **tombstone** (any retained
    `MASTERY_EVENTS` / `UserQuestionBank` / `JoshingGameResponse` / retained-feed
    `FeedItem` dependency) vs. **orphan** (none), materialized once.
  - Tombstone: `creator_id` → NULL, `source` → `'house_authored'`,
    `author_deleted` → true (renders house via `resolveQuestionAuthor`, H-1 intact).
    Orphan: hard-deleted.
  - **`MASTERY_EVENTS`: deletes only `user_id = departed`** (their proven territory
    #4 + author_credit #3); retained users' events are never deleted by
    `question_id` — this removes the old confiscation cascade. `answered_by_user_id
    = departed` is nulled on retained rows (Decision C degrade).
  - All other question-keyed deletes (`UserQuestionBank`, `QuestionRating`,
    `QuestionFeedback`, `SkippedDailyQuestion`, `QuestionReaction`, `GradeDispute`,
    `JoshingGameQuestion`/`Response`, `QuestionAudienceTag`) restricted to the
    **orphan** set, so retained users' rows on tombstoned questions survive.
  - **Decision D realized as actor-strip**: `FeedItem.sourceUserId = departed`
    cards are deleted (a real `users.id='house'` is forbidden by H-1); the
    question half still re-sources to house via the tombstone.

**As-built deviations / open tails:**
- `ContentReport` (`reporter_user_id`, `question_id`, `generated_question_id` all
  RESTRICT) is now **handled**. The `ContentReport_one_target` CHECK
  (`(question_id NOT NULL) + (generated_question_id NOT NULL) = 1`) forbids nulling
  a report's target, so the routine **deletes** reports owned by the departed user
  (#4), reports targeting an orphan question (hard-deleted), and reports targeting
  the departed user's generated questions — run before those deletes so the
  RESTRICT FKs don't block. Reports targeting a **tombstone** question keep
  pointing at the surviving row (moderation record preserved).
- **No live integration test**: the query test suite is DB-mocked and cannot
  exercise the raw-SQL transaction. Verified by typecheck + lint + the mocked
  suite (134 query tests green). The pre-launch checkbox needs a real-DB
  conformance run.
