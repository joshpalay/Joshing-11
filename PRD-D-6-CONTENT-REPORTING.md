# PRD-D-6 — Content Reporting ("This is incorrect / This is inappropriate")
**Status:** DRAFT for sign-off. Synthesis stage — not yet a build prompt.
**Line:** New section against the PRD-D (v12) line. Supersedes the stale v11.x
"flag a public question" / thumbs-down references (see §Doc-drift cleanup).
**Decisions locked in the 2026-06-08 align session.** Open items explicitly marked.
---
## 6.0 Why this exists
Two failure modes are currently invisible to the system and to authors:
1. **The answer key is wrong for the question as written** — the canonical
   answer is incorrect, or the question has a false premise / is ambiguous /
   is unanswerable. This is the direct cause of a *falsely-assigned wrong*,
   which the product treats as a betrayal of its core promise. Catching it is
   not generic moderation — it is defense of the north-star promise.
2. **The content is offensive** — inappropriate regardless of correctness.
Neither is the same as the two mechanisms that already exist and must remain
distinct:
- **Recheck / grade dispute** (`GradeDispute`) — "*my* answer was graded wrong."
  The content is fine; one player's result is contested. Untouched by this spec.
- **Reactions** (the heart, live in UI) — a *positive* signal. Untouched.
Content reporting is the product's first **negative** signal surface. There is
no live negative gesture today (thumbs-down is deprecated in the UI — see
Doc-drift cleanup), so this does not replace or compete with anything on screen.
---
## 6.1 The player-facing model
**One entry point: the existing `⋯` contextual menu.** The player never sees the
words "flag," "report," or "thumbs-down." They name the *problem*; the system
chooses the mechanism.
Two new items in the `⋯` menu:
- **"This is incorrect"**
- **"This is inappropriate"**
(Exact copy is a final-pass item; intent is locked.)
### 6.1.1 Where the entry point appears (post-reveal only)
The `⋯` items appear **only where a question is shown together with its answer,
in a calm review state** — never during live play, never before the answer is
revealed. Grounded against the real surfaces:
| Surface | `⋯` items? | Rationale |
|---|---|---|
| **Round Recap card** (post-session review) | **Yes** | Canonical post-reveal surface; already has the `⋯`. |
| **Lately answer-result modal** ("Correct! +N pts") | **Yes** | Post-reveal; these are the friend-authored / generated questions most likely to have a bad answer key. Needs the entry point added. |
| In-play reveal ("Nice pull" / explainer mid-session) | No | Mid-session flow; wrong moment/register. Mirrors the existing "explainers out of the thread" instinct. |
| Inline answer, pre-result (Lately expand) | No | Pre-reveal; you can't judge a false premise or bad key before seeing the answer. |
Rule: **post-reveal review surfaces get the `⋯` items; live and pre-result
surfaces do not.**
### 6.1.2 The second step — the "why," shaped by the problem
Selecting an item opens a light follow-up. It does **not** re-expose any
mechanism choice; it captures the reason.
**"This is incorrect" →**
- Prompt: *what's wrong — the answer, or the question itself?* (answer key vs.
  premise/ambiguity)
- Free-text note (required; short).
- **Optional "the answer should be ___" field.** A corrected answer key is the
  single most actionable thing an author can receive; the card already has the
  question + canonical answer + the player's answer in context, so the flow only
  captures the delta.
**"This is inappropriate" →**
- Brief confirm + required free-text "why."
- On confirm: the card is **removed from this player's view immediately** (see
  6.2).
### 6.1.3 What the player sees after submitting
- **Incorrect:** quiet acknowledgment ("Thanks — we'll take a look"). Card
  stays where it is; no dramatic state change.
- **Inappropriate:** the card disappears from their recap/stream immediately.
---
## 6.2 Behavior & blast radius (the abuse-resistant core)
The governing principle, which resolves the "bad actor flags everything to shut
the game down" worry:
> **Hiding from yourself is free and unlimited. Hiding from anyone else requires
> a human (admin) review.** A malicious reporter can only ever affect their own
> view; they can never silently remove a friend's question from the graph.
| | Reporter's own view | Everyone else | Propagation to *new* surfaces | Admin queue |
|---|---|---|---|---|
| **Incorrect** | Unchanged (or optional self-hide) | Unchanged | **Suppressed** | Normal priority |
| **Inappropriate** | **Hidden immediately** | Unchanged until admin review | **Suppressed** | **High priority** |
Notes:
- **"Suppress propagation"** = the question stops entering *new* feeds / daily
  queues / sends. It is **reversible** and does **not** retroactively yank the
  question from people who already have it. (Offensive content that an admin
  upholds is then hard-removed — see 6.3.) This reuses existing
  "flag-for-review, never auto-delete" machinery (see §Schema, 6.5).
