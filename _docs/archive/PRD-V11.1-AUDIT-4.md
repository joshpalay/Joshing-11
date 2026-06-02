# PRD v11.1 Audit 4 — Comprehensive Post-11.x Audit

Date: 2026-05-11  
Scope: independent read-through of function bodies, route logic, schema/migration files, and local command output. Prior `PRD-V11.1-AUDIT-3.md` was not present in this checkout, so prior statuses are taken only from user-supplied notes where explicitly stated; otherwise `N/A (audit-3 unavailable)`.

Legend: ✅ COMPLETE · 🟡 PARTIAL · 🔴 MISSING · ⚠️ DIVERGENT · ❓ UNCLEAR

## Delta Summary

| Item | Prior | Current | Notes |
| --- | :---: | :---: | --- |
| Build health | N/A | 🟡 | TypeScript exits 0. Production build fails only on Google Fonts fetch. Dev server starts but logs DB migration `ECONNREFUSED`. |
| Section 2 actual DB schema | N/A | ❓ | `DATABASE_URL` is unavailable, so live DB verification is deferred. Schema/migrations were read. |
| Prompt 9.0 rollback | N/A | 🟡 | No QuestionForm toggle/POST branch, but inert `authored_shared` compatibility filtering remains in `/api/feed`. |
| Prompt 9.1 categorizer | N/A | 🟡 | `reconcileProposedDomain` exists and daily generation calls it; authored question creation does not. |
| Prompt 9.2 domain backfill | N/A | ✅ | Backfill function, script, and admin endpoint exist. |
| Prompt 10.1 feed propagation | N/A | ✅ | Shared helper exists and is called by daily, catch-up, feed, and joshing answer routes. Dismissed-domain/thumbs-down/idempotency checks are present. |
| Prompt 10.2 authorship opens territory | N/A | ✅ | `openKBDomain` and promotion use `PLAYER_MASTERY`, not `DeclaredInterest`; all four answer routes call promotion. |
| Prompt 10.3 onboarding cultural anchor | N/A | ✅ | Client sends `culturalAnchor`; server validates/persists before LLM; max birth year is dynamic; generation gates on deep-dive + hour-long topic. |
| Prompt 10.4 joshing commentary | N/A | ✅ | Six banks, tests, persistence, and render path are present. |
| Prompt 10.5/10.6 hotfixes | N/A | ✅ | `html2canvas` build resolution is not the active failure; `declared_promoted` is in activity type union; `/api/questions/send` checks friendship. |
| Prompt 10.8 hardened hotfix | N/A | 🟡 | Code/migrations exist, but actual DB migration application cannot be verified without `DATABASE_URL`. |
| Prompt 11.1 chooser/game disable | N/A | ✅ | FAB opens chooser, game option disabled, direct POST returns 403, in-flight answer route remains present. |
| Prompt 11.2 critique/unverified | N/A | 🟡 | Core flow exists. Risk: live DB table naming may diverge from prompt's snake_case names; `/api/questions` silently drops invalid non-friend recipients instead of rejecting. |
| Prompt 11.3 | N/A | ❓ | No explicit 11.3 prompt/commit found. Recent commits indicate polish/hotfixes rather than a coherent 11.3. |
| Cross-cutting v11.1 | N/A | 🟡 | Required surfaces mostly present; spider component still exists but does not appear mounted on knowledge page. Feed dismissed-domain partial unique index is missing in schema/migrations. |
| Alpha readiness | Prior estimate 72% | 78% | Better than audit-3 based on restored 11.2 flow and account/manage interests, but DB verification, schema naming drift, and manual UX smoke remain blockers to confident launch. |

---

## SECTION 1 — Build Health

### Results

| Check | Status | Exit | Notes |
| --- | :---: | :---: | --- |
| `npx tsc --noEmit` | ✅ | 0 | No TS errors; npm config warning only. |
| `npm run build` | ⚠️ | 1 | Fails fetching Google Fonts (`Montserrat`) during Next build; this is environment/network font fetch, not an application type/module error. |
| `npm run dev` | 🟡 | 124 via timeout | Server reached `✓ Ready in 3.5s`; logged DB migration failure due `ECONNREFUSED`; command was killed by 15s timeout. |
| `rg -n "@prisma/client" src/` | ✅ | 1 | Zero matches; `rg` exit 1 means no matches. |
| `ls src/lib/prisma.ts` | ✅ | 2 | File absent as expected. |
| `find src -type f \\| wc -l` | ✅ | 0 | 246 files. |
| `npx drizzle-kit check` | ✅ | 0 | Reports `Everything's fine 🐶🔥`. |

### Proof of work

#### a) `npx tsc --noEmit`

```text
exit 0
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

Total TypeScript errors: 0. First 10 errors: none.

#### b) `npm run build`

```text
exit 1
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> joshing-v11@0.1.0 build
> next build

▲ Next.js 16.1.6 (Turbopack)

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
[next]/internal/font/google/montserrat_a93acac.module.css
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=swap

Import trace:
  Server Component:
    [next]/internal/font/google/montserrat_a93acac.module.css
    [next]/internal/font/google/montserrat_a93acac.js
    ./src/app/layout.tsx

> Build error occurred
Error: Turbopack build failed with 1 errors:
[next]/internal/font/google/montserrat_a93acac.module.css
next/font: error:
Failed to fetch `Montserrat` from Google Fonts.
```

#### `npm run dev`

```text
exit 124 (timeout after startup)
> joshing-v11@0.1.0 dev
> next dev

▲ Next.js 16.1.6 (Turbopack)
- Local:         http://localhost:3000
- Network:       http://172.30.1.210:3000

✓ Starting...
[instrumentation] DB migration failed — server will start but schema may be out of date: Error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
...
[cause]: AggregateError:
...
code: 'ECONNREFUSED'
}
✓ Ready in 3.5s
```

#### Prisma checks

```text
$ rg -n "@prisma/client" src/
# no output

