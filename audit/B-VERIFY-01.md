# B-VERIFY-01 Audit Report

**Commit audited:** `0924f52ec155dee085d10236d1ef26842b8127f2`
**Date:** 2026-05-21

## Summary

- Reaction mechanic present: 🟡 partial (single-level only; wrong-answer canned types declared in DB enum but unused at the app level)
- Wrong-answer text leakage to author: **1 confirmed UI violation**, plus 1 elevated-risk loader; details below
- Opt-in path ready: ❌ no `include_submitted_answer` column, no UI affordance, no read-path branch
- Dispute path correct: 🟡 partial (dispute table exists and stores submitted answer; no surface yet exposes it to the question author — the only "non-reaction path that surfaces text" today is the **creator-notes flow**, which is NOT a dispute path)
- Aggregation rule enforced: 🟡 partial (analytics surfaces aggregate stats only; no individual wrong-answer rows are exposed, but there is no explicit count-threshold gate because no "common wrong answers" surface exists yet)

---

## Section A — Reaction mechanic

### A1. Schema — ✅ partial

`QuestionReaction` table exists at `src/server/db/schema.ts:389-409`. Columns:

| Required by §8.10b spec  | Present in schema?                                     |
|--------------------------|--------------------------------------------------------|
| id                       | ✅ `id` (line 392)                                     |
| question_id              | ✅ `questionId` (line 395)                             |
| from_user_id             | ✅ `senderUserId` (line 393)                           |
| to_user_id               | ✅ `recipientUserId` (line 394)                        |
| canned_type (nullable)   | 🟡 `reactionType text NOT NULL` (line 398) — text, not enum, not nullable; defaults to `'good_one'` for legacy rows (migration `drizzle/0006_question_reactions_contexts.sql:91`) |
| note_text (≤100 chars)   | 🟡 `customMessage` (line 399); cap is **160** chars at the route, not 100 — see `PRD_BACKLOG.md:61` for already-acknowledged drift |
| parent_reaction_id       | ❌ **dropped** in `drizzle/0006_question_reactions_contexts.sql:102` (`ALTER TABLE ... DROP COLUMN IF EXISTS "parent_reaction_id"`). It existed in `drizzle/0000_material_lyja.sql:161` and was removed |
| created_at               | ✅ `createdAt` (line 401)                              |
| (also present)           | `contextType` `'feed' \| 'joshing_game'`, `contextId`, `repliedAt` |

Verdict: 🟡 partial — the table exists with a single-level shape only. Threaded creator responses (parent_reaction_id) are no longer supported by the schema.

### A2. Wrong-answer canned types — 🟡 partial

`reactionCannedEnum` at `src/server/db/schema.ts:64-74` declares **9** canned values, including the four wrong-answer ones spec'd in §8.10b:

```
'always_knew', 'got_me', 'of_course_you', 'never_heard',
'need_to_talk', 'didnt_know_tell_me', 'need_story',
'adding_to_list', 'knew_i_wouldnt'
```

However, **`reactionType` in the `QuestionReaction` table is `text`, not the enum** (`src/server/db/schema.ts:398`), so the DB does not constrain to those values. And — critically — the application-side `CANNED_REACTIONS` constant at `src/lib/reactions.ts:1-8` is a **completely different list** with **none of the wrong-answer types**:

```ts
CANNED_REACTIONS = [
  'how_did_you_know', 'good_one', 'too_easy',
  'i_should_have_known', 'made_my_day', 'thinking_of_you',
]
```

`src/app/api/reactions/route.ts:37` calls `isReactionKey(reactionType)` (`src/lib/reactions.ts:16-18`), which rejects any value not in the application list. **Net effect: the API cannot accept a wrong-answer canned reaction today** — the DB enum is dormant and the UI does not surface those buttons.

Verdict: 🟡 partial — the enum hints at intent; the runtime path does not deliver it.

### A3. Write path — ✅ present

Route: `POST /api/reactions` at `src/app/api/reactions/route.ts:85-111`.

- Auth check: `getSession()` at line 86; rejects unauth with 401 (line 87).
- Validation: `parseBody` at line 24 (Zod-free; manual). Rejects missing question_id, bad contextType, bad reactionType.
- `from_user_id` is **always** `session.userId` (line 101) — payload cannot override.
- Recipient is derived server-side via `resolveRecipient` (lines 42-83) from feed-item / joshing-game ownership, not trusted from the body.