- A single report from one person is **high signal** in a small invite-only
  graph — but it still cannot reach other players' views without admin action.
- **No N-flag threshold.** Brigading is not the threat model (real identities,
  small graphs); the threats are (a) one report being too powerful and (b)
  offensive content lingering. This model defuses both.
### 6.2.1 Flood-stop rate limit
A soft per-user cap of **10 reports/day** (across both categories), purely as a
queue-flood stop. Generous enough that honest use never hits it; one-line check;
near-zero false-positive risk. Not framed to the user as friction — a user at
the cap sees a gentle "you've reported a lot today" message.
### 6.2.2 Abuse signal capture (no UI at launch)
The report row stores `reporter_user_id` + the eventual admin `status`
(`upheld` / `dismissed`). This makes **reporter uphold-rate** computable later —
the basis for down-weighting or rate-limiting a bad-faith reporter — **without a
future migration.** No launch UI; data capture only.
---
## 6.3 Author-facing behavior
The unifying rule: **a correction reaches the author immediately because it
helps them; an accusation reaches the author only after a human validates it.**
| | Author learns of it… | When | What they see |
|---|---|---|---|
| **Incorrect** | Yes, quietly | Immediately, in their Questions bank | The reporter's **note**, **not** the reporter's identity; the question enters an editable "needs attention" state. |
| **Inappropriate** | Only if **upheld** | After admin review | "This question was removed" + category. A **dismissed** inappropriate report is **never surfaced to the author** at all. |
- **Incorrect, quiet, no name:** matches the no-notification ethos (no SMS — see
  §8.11 deferral). The note carries the fix; the name would carry only a grudge
  between friends. Fixing the answer key (editing
  `answerText` / `acceptedAlternatives`) **clears the report and resumes
  propagation.**
- **Inappropriate, human-gated:** an unreviewed (possibly malicious) report must
  never get to tell someone their content is offensive. Upheld → author told +
  question hard-removed (authored: `visibility = 'blocked'`). Dismissed →
  invisible to author; propagation restored.
### 6.3.1 House / editorial content
A report on `HOUSE_AUTHOR` content (per `house-editorial-copy-checklist.md`)
routes **admin-only**. There is no author to notify, and — critically — the
author-facing "needs attention" state **must never render for house content**,
because surfacing a person-like author state on machine content is the exact
live-honesty bug that doc warns against. House content has no human author;
reports on it are purely an admin signal.
---
## 6.4 Review (admin)
- **Sole reviewer: the admin (you).** A simple admin queue lists open reports,
  newest/high-priority first, with: question text, both answers, category, the
  note, the suggested-answer (if any), reporter (admin sees identity), and the
  target table (authored vs. generated vs. house).
- Per report, admin can: **uphold** or **dismiss**.
  - Uphold **incorrect** → (typically) edit the answer key / mark the question
    for correction; report resolves.
  - Uphold **inappropriate** → hard-remove (authored: `visibility = 'blocked'`;
    generated: equivalent review-flag terminal state); author told.
  - Dismiss → propagation restored; nothing surfaced to author.