$ ls src/lib/prisma.ts
ls: cannot access 'src/lib/prisma.ts': No such file or directory
```

#### File count

```text
$ find src -type f | wc -l
246
```

#### c) Migration drift check

```text
$ npx drizzle-kit check
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
No config path provided, using default 'drizzle.config.ts'
Reading config file '/workspace/Joshing-11/drizzle.config.ts'
Everything's fine 🐶🔥
```

---

## SECTION 2 — Schema Verification (CRITICAL)

`DATABASE_URL` is unavailable in this environment:

```text
NO_DATABASE_URL
```

Therefore all live database checks are **❓ UNCLEAR — DEFERRED-FOR-HUMAN**. I did verify schema and migration files where possible, but this does not prove deployed/local DB state.

| Item | Current | File-level evidence | Human/live DB check still needed |
| --- | :---: | --- | --- |
| 2.1 `player_mastery` / `PLAYER_MASTERY` territory type | ❓ | `schema.ts` defines `PLAYER_MASTERY.territory_type text NOT NULL DEFAULT 'demonstrated'`; migration `0018_daily_generated_and_player_mastery_territory.sql` adds it. | Run `psql $DATABASE_URL -c "\\d player_mastery"` or, if quoted/case-sensitive, `\\d "PLAYER_MASTERY"`. Confirm type/default/nullability. |
| 2.2 `questions` / `Question` generated/source/author/verified fields | ❓ | `schema.ts` defines `generated_question_id`, `source`, nullable `creator_id`, `verified`, `llm_suggested_answer`, `critique_iterations`; migration `0020` adds the v11.2 fields. | Run `psql $DATABASE_URL -c "\\d questions"` or `\\d "Question"`. Confirm actual table name and nullability/defaults. |
| 2.3 `critique_usage_daily` / `CritiqueUsageDaily` | ❓ | `schema.ts` and migration `0020` create `CritiqueUsageDaily` with unique `(user_id, usage_date)`. | Run `psql $DATABASE_URL -c "\\d critique_usage_daily"` and/or `\\d "CritiqueUsageDaily"`. Note prompt expects snake_case but app uses PascalCase table name. |
| 2.4 `feed_dismissed_domains` partial unique index | 🟡/❓ | `schema.ts` defines `FeedDismissedDomain` with ordinary indexes only; no partial unique index on active dismissals was found. | Run `psql $DATABASE_URL -c "\\d feed_dismissed_domains"` and/or `\\d "FeedDismissedDomain"`. If no partial unique index where `reinstated_at`/`reinstatedAt` is null, this remains 🟡. |

Schema drift concern: the user prompt names snake_case plural tables (`player_mastery`, `questions`, `critique_usage_daily`, `feed_dismissed_domains`), while this Drizzle schema mostly maps to quoted legacy/PascalCase names (`PLAYER_MASTERY`, `Question`, `CritiqueUsageDaily`, `FeedDismissedDomain`). If production DB uses quoted names, the app may work, but PRD naming expectations are divergent.

---

## SECTION 3 — Prompts 9.0 through 10.8 Regression Check

### 3.1 Prompt 9.0 — Broadcast share rollback

Status: **PARTIAL / no regression proven**

- ✅ `QuestionForm` has no visible `shareToFeed` toggle.
- ✅ `/api/questions` POST reads `sendToFriendIds`, not `shareToFeed`.
- 🟡 `authored_shared` remains as inert legacy filtering in `/api/feed/route.ts`; no active FeedList visual variant was found.
- ✅ Thumbs-down/dismiss confirmation UI still exists in `FeedList`.

Proof:

```text
$ rg -n "shareToFeed|authored_shared" src/
src/app/api/feed/route.ts:80:  // authored_shared is deprecated — filter inert rows until cleanup script removes them
src/app/api/feed/route.ts:81:  const feed = rawFeed.filter((item) => item.sourceType !== 'authored_shared');
src/app/api/feed/route.ts:127:        // legacy thumbs_upped (authored_shared rows are inert and filtered before this)
```

### 3.2 Prompt 9.1 — Categorizer fix

Status: **PARTIAL**

- ✅ `src/lib/questions/categorization.ts` has `reconcileProposedDomain`.
- ✅ Daily generation imports and calls it.
- 🔴 Question creation still does not call it; it trusts the selected domain.

Proof:

```text
$ rg -n "reconcileProposedDomain" src/
src/lib/questions/categorization.ts:23:export async function reconcileProposedDomain(
src/server/daily/generate-questions.ts:16:import { reconcileProposedDomain } from '@/lib/questions/categorization';
src/server/daily/generate-questions.ts:302:    const { canonicalDomain } = await reconcileProposedDomain(
```

### 3.3 Prompt 9.2 — Domain backfill

Status: **DONE**

- ✅ `runAggressiveDomainBackfillForUser` exists in `src/server/questions/domain-backfill.ts`.
- ✅ `scripts/backfill-domains.ts` exists.
- ✅ Admin endpoint exists at `src/app/api/admin/backfill-domains/route.ts`.

### 3.4 Prompt 10.1 — Feed propagation

Status: **DONE**

- ✅ `src/server/feed/create-feed-items-for-answer.ts` exists.
- ✅ Called from daily, catchup, feed, and joshing answer routes.
- ✅ Helper checks friends, idempotency/no active duplicate, dismissed domains, explicit feedback/thumbs-down, and negative ratings before insert.

Proof:

```text
$ rg -n "createFeedItemsForFriendsFromAnswer" src/app/api/
src/app/api/joshing-games/[id]/answer/route.ts:16:import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
src/app/api/joshing-games/[id]/answer/route.ts:124:    void createFeedItemsForFriendsFromAnswer(
src/app/api/daily/answer/route.ts:15:import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
src/app/api/daily/answer/route.ts:167:    void createFeedItemsForFriendsFromAnswer(
src/app/api/daily/catchup/answer/route.ts:13:import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
src/app/api/daily/catchup/answer/route.ts:145:    void createFeedItemsForFriendsFromAnswer(
src/app/api/feed/[feedItemId]/answer/route.ts:12:import { createFeedItemsForFriendsFromAnswer } from '@/server/feed/create-feed-items-for-answer';
src/app/api/feed/[feedItemId]/answer/route.ts:161:  void createFeedItemsForFriendsFromAnswer(
```

### 3.5 Prompt 10.2 — Authorship opens territory

Status: **DONE**

- ✅ `openKBDomain` writes to `playerMastery` (`PLAYER_MASTERY`) with `territoryType: 'declared'` for authorship.
- ✅ `promoteDeclaredToDemonstrated` operates on `playerMastery`, writes `masteryEvents`, and writes `ActivityItem` type `declared_promoted`.
- ✅ All four answer routes call promotion when correct and author differs.

Proof:

```text
$ rg -n "DeclaredInterest" src/server/knowledge/open-domain.ts
# no output

$ rg -n "promoteDeclaredToDemonstrated\(" src/app/api/
src/app/api/joshing-games/[id]/answer/route.ts:116:      void promoteDeclaredToDemonstrated({
src/app/api/daily/answer/route.ts:159:      void promoteDeclaredToDemonstrated({
src/app/api/daily/catchup/answer/route.ts:137:      void promoteDeclaredToDemonstrated({
src/app/api/feed/[feedItemId]/answer/route.ts:152:    void promoteDeclaredToDemonstrated({
```

### 3.6 Prompt 10.3 — Onboarding cultural anchor

Status: **DONE**

- ✅ `OnboardingFlow` sends `culturalAnchor`, not `demographicContext`.
- ✅ Server validates `birthYear`, `grewUpCountry`, and `grewUpRegion`, persists to user before the LLM call, then calls `proposeInterests` with `culturalAnchor`.
- ✅ Year picker max is dynamically computed from current year minus 13.
- ✅ `canGenerate` uses only `deepDive` + `hourLongTopic` as required.

### 3.7 Prompt 10.4 — Joshing commentary

Status: **DONE**

- ✅ `src/server/grading/select-quip.ts` exists with six banks: daily correct/wrong and four friend-result combinations.
- ✅ Quip columns exist on `FeedItem` and `JoshingGameResponse`.
- ✅ Daily/feed/joshing routes set quips.
- ✅ `GameplayChat` renders quip after result/breadcrumb content.
- ✅ `src/server/grading/select-quip.test.ts` exists.

### 3.8 Prompt 10.5/10.6 — Hotfixes

Status: **DONE**

- ✅ `npm run build` failure is Google Fonts fetch, not `html2canvas` resolution.
- ✅ `ActivityItemType` includes `declared_promoted`.
- ✅ `/api/questions/send` validates recipient is a friend before resolving/sending.

### 3.9 Prompt 10.8 — Hardened hotfix

Status: **PARTIAL**

- ❓ Migration applied cannot be verified without `DATABASE_URL`.
- ✅ Daily/catch-up persist a generated Question row via `persistGeneratedQuestion` before feed propagation.
- ✅ `territoryType` lives on `PlayerMastery` and promotions are wired into all four answer routes.
- ✅ `/api/questions/send` enforces friendship.

---

## SECTION 4 — Prompt 11.1: FAB Chooser + Joshing Game Disable

| Item | Current | Notes |
| --- | :---: | --- |
| 4.1 `CreateChooser` exists | ✅ | `src/components/CreateChooser.tsx` exists with two option buttons. |
| 4.2 FAB opens chooser | ✅ | `Nav.tsx` imports and mounts `CreateChooser`; FAB `onClick` sets chooser open. |
| 4.3 Add question route | ✅ | Chooser routes to `/questions?create=1`; equivalent modal-based creation route. |
| 4.4 Add Joshing Game disabled | ✅ | Disabled button has `cursor-not-allowed`, `opacity-40`, `disabled`, and `Coming soon.` text. |
| 4.5 Other entry points disabled | ✅ | Marker comments present in new-game page, FeedList, FriendsList, and knowledge domain page. |
| 4.6 Active creation labels absent | ✅ | Search returned zero active matches for requested labels. |
| 4.7 API endpoint blocked | ✅ | POST has early 403 guarded by `GAME_CREATION_DISABLED_IN_V11_1`. |
| 4.8 In-flight routes not disabled | ✅ | `[id]` folder remains under API, including answer route. |

Proof:

```text
$ rg -n "v11.1: Joshing Game creation disabled" src/
src/app/new-game/page.tsx:22:        // v11.1: Joshing Game creation disabled at FAB level. Re-enable
src/components/FeedList.tsx:384:            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
src/components/FriendsList.tsx:46:            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
src/app/knowledge/[domain]/page.tsx:237:          // v11.1: Joshing Game creation disabled at FAB level. Re-enable

$ rg -n "Send a game|New Joshing Game|Create game" src/
# no output

$ cat src/app/api/joshing-games/route.ts | head -25
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, questions, userQuestionBank, users } from '@/server/db';
import { getFriends } from '@/server/db/queries/friends';
import { createJoshingGame, JoshingGameValidationError } from '@/server/db/queries/joshing-game';
import { sendSms } from '@/server/sms';

export const dynamic = 'force-dynamic';

const GAME_CREATION_DISABLED_IN_V11_1: boolean = true;

type CreateJoshingGameBody = {
  title: string;
  recipientIds: string[];
  questionIds: string[];
};

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : request.nextUrl.origin;

$ ls src/components/CreateChooser.tsx
src/components/CreateChooser.tsx

$ ls src/app/api/joshing-games/
[id]
route.ts
```

---

## SECTION 5 — Prompt 11.2: Question Critique Loop + Unverified Tag

### 5.1 Schema additions

Status: **PARTIAL / DB UNCLEAR**

- ✅ File-level schema and migration add `Question.verified`, `Question.llm_suggested_answer`, and `Question.critique_iterations`.
- ✅ File-level schema and migration add `CritiqueUsageDaily`.
- ❓ Actual DB state not verified due missing `DATABASE_URL`.
- ⚠️ Prompt expects snake_case table names; app schema uses quoted PascalCase table names.

### 5.2 Critique LLM service

Status: **COMPLETE**

- ✅ `src/server/llm/critique.ts` exists.
- ✅ `critiqueQuestion` returns `{ ok: true }` or `{ ok: false, issues, reformulations }`.
- ✅ Uses Claude Sonnet model string (`claude-sonnet-4-5-20250929`).
- ✅ Uses `AbortSignal.timeout(8000)` and fail-open catch returning `{ ok: true }`.

### 5.3 Critique endpoint with rate limit

Status: **COMPLETE**

- ✅ POST exists at `src/app/api/questions/critique/route.ts`.
- ✅ Checks today's usage count.
- ✅ Returns `ok`, `limitReached`, and `remaining`.
- ✅ Uses raw SQL `INSERT ... ON CONFLICT DO UPDATE`.
- ✅ Soft-passes once count is `>= 5`.

Proof:

```text
$ rg -n "ON CONFLICT" src/app/api/questions/critique/route.ts
53:      ON CONFLICT ("user_id", "usage_date") DO UPDATE
```

### 5.4 QuestionForm state machine

Status: **COMPLETE**

- ✅ Uses `useReducer`.
- ✅ All seven states are present: `WRITING`, `CRITIQUING`, `CRITIQUED`, `ANSWERING`, `REVIEWING`, `SUBMITTING`, `DONE`.
- ✅ Critique fires on blur when stage is `WRITING`.
- ✅ Reformulation action sets `lastCritiquedText` and moves directly to `ANSWERING`, so it does not re-critique immediately.

Proof:

```text
$ rg -n "useReducer" src/components/QuestionForm.tsx
4:import { useEffect, useMemo, useReducer, useRef } from 'react';
225:  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(initialValues, initialSpecificMode));

$ rg -n "WRITING|CRITIQUING|CRITIQUED|ANSWERING|REVIEWING" src/components/QuestionForm.tsx
39:type Stage = 'WRITING' | 'CRITIQUING' | 'CRITIQUED' | 'ANSWERING' | 'REVIEWING' | 'SUBMITTING' | 'DONE';
85:  | { type: 'ANSWERING' }
108:    stage: 'WRITING',
138:    case 'START_CRITIQUE': return { ...state, stage: 'CRITIQUING', lastCritiquedText: action.text, error: null };
141:        return { ...state, stage: 'ANSWERING', limitReachedThisSession: true, remainingCritiquesToday: 0, critiqueResult: { ok: true } };
145:        return { ...state, stage: 'ANSWERING', remainingCritiquesToday: action.response.remaining, critiqueIterations: nextIterations, critiqueResult: { ok: true } };
147:      return { ...state, stage: 'CRITIQUED', remainingCritiquesToday: action.response.remaining, critiqueIterations: nextIterations, critiqueResult: action.response };
149:    case 'USE_REFORMULATION': return { ...state, questionText: action.text, lastCritiquedText: action.text, stage: 'ANSWERING' };
150:    case 'KEEP_VERSION': return { ...state, stage: 'ANSWERING' };
151:    case 'EDIT_RECHECK': return { ...state, stage: 'WRITING', critiqueResult: null };
152:    case 'ANSWERING': return { ...state, stage: 'ANSWERING' };
164:    case 'REVIEW': return { ...state, stage: 'REVIEWING', error: null };
165:    case 'BACK_TO_EDIT': return { ...state, stage: 'ANSWERING' };
376:          onBlur={() => { if (state.stage === 'WRITING') void runCritique(); }}
```

Blur handler area:

```tsx
<textarea
  ref={questionRef}
  id="question-text"
  value={state.questionText}
  onChange={(event) => dispatch({ type: 'FIELD', field: 'questionText', value: event.target.value.slice(0, 300) })}
  onBlur={() => { if (state.stage === 'WRITING') void runCritique(); }}
  rows={4}
  maxLength={300}
  required
/>
```

### 5.5 Critique counter UI

Status: **COMPLETE**

- ✅ Counter copy appears only when remaining is `2`, `1`, or `0`; `remaining > 2` returns null.
- ✅ Limit-hit inline note says `5/5 question reviews used today...`.
- ✅ Session state `limitReachedThisSession` persists through the form state until reset.

Proof:

```text
$ rg -n "reviews left today|reviews used today" src/components/QuestionForm.tsx
211:  if (remaining === 2) return '2 reviews left today';
366:        <p className="text-xs italic text-muted-foreground">5/5 question reviews used today. You can still save your question; AI review returns tomorrow.</p>
```

### 5.6 Verified flag computation

Status: **COMPLETE**

Verified logic is:

```ts
function computedVerified(state: State): boolean {
  if (!state.llmSuggestedAnswer) return true;
  return answersMatch(state.userAnswer, state.llmSuggestedAnswer);
}
```

Implications:

- ✅ Accepted LLM suggestion exactly: `llmSuggestedAnswer` present and normalized answer matches => `true`.
- ✅ User typed answer without Suggest: `llmSuggestedAnswer` null => `true`.
- ✅ User called Suggest then edited: mismatch => `false`.

### 5.7 Question creation API updates

Status: **COMPLETE**

Proof:

```text
$ rg -n "verified|llmSuggestedAnswer|critiqueIterations" src/app/api/questions/route.ts
77:  const verified = typeof body?.verified === 'boolean' ? body.verified : null;
78:  const llmSuggestedAnswer = typeof body?.llmSuggestedAnswer === 'string'
79:    ? body.llmSuggestedAnswer.trim() || null
81:  const critiqueIterations = typeof body?.critiqueIterations === 'number' ? body.critiqueIterations : Number.NaN;
94:  if (verified === null) errors.push('verified');
95:  if (!Number.isInteger(critiqueIterations) || critiqueIterations < 0) errors.push('critiqueIterations');
99:    value: { text, correctAnswer, alternateAnswers, explanation, creatorNote, domain, difficulty: difficultyValue, verified: verified ?? true, llmSuggestedAnswer, critiqueIterations: Number.isInteger(critiqueIterations) ? critiqueIterations : 0, sendToFriendIds: rawSendToFriendIds },
124:  console.info('[questions/create]', { questionId: created.id, userId: session.userId, verified: questionFields.verified });
```

`createQuestion` persists `verified`, `status`, `llmSuggestedAnswer`, and `critiqueIterations` into `Question`.

### 5.8 Unverified tag on Feed cards

Status: **COMPLETE**

Proof:

```text
$ rg -n "verified|unverified" src/components/FeedList.tsx
33:  verified: boolean;
420:                  {!item.verified ? (
427:                      ⚠ unverified
```

The tag is a button/popover toggle (`unverifiedOpenId`) with explanatory text.

### 5.9 Unverified tag in Archive

Status: **COMPLETE**

Proof:

```text
$ rg -n "verified|unverified" src/app/archive/
src/app/archive/page.tsx:33:  verified: boolean;
src/app/archive/page.tsx:179:      .filter((item) => !showOnlyVerified || item.verified)
src/app/archive/page.tsx:198:    if (showOnlyVerified) chips.push({ key: 'verified', label: 'Only verified', clear: () => setShowOnlyVerified(false) });
src/app/archive/page.tsx:269:          <span>Show only verified</span>
src/app/archive/page.tsx:401:        {!item.verified ? (
src/app/archive/page.tsx:402:          <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground" title="The author wrote their own answer instead of using the LLM's suggestion. The answer may not be standard.">⚠ unverified</span>
```

### 5.10 Verified hydrated everywhere

Status: **PARTIAL**

Proof:

```text
$ rg -n "verified" src/server/db/queries/
src/server/db/queries/questions.ts:50:  verified: boolean;
src/server/db/queries/questions.ts:160:    verified: row.verified,
src/server/db/queries/questions.ts:190:  verified: boolean;
src/server/db/queries/questions.ts:208:      answerSource: params.llmSuggestedAnswer ? (params.verified ? 'llm_suggested' : 'llm_edited') : 'creator_written',
src/server/db/queries/questions.ts:211:      verified: params.verified,
src/server/db/queries/questions.ts:212:      status: params.verified ? 'verified' : 'unverified',
src/server/db/queries/archive.ts:40:  verified: boolean;
src/server/db/queries/archive.ts:207:          verified: bankQuestion?.verified ?? true,
src/server/db/queries/archive.ts:278:      verified: question.verified,
src/server/db/queries/archive.ts:316:      verified: question.verified,
src/server/db/queries/archive.ts:370:      verified: question.verified,
```

`questions` and archive queries hydrate `verified`; feed hydration is in `/api/feed/route.ts` rather than `src/server/db/queries/`, so this is implemented but not in the exact location named by the proof command.

### Verified=false walkthrough

1. `QuestionForm` user requests an LLM suggestion; `SUGGESTION_RESULT` sets `llmSuggestedAnswer` and `userAnswer` to the suggestion.
2. User edits `userAnswer` before review.
3. `computedVerified` sees `llmSuggestedAnswer` exists and `answersMatch(userAnswer, llmSuggestedAnswer)` is false, so `verified=false`.
4. `finalSave` passes `{ verified: false, llmSuggestedAnswer, critiqueIterations }` to the parent submit handler.
5. `/api/questions` validates `verified` is boolean and `critiqueIterations` is a non-negative integer.
6. `createQuestion` writes `verified: false`, `status: 'unverified'`, `answerSource: 'llm_edited'`, `llmSuggestedAnswer`, and `critiqueIterations`.
7. API response shape includes `{ id, question, ...question, openedDomain }`; the returned `question` object includes `verified`, `llmSuggestedAnswer`, and `critiqueIterations` from `getQuestion`/`toQuestionView`.
8. Feed/archive render `⚠ unverified` when hydrated `verified` is false.

Risk: `/api/questions` validates friends but silently filters invalid `sendToFriendIds`; it does not return a 403 if some recipients are not friends. The dedicated `/api/questions/send` endpoint does 403.

---

## SECTION 6 — Prompt 11.3

No explicit `11.3` commit message, prompt artifact, or audit note was found in the recent git history. The recent history after the audit/11.1 work appears to be a series of polish/hotfix changes and then a 11.2 critique restore.

Proof:

```text
$ git log --oneline | head -30
60bb117 Merge pull request #72 from joshpalay/codex/restore-question-creation-critique-flow
a55a2ce Restore critique flow and unverified tags
f670216 Merge pull request #71 from joshpalay/codex/find-issue-with-play-now-functionality
5e18b6a Restore Daily Five setup entrypoint
8e5d26f Merge pull request #70 from joshpalay/codex/fix-tidying-issue-with-query
6a5caf0 Fix tidy mastery query compatibility
ea071a4 Merge pull request #69 from joshpalay/codex/fix-knowledge-page-loading-issue
e4f2026 Fix knowledge map loading resilience
1e9644e Merge pull request #68 from joshpalay/codex/fix-undefined-column-error-in-feeditem-query
9b1a75d Fix FeedItem column hotfix migration
97bd4a4 Merge pull request #67 from joshpalay/codex/verify-navigation-functionality
e0d2fa0 Match mobile navigation drawer design
6818c42 Merge pull request #66 from joshpalay/codex/move-missed-questions-above-feed
cc5dfbe Move missed questions above feed
9d3d933 Merge pull request #65 from joshpalay/codex/update-primary-navigation-structure
75564cb Update primary navigation IA
0715dd9 Merge pull request #64 from joshpalay/codex/conduct-joshing-codebase-alignment-audit-w9m1u1
531affa Rename PRD 11.1 audit rerun file
4964d0f Merge pull request #63 from joshpalay/codex/conduct-joshing-codebase-alignment-audit
ecea6af Add PRD 11.1 master alignment audit
4e831c9 Merge pull request #62 from joshpalay/codex/fix-vercel-build-failure-for-/questions
b379098 Fix questions page suspense boundary
130cb3a Merge pull request #61 from joshpalay/codex/implement-fab-chooser-and-disable-game-creation
01cb3f7 Disable Joshing Game creation
863d1d3 Merge pull request #60 from joshpalay/codex/remove-navigation-treat-from-home-page
284c206 Hide new game shortcut on home
8dfa31e Merge pull request #59 from joshpalay/codex/remove-bottom-most-level-chart
25d3b47 Remove progression level chart
252660f Merge pull request #58 from joshpalay/codex/remove-fab-button-from-make-questions
c0dc716 Hide new game FAB on answer pages
```

Best inference audit of possible 11.3 work:

| Inferred change | Current | Notes |
| --- | :---: | --- |
| Re-introduce broadcast share as opt-in | 🔴/⚠️ | Not present; rollback remains. If this was 11.3, it was not implemented. |
| Interpretive-line server module | ❓ | UI files for interpretive sections exist, but no clear 11.3 requirement artifact was found to audit against. |
| Searchable country picker | 🟡 | Onboarding country selector exists and validates ISO country, but I did not find a bespoke searchable country picker component. |
| Env-tunable Daily Five weights | ❓ | Not enough prompt context; daily generation exists but no explicit 11.3 contract found. |
| "Hidden Domains" rename | 🟡 | Knowledge page says `DOMAINS YOU'VE HIDDEN FROM YOUR FEED`; not a clean visible section title `Hidden Domains`. |
| Account "Manage interests" link | ✅ | Account page links `/knowledge?interests=manage`. |
| Recent hotfix: restore critique flow/unverified tags | ✅ | Implemented in `a55a2ce`. |
| Recent hotfix: restore Daily Five setup entrypoint | ✅ | `src/app/daily/setup/page.tsx` and `TodaysFiveCard` changed in `5e18b6a`. |

---

## SECTION 7 — Cross-cutting v11.1 PRD Conformance

### 7.1 Killed concepts

| Concept | Current | Notes |
| --- | :---: | --- |
| Broadcast share toggle on QuestionForm | ✅ | No `shareToFeed` toggle found. |
| `authored_shared` visual variant in FeedList | ✅ | No active FeedList variant found; only deprecated filtering in API. |
| Spider graph as Knowledge page view | 🟡 | `src/components/knowledge/SpiderGraph.tsx` still exists, but no import/mount found on `src/app/knowledge/page.tsx`. Dead component should be removed if PRD requires killed code absent. |
| Streak surfacing on Knowledge page | ✅ | No active `streak` match in knowledge page. |
| Dedicated "Your Declared Interests" section | ✅ | Manage interests modal exists; no dedicated always-on section with that title was found. |

### 7.2 Required surfaces

| Surface | Current | Notes |
| --- | :---: | --- |
| "Grow your map" section with 2 buttons | ✅ | Knowledge page has `Grow your map` with `Send a friend a question` and `Write a question`. |
| Account `Manage interests` link | ✅ | Present in Account nav list. |
| "Hidden Domains" section/name | 🟡 | Functionality exists as focused feed hidden domains; label is `DOMAINS YOU'VE HIDDEN FROM YOUR FEED`, not exactly `Hidden Domains`. |

### 7.3 Friend graph enforcement

| Route | Current | Friend-check evidence |
| --- | :---: | --- |
| `/api/joshing-games` POST | ✅ (currently blocked) | Direct POST returns 403 before any validation. If re-enabled, code below the guard checks `getFriends` and rejects non-friend recipients with 403. |
| `/api/users` | ✅ | Returns `getFriends(session.userId)` only. |
| `/api/questions/send` | ✅ | Calls `getFriends(session.userId)` and returns 403 if recipient is not in the set. |
| `/api/questions` direct create-and-send | 🟡 | Filters invalid `sendToFriendIds`, but does not reject/403 invalid recipients. |

Pasted checks:

```ts
// /api/questions/send
const friends = await getFriends(session.userId);
if (!friends.some((friend) => friend.id === parsed.recipientUserId)) {
  return NextResponse.json({ error: 'Recipient is not a friend.' }, { status: 403 });
}

// /api/users
const rows = await getFriends(session.userId);
return NextResponse.json(rows.map(...));

// /api/joshing-games, if guard is removed
const friends = await getFriends(session.userId);
const friendIds = new Set(friends.map((friend) => friend.id));
if (uniqueRecipientIds.some((recipientId) => !friendIds.has(recipientId))) {
  return NextResponse.json({ error: 'You can only send Joshing Games to friends.' }, { status: 403 });
}
```

### 7.4 Production safety

| Item | Current | Notes |
| --- | :---: | --- |
| OTP `000000` hardcoded | ⚠️ | Still present in `src/server/auth/otp-store.ts`; user chose to keep this for testing, so not a blocker here. |
| `vercel.json` crons | ✅ | Daily assignments `0 6 * * *`; biweekly ceremony `0 8 * * *`. |
| Env check validates Twilio vars | ✅ | `src/env-check.ts` requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`. |

---

## SECTION 8 — End-to-End Flow Verification (read-only trace)

| Journey | Current | Trace |
| --- | :---: | --- |
| 8.1 New user onboarding | ✅ | `/login` OTP flow exists; `/onboarding` uses `OnboardingFlow` stages for welcome/cultural anchor/warmup/review/confirmation; server persists cultural anchor and interests; final route pushes `/`. Browser smoke still needed. |
| 8.2 Question creation with critique loop | 🟡 | FAB → chooser → `/questions?create=1` → `QuestionForm` blur calls critique → reformulations route to `ANSWERING` → suggestion/edit makes unverified → review shows indicator → save writes DB fields. Risk: route is query-modal equivalent rather than literal `/questions/new`; browser smoke needed. |
| 8.3 Critique daily limit | ✅ | Endpoint soft-passes at 5 with `{ ok:true, limitReached:true, remaining:0 }`; UI shows `5/5 question reviews used today` and permits save. |
| 8.4 Friend-answered Feed propagation | ✅ | Daily answer persists generated question, calls propagation helper, inserts `FeedItem` for friends, and `/api/feed` hydrates cards. |
| 8.5 Authored question opens declared territory | ✅ | `/api/questions` calls `openKBDomain(via:'authorship')`; inserts `PLAYER_MASTERY` `territoryType:'declared'`; knowledge query maps declared/demonstrated styling. |
| 8.6 Friend promotion to demonstrated | ✅ | Correct non-author answer routes call `promoteDeclaredToDemonstrated`, updating `PLAYER_MASTERY`, writing `MASTERY_EVENTS`, and writing `ActivityItem` `declared_promoted`. |
| 8.7 Joshing Game creation blocked | ✅ | Chooser game option disabled/no-op; direct POST returns 403. |
| 8.8 Joshing Game in-flight playable | ✅ | `/api/joshing-games/[id]/answer/route.ts` remains active; `[id]` API folder still present. UI route is `/games/[id]`, not `/joshing-games/[id]`. |
| 8.9 Unverified tag visible to recipients | ✅/🟡 | FeedList renders `⚠ unverified` and popover when hydrated false. Need browser smoke to confirm card path from direct-send after creation. |

---

## SECTION 9 — TODO Drift

Command:

```text
$ rg -n "TODO|FIXME|XXX|HACK" src/ | wc -l
24
```

Comparison: audit-3 count was supplied as approximately 20 TODOs, so current count is higher by ~4.

New/recent-looking TODOs or markers:

```text
src/lib/games/winner.ts:40:  // TODO v11.0: group member lookup needs new data source
src/lib/games/winner.ts:41:  // TODO v11.0: group lookup needs new data source
src/lib/games/winner.ts:42:  // TODO v11.0: answer.game_id winner scoping - needs new data source
src/server/mastery/season-snapshot.ts:32:  // TODO v11.0: "GroupMember" raw SQL table - needs new data source
src/server/sms.ts:155:    // TODO v11.0: group member lookup needs new data source
src/server/db/queries/daily.ts:339: * called. Scheduled for removal in v11.2.
src/components/FeedList.tsx:384:            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
src/components/FriendsList.tsx:46:            // v11.1: Joshing Game creation disabled at FAB level. Re-enable
src/app/new-game/page.tsx:22:        // v11.1: Joshing Game creation disabled at FAB level. Re-enable
src/app/knowledge/[domain]/page.tsx:237:          // v11.1: Joshing Game creation disabled at FAB level. Re-enable
```

Resolved TODOs: cannot compare precisely because `PRD-V11.1-AUDIT-3.md` is absent in this checkout. The lingering `Scheduled for removal in v11.2` comment in `src/server/db/queries/daily.ts` is now stale and should be reviewed.

---

## SECTION 10 — Discipline Check (Meta)

### 10.1 Hardened-verification format

- Recent commit messages are concise (`Disable Joshing Game creation`, `Restore critique flow and unverified tags`, etc.) and do not themselves include proof-of-work artifacts.
- Audit files exist (`PRD-11.1-MASTER-ALIGNMENT-AUDIT*.md`, `PRD-V11.1-AUDIT*.md`) but `PRD-V11.1-AUDIT-3.md` is absent, so I cannot verify whether 11.1/11.2/11.3 final reports followed hardened format.
- Reported DONE items that still need artifacts/manual proof: 11.2 browser UX, DB migration application, direct-send unverified recipient visibility, and mobile FAB chooser rendering.

### 10.2 REQUIRES-HUMAN verifications skipped/unknown

No browser/manual verification artifact was found for:

- Critique loop renders correctly in browser.
- Reformulation tap does not trigger re-critique.
- 5/day cap soft-pass is visible to user.
- FAB chooser displays correctly on mobile.
- Disabled Joshing Game option is visibly disabled, not just absent/invisible.

Bug classes a smoke test would catch:

1. Focus/blur loop repeatedly triggering critique.
2. Mobile modal z-index/scroll lock issues.
3. Disabled game option hidden below fold or inaccessible to screen readers.
4. Suggestion/edit/review state mismatch causing wrong `verified` flag.
5. Daily limit UI not persisting after route transitions/form state updates.

### 10.3 Silent failures masked by try/catch

Proof command:

```text
$ rg -n "catch.*\{.*//\s*ignore|catch.*\{.*$" src/server/
src/server/grading.ts:59:  ).catch((error) => {
src/server/llm/critique.ts:79:  } catch (error) {
src/server/llm/interests.ts:89:    } catch {
src/server/daily/generate-questions.ts:274:  } catch (err) {
src/server/daily/generate-questions.ts:288:    } catch (err2) {
src/server/daily/generate-questions.ts:305:    ).catch(() => ({ canonicalDomain: question.canonical_subcategory, reconciled: false }));
src/server/feed/create-feed-items-for-answer.ts:15:  } catch (error) {
src/server/mastery/awards.ts:381:  } catch (error) {
src/server/mastery/ceremony.ts:181:  } catch (err) {
src/server/profile/multitudes.ts:110:  } catch (error) {
src/server/activity/write-activity.ts:34:  } catch (error) {
src/server/db/queries/activity.ts:576:  } catch (error) {
src/server/db/queries/knowledge.ts:144:  } catch (error) {
src/server/db/queries/archive.ts:110:  } catch {
src/server/db/queries/feed.ts:142:  } catch (error) {
src/server/db/queries/reactions.ts:90:    sendSms(recipientRow.phoneNumber, body, 'question_reaction', params.recipientUserId).catch((error) => {
src/server/db/queries/reactions.ts:158:  } catch (error) {
src/server/db/queries/declared-interests.ts:25:  } catch (err) {
src/server/creator-notes.ts:75:  } catch (error) {
src/server/knowledge/open-domain.ts:116:  } catch (error) {
src/server/auth/session.ts:117:  } catch {
src/server/questions/persist-generated-question.ts:66:  } catch (error) {
src/server/sms.ts:33:    } catch (err) {
src/server/sms.ts:70:  } catch (err) {
```

Concerning patterns:

- `src/server/llm/critique.ts` intentionally fail-opens; acceptable for UX but can mask repeated LLM failure and cost/quality problems unless monitored.
- `src/server/feed/create-feed-items-for-answer.ts` catches helper failures and returns `0`; answer routes call it with `void`, so propagation failures are silent to users.
- `src/server/knowledge/open-domain.ts` catches promotion failures and only logs; declared promotion could silently fail.
- `src/server/questions/persist-generated-question.ts` catch path can make propagation fail later if not logged/monitored.
- `src/server/db/queries/archive.ts` has a bare catch; inspect before alpha.

---

## SECTION 11 — Top Risks

### 11.1 Top 3 v11.1 requirements still missing

1. Live DB schema verification and migrations applied, especially 11.2 fields and `CritiqueUsageDaily`.
2. Partial unique index for active feed dismissed domains is absent in schema/migrations.
3. Exact `Hidden Domains` naming and full removal of killed/dead spider graph code are not clean.

### 11.2 Top 3 PARTIAL items most likely to break in alpha

1. Question creation direct send silently ignores invalid non-friend recipients rather than rejecting.
2. Feed propagation/promotion are fire-and-forget and can fail silently.
3. Critique loop state machine has not been browser-smoked; blur/refocus can be brittle.

### 11.3 Top 3 recent prompt short-circuits

1. 11.3 intent cannot be determined from git history, so its acceptance criteria are effectively unverifiable.
2. 11.2 schema/table naming follows legacy quoted Drizzle names, not prompt snake_case names.
3. Several items are code-present but lack human proof-of-work artifacts.

### 11.4 Top 3 production behavior risks

1. Propagation chain volume and duplicate control under real friend graphs; helper is called for every answer and errors are not surfaced.
2. Critique cost/runaway usage if `CritiqueUsageDaily` migration is missing or `ON CONFLICT` table naming differs.
3. Quip repetition/quality: short static banks may feel repetitive in alpha.

---

## SECTION 12 — Production Smoke Test Checklist

Use two test accounts A and B that are friends. Run against staging or local with a real DB.

| # | Action | Expected outcome | What it catches |
| --- | --- | --- | --- |
| 1 | A signs in via `/login` using SMS/OTP, completes onboarding cultural anchor, warmup, review, confirmation. | A lands on `/`; cultural anchor and interests persist. | Auth/session, cultural anchor validation, onboarding navigation. |
| 2 | In A, open Account and tap `Manage interests`. | Knowledge page opens manage modal. | Account link + knowledge modal route param. |
| 3 | Tap mobile FAB. | Chooser opens with `Add a question` active and `Add a Joshing Game` visibly disabled. | Mobile modal layout, disabled state visibility. |
| 4 | Tap `Add a Joshing Game`. | Nothing submits/navigates; option remains disabled. Direct POST `/api/joshing-games` returns 403. | Defense-in-depth game creation block. |
| 5 | Tap `Add a question`, type a clean unambiguous question, blur. | Critique either passes or shows suggestions; no repeated loop. | Blur critique and state transition. |
| 6 | Type an ambiguous question and blur; tap a reformulation. | Reformulation appears in question text and moves to answer stage without immediate re-critique. | Reformulation no-recritique behavior. |
| 7 | Request answer suggestion, edit the answer, review. | Review shows `⚠ Unverified`; save succeeds and DB row has `verified=false`. | Verified computation and DB persistence. |
| 8 | Trigger five critiques, then a sixth. | Sixth soft-passes; UI says `5/5 question reviews used today`; question can still save. | Rate cap, soft pass, inline note. |
| 9 | A answers a Daily Five question. | Answer result shows quip; persisted `Question` row exists; B receives feed item if eligible. | Daily persist + propagation. |
| 10 | B opens `/feed` and answers A's propagated/authored question correctly. | Feed shows card; after correct answer, A's domain promotes to demonstrated and A gets `declared_promoted` activity. | Feed answer, promotion, activity. |
| 11 | Forge `/api/questions/send` from A to non-friend user ID. | 403 `Recipient is not a friend.` | Friend graph enforcement. |
| 12 | Open existing in-flight game `/games/[id]`; submit answer as recipient. | POST `/api/joshing-games/[id]/answer` succeeds and results/quip render. | In-flight game playability despite creation block. |

---

## SECTION 13 — Final Verdict

### (a) Conformance estimate

Prior supplied estimate: 72%. Current estimate: **78%**.

Positive movement:

- 11.1 chooser/game-disable path is implemented and API-blocked.
- 11.2 critique flow, rate limit, verified flag, feed/archive unverified tag, and DB write path are implemented.
- Account `Manage interests` link now exists.
- Recent hotfixes improved daily setup and knowledge loading.

Negative/unchanged:

- Live DB state cannot be verified.
- Feed dismissed-domain partial unique index appears missing.
- 11.3 intent is unclear.
- Manual UX verification is still absent.
- Several critical side effects remain fire-and-forget/log-only.

### (b) Alpha-readiness

Not fully ready for a 3–5 user alpha that includes the 11.2 question creation flow until the following are done:

1. Run the Section 2 live DB checks and confirm migrations are applied.
2. Browser smoke the critique loop, daily cap, mobile FAB chooser, disabled game option, and unverified recipient card.
3. Decide whether `/api/questions` create-and-send should reject any non-friend IDs with 403 rather than silently dropping them.
4. Add/confirm unique active dismissed-domain index if duplicate active dismissals matter.

If those pass, the social loop is likely alpha-capable.

### (c) Recommended next move

**Targeted hotfix + smoke test.** Hotfix should be small:

- Add/confirm feed dismissed-domain partial unique index (or document why not needed).
- Make `/api/questions` direct create-and-send reject invalid non-friend recipients.
- Add monitoring/log surfacing for propagation/promotion failures or return awaited results in alpha.
- Remove stale TODO/comment for v11.2 daily helper if safe.

Then run the Section 12 smoke checklist and proceed to alpha if green.

### (d) Honest assessment

Audits are showing diminishing returns on code-present requirements. The biggest remaining unknowns are live DB state and real browser behavior, not static code. After one targeted hotfix pass and the smoke checklist, stop auditing and start alpha testing with 2–3 trusted users before widening to 3–5.