Verdict: ✅.

### A4. Self-reaction block — ✅ present

`src/app/api/reactions/route.ts:96-98`:

```ts
if (recipientUserId === session.userId) {
  return NextResponse.json({ error: 'self_reaction', ... }, { status: 400 });
}
```

Verdict: ✅.

### A5. Notification — ✅ partial; no submitted-answer leak in SMS body

Reaction SMS sender: `src/server/db/queries/reactions.ts:86-93`.

```ts
const body = `${senderName} reacted to your question: ${reaction.label}`;
sendSms(recipientRow.phoneNumber, body, 'question_reaction', params.recipientUserId)
```

SMS body contains: sender display name + canned reaction label (e.g. "Good one"). It does **not** contain `note_text`/`customMessage`, and does **not** contain `submitted_answer`. ✅

Activity-feed event: `src/server/db/queries/reactions.ts:73-80` inserts an `ActivityItem` of type `reaction_received` targeting `recipientUserId` (the author). The hydrator at `src/server/db/queries/activity.ts:306-345` and renderer at `src/app/activities/page.tsx:227-240` show `reactionEmoji + reactionLabel + customMessage + questionText`. The activity payload **does** include `customMessage` (the answerer's free-text note, up to 160 chars). No `submitted_answer` join exists.

Templates consulted: `src/server/sms.ts:189-221` (creator_note_prompt — does not reference reactions), `src/server/db/queries/reactions.ts:89` (the only `question_reaction` SMS body).

Verdict: ✅ for SMS body privacy of `submitted_answer`. (Note: `customMessage` is a separate free-text channel; see B-OPTIN-01 below.)

### A6. Read path — End of Session Review — 🟡 partial

The reaction-prompt UI is mounted from `src/app/games/[id]/play-client.tsx:94-101` and rendered by `QuestionReactionPrompt` at `src/components/play/GameplayChat.tsx:365-489`. It appears **inline after each answer during gameplay**, not in a separate "end of session" panel.

For the **answerer**: the reaction prompt is shown when `game.game.creatorId !== viewerId` (line 94), i.e., the recipient sees it after each question. Cards: `CANNED_REACTIONS.map(...)` at line 438 — so the **wrong-answer-specific canned reactions are not offered**, because they are not in the app-level list (see A2).

For the **author**: incoming reactions surface in `/activities` (`src/app/activities/page.tsx:227-240`) and via SMS (A5). The summary page (`src/app/games/[id]/summary/page.tsx`) does **not** render reactions.

Verdict: 🟡 — a reaction-prompt UI exists in-game but is wired to the "correct-answer" canned list only; no End-of-Session-Review surface aggregates reactions for the answerer.

### A7. Read path — archive — ❌ missing

`grep -rn reaction /home/user/Joshing-11/src/app/archive` and the same against `/replay`, `/daily/summary`, `/components/feed/*` return zero matches. The archive (`src/app/archive/page.tsx`, query `src/server/db/queries/archive.ts`) does not project reactions.

Verdict: ❌ — archive does not surface reactions.

### A8. Creator response — ❌ missing

A schema enum exists (`creatorResponseCannedEnum` at `src/server/db/schema.ts:75-80` with `knew_youd_get_it`, `surprised_you_knew`, `just_for_you`, `story_here`) and a SMS type `creator_reaction_response` at line 98 — but:

- There is **no `parent_reaction_id` column** (dropped in 0006); a creator response cannot be modelled as a child reaction.
- The only "response" path is `POST /api/reactions/[id]/reply` (`src/app/api/reactions/[id]/reply/route.ts`), which calls `markReactionReplied` (`src/server/db/queries/reactions.ts:174-182`). That just stamps `repliedAt = now` on the original reaction. **No row is inserted; no SMS or activity is sent to the original answerer.**
- The button at `src/app/activities/ReactionGotItButton.tsx:34` labels this as "👍 Got it" / "Acknowledged" — i.e., an acknowledgement, not a reply.

Verdict: ❌ — there is no creator-response write path.

---

## Section B — Leakage check

### B1. Wrong-answer creator prompt notification (SMS + in-app) — 🚨 LEAKS (in-app)

**SMS body:** ✅ no leak.
`src/server/creator-notes.ts:72`:

```ts
const body = `${displayName(recipient?.displayName)} just missed your question:
  '${truncateQuestion(row.questionText)}' Want to send them a note? ${url}`;
```

And the alternate sender at `src/server/sms.ts:218`:

```ts
const body = `Someone got your question wrong: "${preview}". Add a note to give context: ${baseUrl}/questions`;
```

Neither includes `submittedAnswer`.

**In-app landing page:** 🚨 LEAKS.
The SMS URL points the question's author at `/creator-notes/new?q={questionId}&r={recipientUserId}` (`src/server/creator-notes.ts:71`). That page (`src/app/creator-notes/new/page.tsx:71-80`) renders:

```tsx
<p>Question: {row.question.questionText}</p>
<p>Answer: {row.question.answerText}</p>
<p>{recipientName} said: {creatorNoteSubmittedAnswerText(wrongAnswer.submittedAnswer, 'Their')}</p>
```

`wrongAnswer.submittedAnswer` is the literal text the answerer typed in (loaded by `findWrongAnswerContext` at `src/server/creator-notes.ts:80-133`, which selects `joshingGameResponses.submittedAnswer` or `feedItems.submittedAnswer`). The page guards on `row.question.creatorId !== session.userId` (line 52), so the viewer **is** the question's author by construction.

This is a clear §8.22 violation: a wrong-answer reaction is **not** required to reach this surface; the answerer never consented; the path is not a dispute. Verdict: 🚨 **B1 — in-app creator-note compose surface leaks submitted answer to the question author by default.**

### B2. Activity feed item ("Friend got your question wrong") — N/A (item does not exist yet)

There is no activity type that fires for "friend got your question wrong". The closest type is `friend_answered_your_question` (`src/server/activity/write-activity.ts:15`), and its writer at `src/server/feed/create-feed-items-for-answer.ts:150-173` (`notifyPreviousAnswerers`) sends the activity to **previous co-answerers**, not the question's author. Its renderer at `src/server/db/queries/activity.ts:478-522` and `src/app/activities/page.tsx:121-135` projects only `{ domain, result: 'correct'|'incorrect' }` — no `submittedAnswer`.

Verdict: not applicable — no such item is written to the author, so nothing leaks here. Flagged for product clarification: §8.22 implies an "event" notification exists; today the author is reached only by the `creator_note_prompt` SMS (B1).

### B3. Creator analytics view (`/questions`) — ✅ no leak

`src/app/questions/page.tsx:411-470` renders one card per authored question with:
- domain pill, difficulty pill (`difficultyCopyFromValue`)
- question text
- aggregate counts: `"{timesAnswered} answers · {correctRate}% correct · {usedInGamesCount} games"` (line 441)
- attribution of answerer **names** when applicable: `formatAnswerersLine` (lines 148-156) shows up to two names plus "and N others"

Data source: `getQuestionsForUser` → `getBankedQuestions` → `toQuestionView` (`src/server/db/queries/questions.ts:205-252`). The view returns `{ timesAnswered, timesCorrect, correctRate, usedInGamesCount, ... }`. **It does not return any answerer's `submittedAnswer`.** No "common wrong answers" surface exists.

Verdict: ✅ — aggregate-only; no per-row submitted text. Note: answerer **names** are attributed (not anonymised) in the answerers line; this is a separate identity-privacy question, not a submitted-text leak.

### B4. Game / season summary, author-facing slice — ✅ no UI leak, but data is over-fetched

`src/app/games/[id]/summary/page.tsx`:
- Round Recap section (lines 254-332) renders `responseByUserQuestion.get(responseKey(session.userId, gameQuestion.questionId))` — i.e., only the **viewer's own** response (line 259). `response.submittedAnswer` at line 295 is the viewer's own text.
- Your Impact Recap (lines 335-342) is a count only: "{impactCount} of your questions were answered correctly this round."
- `computeOverlapCells` (`src/server/db/queries/joshing-game.ts:71-121`) produces aggregate scores/correct-counts only, no submitted text.

However, the underlying loader `getJoshingGame` at `src/server/db/queries/joshing-game.ts:300-401` includes the branch:

```ts
const canSeeAllResponses = viewerComplete || params.requestingUserId === gameRow.game.creatorId;
return {
  ...,
  responses: canSeeAllResponses ? responseRows : responseRows.filter(...),
};
```

`responseRows` are full `joshingGameResponses` rows including `submittedAnswer`. So **the game creator (and any completed recipient) receives every participant's `submittedAnswer` in the page payload**, including for questions they authored. Today nothing in the rendered UI projects those values — but the data is shipped to the client in `play-client.tsx` (`JSON.parse(JSON.stringify(view))`, `src/app/games/[id]/page.tsx:23`), so it is observable in the DOM/JS state on the play route for any creator who is also a recipient. The summary route does not pass `view` to a client component, so the leak there is server-only.

Verdict: ✅ on UI rendering; 🟡 **elevated risk in the data layer** — `getJoshingGame` ships submitted text to the game creator with no §8.22 gate. Worth a defence-in-depth fix even though no current view surfaces it.

### B5. Question detail / archive view, when accessed by the author — ✅ no leak

Archive query `src/server/db/queries/archive.ts`:
- `readFeedItems` (lines 213-281): sets `submittedAnswer: null` (line 269) for feed-sourced items in the archive — the user's own answer is not surfaced here at all.
- `readJoshingGameItems` (lines 283-319): `submittedAnswer: response.submittedAnswer` (line 307) — but the query filters by `eq(joshingGameResponses.userId, userId)` (line 293), so this is the viewer's **own** response.
- `readDailyItems` (lines 155-211): viewer's own slot, same rationale.
- `readWrittenByMeItems` (lines 321-373): for questions the viewer wrote, `submittedAnswer: null` (line 361). ✅ — the author does **not** see other players' submitted text on their own questions in the archive.

Verdict: ✅.

### B6. SMS_LOG audit — ✅ no leak

`SmsLog` schema at `src/server/db/schema.ts:459-473` stores **only** `{ id, userId, phoneNumber, messageType, sentAt }`. There is **no message-body column**, so no submitted-answer text can be persisted in SMS logs by construction.

The SMS sender at `src/server/sms.ts:22-65` accepts a `body: string` but writes only the rate-limited row above (the body itself goes to Twilio and is not retained server-side).

Reviewed all SMS bodies in `src/server/sms.ts` (lines 163-220) and `src/server/db/queries/reactions.ts:89` — no body references `submittedAnswer` or `customMessage` text. The only free-text interpolations are display names, question-text previews, and URLs.

Verdict: ✅.

### B7. API endpoints returning ANSWERS.submitted_answer — partial inventory

There is no single `ANSWERS` table — wrong-answer text lives in **three** stores depending on surface:
- `FeedItem.submittedAnswer` (`src/server/db/schema.ts:710`) — recorded when a user answers a feed/direct item.
- `JoshingGameResponse.submittedAnswer` (`src/server/db/schema.ts:764`) — recorded per game.
- `DailyQueue.slots[].submitted_answer` (jsonb blob).
- `GradeDispute.submittedAnswer` (`src/server/db/schema.ts:440`) — recorded when a disputer files a recheck.

Endpoints that read these fields and respond with submitted text:

| Endpoint | Caller authorization | Leak risk? |
|---|---|---|
| `POST /api/feed/[feedItemId]/answer` | recipient-only (`recipientUserId === session.userId`) | ✅ own answer only |
| `POST /api/feed/[feedItemId]/recheck` | recipient-only (line 29) | ✅ own dispute |
| `POST /api/daily/answer` | session-scoped daily slot | ✅ own |
| `POST /api/daily/recheck` | session-scoped daily slot | ✅ own |
| `POST /api/daily/catchup/answer` | session-scoped | ✅ own |
| `POST /api/joshing-games/[id]/answer` | own response only | ✅ own |
| `POST /api/replay/grade` | session-scoped (`src/app/api/replay/grade/route.ts:51`) | ✅ own |
| `POST /api/breadcrumb` | filters by `userId` on both daily and joshing-game branches (`src/app/api/breadcrumb/route.ts:119`) | ✅ own |
| `GET /api/feed` → `get-feed-page.ts:278` | `submitted_answer` only when `cardType === 'answered_by_you'` | ✅ own card only |

Server-rendered surfaces that read submitted text:

| Surface | Audience | Leak? |
|---|---|---|
| `/creator-notes/new?q=…&r=…` | question author (enforced line 52) | 🚨 **YES** — see B1 |
| `/games/[id]/summary` | creator or recipient | ✅ UI filters to viewer's own |
| `/games/[id]` (play) | recipient (or creator-as-recipient) | 🟡 loader over-fetches; UI filters by viewerId |
| `/archive` | self | ✅ |
| `/knowledge/[domain]` | self | ✅ |
| `/activities` | self | ✅ (no submitted-answer field in activity payloads except the creator-note where the recipient is the answerer, which is by design — they see their own text) |

Verdict: **One confirmed leak (B1).** One elevated-risk loader (B4 / `getJoshingGame`).

### Violations found

#### Violation 1 — `/creator-notes/new` exposes the answerer's submitted text to the question author

- **Path:** `src/app/creator-notes/new/page.tsx:77-79` (renderer); `src/server/creator-notes.ts:80-133` (loader `findWrongAnswerContext`).
- **Trigger:** Author receives a `creator_note_prompt` SMS (`src/server/sms.ts:189-221` or `src/server/creator-notes.ts:30-78`) after a player misses their question, taps the link, and lands on this page.
- **Current behavior:** Page shows `{recipientName} said: {submittedAnswer}` verbatim. No opt-in from the answerer is checked.
- **Expected per §8.22:** Submitted text reaches the author only via (a) a grade dispute initiated by the answerer, (b) a reaction with `include_submitted_answer = true`, or (c) de-identified aggregate (count ≥ 3 / cross-group ≥ 2). The creator-note compose flow is none of these.
- **Suggested fix scope (do not implement here — flagged for B-FIX-01):** Stop loading `submittedAnswer` for the author's compose surface. Either (i) gate the load on an explicit opt-in stored against the wrong-answer row (requires C1 migration), or (ii) hide the "X said: …" row entirely and write the creator note from the question + canonical-answer pair alone. Option (ii) is the minimal-change fix and aligns with the SMS body, which already omits the answer text. Also remove `submittedAnswer` from `findWrongAnswerContext`'s return type or restrict it to author-disallowed callers.

#### Elevated risk — `getJoshingGame` ships every participant's `submittedAnswer` to the game creator

- **Path:** `src/server/db/queries/joshing-game.ts:361-398`.
- **Current behavior:** When the requester is the game creator (or any recipient who has completed the game), the loader returns the full `responseRows` array, including every other participant's `submittedAnswer`.
- **Today:** No rendered UI projects those values for the creator (B4). Risk: any future addition (or a third-party client reading the play-client's serialized `view`) would surface them.
- **Suggested fix scope (B-FIX-01 sub-task):** Strip `submittedAnswer` from rows where `response.userId !== params.requestingUserId` before returning. Or, at minimum, when `requestingUserId === gameRow.game.creatorId` and the row belongs to a different user.

---

## Section C — Opt-in path

### C1. `include_submitted_answer` column — ❌ missing

`grep -rn "include_submitted_answer\|includeSubmittedAnswer" src/` returns zero hits. `QuestionReaction` columns are listed in A1; none correspond to this opt-in.

**Migration required:** add `ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "include_submitted_answer" boolean NOT NULL DEFAULT false`. Drizzle schema update at `src/server/db/schema.ts:389-409` to match. The migration must also be made idempotent for partially-recorded preview/production DBs in `src/instrumentation.ts` (see CLAUDE.md note on enums/columns).

### C2. UI surface for the opt-in checkbox — 🟡 partial

`QuestionReactionPrompt` at `src/components/play/GameplayChat.tsx:365-489` is the only reaction-composer surface today. It already has a "custom message" toggle (lines 419-436) and a chip rail. The opt-in checkbox could attach to the same prompt — but **only the answerer can see a reaction prompt today, and only inside a joshing-game play view** (it is not rendered in feed, daily, or End-of-Session-Review surfaces). For the §8.22 opt-in to be meaningful on **all** wrong answers, the prompt has to be wired into the feed/daily wrong-answer flows too.

Files to touch:
- `src/components/play/GameplayChat.tsx` — add the checkbox to `QuestionReactionPrompt`.
- `src/app/api/reactions/route.ts:24-40` — parse and persist `includeSubmittedAnswer` from the body.
- A new mount of `QuestionReactionPrompt` in `src/components/feed/AnswerFeedbackSheet.tsx` (or equivalent wrong-answer review surface) — there is no such mount today.

### C3. Read-layer join — ❌ missing

The current reaction view (`src/server/db/queries/reactions.ts:98-148`, `getReactionsForUser`) returns `customMessage` but never joins `ANSWERS.submitted_answer`. The activity hydrator (`src/server/db/queries/activity.ts:306-345`, `hydrateReactions`) likewise does not join. Add a conditional join: `if include_submitted_answer = true AND viewerUserId = question.creatorId then surface answerRow.submitted_answer`. The natural place is `hydrateReactions` (it already filters by `recipientUserId = viewer`, which equals the question author for any inbound reaction).

Verdict: ❌ — the opt-in path requires schema + UI + read-layer work. Score: not ready.

---

## Section D — Dispute path

### D1. Grade-dispute mechanism exists — ✅

Schema: `gradeDisputes` table at `src/server/db/schema.ts:433-457`. Migrations: `drizzle/0025_grade_dispute_recheck_details.sql` and ancestors.

Two write paths:
- Feed recheck: `POST /api/feed/[feedItemId]/recheck` (`src/app/api/feed/[feedItemId]/recheck/route.ts:75-99` — inserts a `gradeDispute` row).
- Daily recheck: `POST /api/daily/recheck` (`src/app/api/daily/recheck/route.ts`).

Both are initiated by the **answerer** (auth check restricts to `recipientUserId === session.userId`).

### D2. Dispute exposes the submitted answer to the author — ❌ not yet

`gradeDisputes.submittedAnswer` is persisted (`src/server/db/schema.ts:440`), but `grep -rn "gradeDisputes\|gradeDispute" src/` returns only:

- `src/server/db/schema.ts` — table def
- `src/server/db/queries/account.ts` — referenced in user-data export
- `src/app/api/daily/recheck/route.ts`, `src/app/api/feed/[feedItemId]/recheck/route.ts` — write paths

**There is no surface where the question's author reads the dispute (no admin queue, no author-facing notification, no `/disputes` UI).** The disputer receives an LLM verdict back via the recheck response; the author is not notified and has no view.

Verdict: ❌ — disputes are filed but not surfaced. §8.22 requires that disputes be one of the channels that **does** expose the submitted answer to the author; today that channel is dead-end.

### D3. Dispute is the only non-reaction path that does this — ❌

Per the actual code, the dispute path does **not** currently expose the submitted answer to the author (D2). The **only path that does today** is the **creator-notes compose page** (B1), which is neither a dispute nor an opt-in reaction. So today the rule "dispute is the only non-reaction path that exposes submitted text to the author" is violated in the opposite direction: dispute exposes nothing, while creator-notes exposes everything.

Verdict: ❌ — the role currently played by "dispute" is held by the creator-notes flow, and no other path is in between.

---

## Section E — Aggregation rule

### E1. Threshold (count ≥ N) before surfacing common wrong answers — N/A

There is no "common wrong answers" UI in the codebase. `grep -rn "Nobody got this\|common wrong\|common_wrong"` returns zero hits. The thresholds that do exist (`session-close-copy.ts:102`, `daily/summary/page.tsx:120`) are for daily summary copy choices ("≥ 2 of you missed it"), not for revealing submitted text.

Verdict: not applicable — no surface to gate.

### E2. Any view attributes a specific wrong answer to a specific named user in the author's analytics — ✅ no leak found

The author's analytics surfaces are:
- `/questions` (B3) — names attributed, **but no submitted-answer text**.
- Authored-questions feed on a profile (`src/components/profile/AuthoredQuestionsFeed.tsx`) — shows the **viewer's own** submitted answer when the viewer answers a friend's question; this is the user's own data, not other answerers' data.

Verdict: ✅ on submitted-text attribution. **Caveat (tangential):** answerer-name attribution in the answerers line at `/questions` (B3) names up to two people who answered, e.g. "Alice and 3 others answered your question". Whether this counts as identity-attribution that §8.22 cares about is a product question; flagged below.

---

## Recommended follow-up prompts

### B-FIX-01 — Stop leaking submitted text in the creator-note compose flow

Scope: change `src/app/creator-notes/new/page.tsx:77-79` to no longer render `wrongAnswer.submittedAnswer`, and change `src/server/creator-notes.ts:findWrongAnswerContext` to either (a) not return `submittedAnswer` to author-side callers, or (b) gate it on an opt-in flag once C1 lands. Add a unit/integration test asserting the page does not render answerer text when accessed by a non-disputing author. Also strip `submittedAnswer` from `getJoshingGame` rows belonging to other users when the requester is the game creator (`src/server/db/queries/joshing-game.ts:396-398`). Single PR, ~50 LoC + tests.

### B-OPTIN-01 — Wire the wrong-answer reaction opt-in end-to-end

Scope:
- Migration: add `include_submitted_answer boolean NOT NULL DEFAULT false` to `QuestionReaction`. Add idempotent guard in `src/instrumentation.ts`.
- App `CANNED_REACTIONS` at `src/lib/reactions.ts:1-8` — add the wrong-answer canned types (`didnt_know_tell_me`, `need_story`, `adding_to_list`, `knew_i_wouldnt`) and split the list by context (correct vs. wrong) so the prompt renders the right ones.
- `QuestionReactionPrompt` (`src/components/play/GameplayChat.tsx:365-489`) — add a checkbox "include what I wrote" that posts `includeSubmittedAnswer: true`.
- `POST /api/reactions` (`src/app/api/reactions/route.ts`) — accept and persist.
- `hydrateReactions` (`src/server/db/queries/activity.ts:306-345`) — when `include_submitted_answer = true` and the viewer is the question's author, join the relevant `submittedAnswer` and add it to the activity payload.
- Renderer (`src/app/activities/page.tsx:227-240`) — render the joined text under the reaction card.
- Mount `QuestionReactionPrompt` in the feed wrong-answer review (it is currently joshing-game-only).
- Tests: opt-in defaults off; off → text hidden; on → text visible only to the question author.

This is the bulk of the §8.22 work. Plan as a multi-PR sequence.

### B-DISPUTE-01 — Make dispute actually expose the submitted answer to the author

Scope: build an author-facing surface (an item in `/activities`, or a dedicated `/disputes` queue) that lists pending disputes on questions the user authored, projecting `gradeDisputes.submittedAnswer` and `gradeDisputes.canonicalAnswer`. Without this, §8.22's "dispute path" is theoretical.

### B-AGGREGATION-01 — Decide and enforce the aggregation rule

Scope: today there is no "common wrong answers" surface, so the rule is not yet under threat. Before any future analytics PR adds one, encode the count-threshold (≥ 3, or ≥ 2 cross-group) in a single helper at `src/server/analytics/wrong-answer-aggregation.ts` and require its use as the only way to read wrong-answer text in an author-facing query.

---

## Tangential findings (not acted on)

1. `reactionType` is typed `text` in the table (`src/server/db/schema.ts:398`) rather than the existing `reactionCannedEnum`. This makes the DB enum dormant and lets the app diverge from the schema (which it does — see A2). Worth tightening when B-OPTIN-01 lands.
2. The `creatorResponseCannedEnum` and `creator_reaction_response` SMS type exist with no write path (A8). Either implement or remove.
3. PRD vs. code drift on the custom-message char cap (100 vs. 160) is already in `PRD_BACKLOG.md:61`.
4. `notifyPreviousAnswerers` (`src/server/feed/create-feed-items-for-answer.ts:150-173`) sends `friend_answered_your_question` activity to **previous co-answerers**, not to the question's author. The naming "your question" is misleading. Worth renaming or reusing for an actual author-side notification.
5. The answerers line at `/questions` (`src/app/questions/page.tsx:148-156`) names up to two people who answered the author's question. This is identity-attribution that §8.22 does not explicitly address (the rule is about *text*, not names). If product wants identity-anonymisation, this is the surface to revisit.
6. `Friendship` answerer-name attribution + the `customMessage` channel on reactions (160 chars of free text from answerer → author, with no opt-in metadata) together approximate a §8.22 leak via user behaviour: an answerer can paste their own submitted text into the customMessage. Not a code bug, but worth a copy/UX consideration in the reaction-composer.