- **Admin auth — RESOLVED (2026-06-08):** **`ADMIN_USER_IDS` env allowlist**,
  checked in the admin route exactly as `CRON_SECRET` gates the cron routes. No
  migration, no `isAdmin` column. The route resolves the session user id and
  rejects (404, not 403 — don't reveal the route exists) anything not in the
  allowlist. Add `ADMIN_USER_IDS` to `env-check.ts` as optional (the admin queue
  is simply unreachable if unset, which is the correct safe default).
---
## 6.5 Schema delta (Drizzle)
**New table only. No changes to existing tables required for the core.** Modeled
on the `GradeDispute` review-lifecycle pattern already in `schema.ts`.
```ts
export const contentReportCategoryEnum = pgEnum('ContentReportCategory', [
  'incorrect',
  'inappropriate',
]);
// 'incorrect' sub-type: lets the author/admin see whether the answer key or the
// premise is being challenged. Nullable (only meaningful for 'incorrect').
export const contentReportIncorrectKindEnum = pgEnum('ContentReportIncorrectKind', [
  'answer_key',   // canonical answer is wrong
  'premise',      // false premise / ambiguous / unanswerable
]);
export const contentReportStatusEnum = pgEnum('ContentReportStatus', [
  'open',
  'upheld',
  'dismissed',
]);
export const contentReports = pgTable(
  'ContentReport',
  {
    id: id(),
    reporterUserId: text('reporter_user_id').notNull().references(() => users.id),
    // Dual-table target — mirrors QuestionFeedback. Exactly one is set.
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    category: contentReportCategoryEnum('category').notNull(),
    incorrectKind: contentReportIncorrectKindEnum('incorrect_kind'),
    note: text('note').notNull(),
    suggestedAnswer: text('suggested_answer'),       // optional corrected key
    surface: text('surface'),                        // 'round_recap' | 'lately' (provenance)
    status: contentReportStatusEnum('status').notNull().default('open'),
    reviewDecision: text('review_decision'),
    reviewReason: text('review_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    // One open report per user per question (either table). Prevents spam dupes;
    // re-reporting after resolution is allowed (only 'open' is constrained — see
    // note below; expressed as a partial unique index in the migration).
    index('ContentReport_reporter_user_id_idx').on(table.reporterUserId),
    index('ContentReport_question_id_idx').on(table.questionId),
    index('ContentReport_generated_question_id_idx').on(table.generatedQuestionId),
    index('ContentReport_status_idx').on(table.status),
    // CHECK: exactly one target set (mirrors the QuestionFeedback dual-FK pattern)
    check(
      'ContentReport_one_target',
      sql`(question_id IS NOT NULL)::int + (generated_question_id IS NOT NULL)::int = 1`,
    ),
    // CHECK: incorrect_kind only set when category = 'incorrect'
    check(
      'ContentReport_incorrect_kind_scope',
      sql`incorrect_kind IS NULL OR category = 'incorrect'`,
    ),
  ],
);
```
**Suppression — reuses existing fields, no new ones:**
- **Authored question (`Question`):** offensive-upheld → `visibility = 'blocked'`
  (the existing safety terminal state, already excluded by
  `questionVisibilityPredicate` and all bank/send/game read paths).
  Pre-review propagation suppression for either category is enforced by the
  open-report check in the selection layer (see build note), not a new column.
- **Generated question (`GeneratedQuestion`):** has existing review-flag
  precedents (`nobodyCorrectFlag`, `isDuplicate`, both *"flag for review, never
  auto-delete"*). Suppression follows the same pattern — an open/upheld report
  flags the row out of selection without deletion.
**Migration:** one additive migration (three enums + one table + partial unique
index for one-open-report-per-user-per-question). No changes to existing tables.
Auto-applies at boot per `instrumentation.ts` convention. Drizzle, not Prisma.
---
## 6.6 Doc-drift cleanup (do as part of this work)
The stale specs describe thumbs-down as a **live** quality gate (UAT FEED-9,
v11.2 §8.10, the `/api/feed/[feedItemId]/thumbsdown` endpoint). The reality
discovered during the B-Report-2 trace (2026-06-08): the *positive* thumbs-down
is gone, but a **live "Report content" `⋯` item** remains on the Round Recap
card, wired to `thumbs_down` → `/api/daily/feedback` (coarse self-feed-removal +
propagation suppression), using the forbidden word "Report."
Canonical correction: **the negative-signal surface is the `⋯` content-reporting
menu defined here.** The vestigial "Report content" item is **replaced** by the
two problem-named items (not kept alongside — three overlapping negative entries
is exactly the taxonomy confusion this model exists to prevent). Its coarse
suppression behavior is superseded by §6.2 / B-Report-3 suppression, which is
strictly more precise. B-Report-2 removes the item from the UI; if any non-UI
reader depends on the `thumbs_down`/`daily/feedback` signal, B-Report-3 absorbs
that behavior before the path is retired. The heart (`thumbs_up`) is untouched.
---
## 6.7 Locked decisions (for traceability)
1. One entry: existing `⋯` menu, post-reveal review surfaces only (Round Recap +
   Lately result modal). No mechanism words.
2. Two problem-named items: "This is incorrect" / "This is inappropriate."
   Heart (positive) untouched; no thumbs-down (deprecated).
3. Second step = the "why," shaped by problem; incorrect optionally captures a
   corrected answer.
4. Blast radius: both suppress propagation; inappropriate adds instant
   hide-from-flagger + high admin priority. Hide-from-self free; hide-from-others
   needs admin. No N-flag threshold.
5. Author learns of incorrect immediately + quietly (note, no name); learns of
   inappropriate only if upheld. Dismissed inappropriate is invisible to author.
6. Sole reviewer = admin (you). 10/day flood-stop. Reporter id + status captured
   for future abuse-signalling, no launch UI.
7. House content: admin-only; never renders an author-facing state.
8. New `ContentReport` table (dual-FK, GradeDispute-style lifecycle); suppression
   reuses `visibility='blocked'` (authored) and review-flag pattern (generated).
## 6.8 Open decisions
- **Admin auth — RESOLVED (2026-06-08):** `ADMIN_USER_IDS` env allowlist, 404 on
  non-admin, optional in `env-check.ts`. See §6.4.
- **Copy final pass (non-blocking)** — the two menu labels, the two
  acknowledgments, the author-side "needs attention" + "removed" strings. Build
  carries sensible defaults; adjust in PR review.
- **Re-report policy (defaulted)** — "one *open* report per user per question; a
  new report allowed after resolution." Drives the partial unique index. Flag now
  if a different constraint is wanted.
