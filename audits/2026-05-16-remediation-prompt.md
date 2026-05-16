# Remediation Prompt — Audit 2026-05-16

**Reference:** `audits/2026-05-16-phase1-triage.md`, `audits/2026-05-16-phase2-findings.md`  
**Branch:** develop on the current working branch; commit after each logical group.

This prompt is organized in four tracks. **Tracks 1 and 4 have no dependencies — start immediately.** Tracks 2 and 3 each open with a product decision that must be confirmed in writing before engineering begins; the engineering sub-tasks are written out so they can start the moment the decision lands.

Do not modify files outside the scope described. Do not open PRs until explicitly asked.

---

## Track 1 — Pure engineering, no decisions required

### 1.1 · Write `src/middleware.ts`

The session system was refactored to support Next.js App Router middleware (`readSessionClaims` in `src/server/auth/session.ts:128–145` is Edge-safe, comment says "Used by middleware to gate authenticated routes"), but `middleware.ts` was never created.

Write `src/middleware.ts`. Behavior:

1. Skip enforcement for: `/login`, `/invite/`, `/api/auth/`, `/_next/`, `/favicon.ico`, and static file extensions.
2. Read the `joshing_session` cookie. Call `readSessionClaims(token)` from `@/server/auth/session`.
3. If `claims` is null (no session / expired / invalid): redirect to `/login` for page routes; return `{ error: 'unauthorized', status: 401 }` for `/api/` routes.
4. If `claims.invitationAccepted === false` (legacy session issued before the `inv` claim existed): redirect to `/api/auth/refresh-session` for page routes; return `{ error: 'session_refresh_required', status: 401 }` for `/api/` routes. The existing refresh endpoint (`src/app/api/auth/refresh-session/route.ts`) upgrades the JWT without forcing re-login.
5. Otherwise: pass through.

Export a `config.matcher` that covers all paths except Next.js internals.

Add a test in `src/__tests__/middleware.test.ts` covering: (a) unauthenticated redirect, (b) valid session passes through, (c) legacy session (no `inv` claim) triggers refresh, (d) public path bypasses enforcement.

### 1.2 · Add invitation check to onboarding page

**File:** `src/app/onboarding/page.tsx:8–32`

After the existing `user.onboardingComplete` check, before rendering `OnboardingFlow`, add a query that verifies the current user has at least one accepted `friendInvitations` row:

```typescript
const hasInvitation = await db
  .select({ id: friendInvitations.id })
  .from(friendInvitations)
  .where(and(
    eq(friendInvitations.inviteeUserId, session.userId),
    isNotNull(friendInvitations.acceptedAt),
  ))
  .limit(1)

if (hasInvitation.length === 0) {
  redirect('/login')
}
```

Import `friendInvitations` from `@/server/db`. This is belt-and-suspenders alongside the middleware; it protects the onboarding route even if a future code path bypasses the general gate.

### 1.3 · Fix `--font-neutral` to resolve to Montserrat

**File:** `src/app/globals.css:94`

`--font-neutral` currently resolves to `var(--font-sans)`, which is the system sans-serif stack (`ui-sans-serif, system-ui...`). Montserrat is loaded in `layout.tsx` with the CSS-variable name `--font-sans-body` and applied to `<body>` via `className` — but nothing wires `--font-neutral` to it.

Change line 94:
```css
/* before */
--font-neutral: var(--font-sans);

/* after */
--font-neutral: var(--font-sans-body, ui-sans-serif, system-ui, -apple-system, sans-serif);
```

The fallback chain ensures SSR and non-font contexts still get a sensible sans-serif before next/font injects `--font-sans-body`.

Optionally also update `--font-sans` itself: `--font-sans: var(--font-sans-body, ui-sans-serif, system-ui, sans-serif);` so Tailwind's `font-sans` utility resolves to Montserrat too.

### 1.4 · Encode INK / CREAM / HILITE brand tokens

**File:** `src/app/globals.css`, then a sweep of component files.

The brand palette is used consistently but hardcoded as hex literals (`#1a1208`, `#fdfbf6`, `#f5f0e8`, `#ddd6c7`) throughout components. Add named CSS variables to `:root` in `globals.css`:

```css
/* Joshing brand palette — INK on CREAM editorial register */
--ink:          oklch(0.14 0.018 55);   /* #1a1208 — warm near-black */
--cream:        oklch(0.976 0.010 80);  /* #fdfbf6 — off-white surface */
--cream-warm:   oklch(0.962 0.018 80);  /* #f5f0e8 — slightly deeper warm surface */
--cream-accent: oklch(0.930 0.030 80);  /* #f0e6c8 — highlight/accent surface */
--border-warm:  oklch(0.876 0.016 80);  /* #ddd6c7 — warm border */
--text-muted-warm: oklch(0.600 0.020 60); /* #696257 — muted editorial text */
```

Verify these match the actual hex values in use before committing (sample with a color picker or convert directly). Then sweep the primary surfaces:

- `src/app/knowledge/page.tsx` — replace all `#1a1208`, `#fdfbf6`, `#f5f0e8`, `#f0e6c8`, `#ddd6c7`, `#696257` with the new variables.
- `src/components/progression/TierProgressBar.tsx:42` — `border: '1px solid #d8d2c6'` → `border: '1px solid var(--border-warm)'` (note: `#d8d2c6` is close to `--border-warm`; confirm exact match).
- `src/app/ceremony/` — any inline palette colors.

Do not sweep shadcn `ui/` components — those intentionally use the Radix/shadcn token names.

### 1.5 · Suppress `'General'` fallback in ceremony Beat 2

**File:** `src/server/ceremony/compute-beats.ts:139`

```typescript
// before
function domainFor(question) {
  return question.canonicalSubcategory || question.broadCategory || question.category || 'General';
}

// after
function domainFor(question): string | null {
  return question.canonicalSubcategory || question.broadCategory || question.category || null;
}
```

Update callers `gameAnswers.forEach` (line ~243) and `feedAnswers.forEach` (line ~244) to skip null domains:

```typescript
gameAnswers.forEach((row) => {
  const domain = domainFor(row.question);
  if (domain) add(domain, row.isCorrect === true);
});
feedAnswers.forEach((row) => {
  const domain = domainFor(row.question);
  if (domain) add(domain, correctQuestionIds.has(row.question.id));
});
```

Add a test case in `src/server/ceremony/__tests__/` covering a question with all three category fields null — confirm it doesn't produce a `'General'` entry in Beat 2.

### 1.6 · Add type enforcement on `feedItems.sourceResult`

**File:** `src/server/db/schema.ts` around line 683.

The column is currently bare `text('sourceResult')`. Add a TypeScript type cast and a migration with a CHECK constraint:

In schema.ts, change:
```typescript
sourceResult: text('sourceResult'),
```
to:
```typescript
sourceResult: text('sourceResult').$type<'correct' | 'incorrect' | null>(),
```

Create a new Drizzle migration adding the constraint:
```sql
ALTER TABLE "FeedItem"
  ADD CONSTRAINT "FeedItem_sourceResult_check"
  CHECK ("sourceResult" IN ('correct', 'incorrect') OR "sourceResult" IS NULL);
```

Check all write sites for `sourceResult` (primarily `src/server/feed/create-feed-items-for-answer.ts`) to confirm they only write `'correct'` or `'incorrect'`.

### 1.7 · Remove dead `AUTHORED_SHARED_FEED_SOURCE_TYPE` export

**File:** `src/server/feed/visibility.ts:6`

Remove the exported constant `AUTHORED_SHARED_FEED_SOURCE_TYPE = 'authored_shared'`. PRD v11.1 explicitly killed authored-shared as a write path; exporting the constant misleads future contributors about its status.

Before removing: grep all `import` sites for this constant. The remaining read-path references in `src/server/db/queries/feed.ts:265` and `src/server/db/queries/activity.ts:543` can replace the import with an inline string literal and a comment:

```typescript
// 'authored_shared' is legacy-read-only: no new rows are written with this value
// (PRD v11.1 §8.2 killed authored-shared as a write path). Retained here to
// serve existing DB rows.
```

Also remove `LEGACY_THUMBS_UPPED_FEED_SOURCE_TYPE` from the same file by the same logic. The string `'thumbs_upped'` appears only as legacy-read support.

### 1.8 · Update "Grow your map" copy

**File:** `src/app/knowledge/page.tsx:503–513`

Replace the current copy (which only describes direct-send) with copy that makes all three expansion paths legible, per PRD §8.4.11:

```tsx
<p className="mt-3 text-[0.88rem] leading-[1.6] text-[var(--text-muted-warm)]">
  Your map grows whenever you correctly answer a question that came through
  a friend — from your Feed, from a direct send, or from a Joshing Game.
</p>
<p className="mt-3 text-[0.88rem] leading-[1.6] text-[var(--text-muted-warm)]">
  It also grows when you write a question yourself. The domain you wrote in
  opens as declared territory on your map. When a friend answers it correctly,
  it becomes proven.
</p>
<p className="mt-3 text-[0.88rem] leading-[1.6] text-[var(--text-muted-warm)]">
  One way to start: ask a friend about something you&apos;d love to learn from
  them — Disney World, 1970s BBC Drama, the 1956 Hungarian Uprising. The ask
  itself plants the seed.
</p>
```

(Use `var(--text-muted-warm)` once Track 1.4 is in place; otherwise use the existing hardcoded color class.)

### 1.9 · Time-bound and mode-gate ceremony Beat 4

**File:** `src/server/ceremony/compute-beats.ts:317–362`

**Two changes:**

**a) Suppress Beat 4 (and Beat 3) entirely when `mode === 'solo'`.**

`computeBeats` currently runs all five beats in parallel. Pass `activeAnsweringPlayers` (already computed) into `computeBeat3` and `computeBeat4`, and short-circuit when the count indicates solo:

```typescript
// Inside computeBeats, after parallel resolution:
const mode = ceremonyModeFromAnsweringCount(activeAnsweringPlayers);
const beat3Final = mode === 'solo' ? null : beat3;
const beat4Final = mode === 'solo' ? null : beat4;
```

**b) Gate Beat 4 on the friend having been active in the cycle.**

In `computeBeat4`, before building the candidate map, filter the friend list to only those who have at least one mastery event in the cycle window:

```typescript
const activeFriendIds = new Set(
  (await db
    .selectDistinct({ userId: masteryEvents.userId })
    .from(masteryEvents)
    .where(and(
      inArray(masteryEvents.userId, [...friendIds]),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      gte(masteryEvents.createdAt, cycleStart),   // pass cycleStart into computeBeat4
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ))
  ).map(r => r.userId)
);
```

Then replace `friendIds.has(row.userId)` with `activeFriendIds.has(row.userId)` in the candidate filter. Update `computeBeat4`'s signature to accept `cycleStart` and `cycleEndExclusive`.

### 1.10 · Fix `CANONICALIZE_MODEL` to fully-qualified model ID

**File:** `src/server/llm/interests.ts:33`

```typescript
// before
const CANONICALIZE_MODEL = 'claude-haiku-4-5';

// after — move to src/lib/llm.ts alongside ANTHROPIC_MODEL
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
```

In `interests.ts`, import and use `HAIKU_MODEL` from `@/lib/llm`. This co-locates all model ID strings in one file, making future model version bumps a single-file change.

### 1.11 · Remove Prisma dead dependency (P3 cleanup)

- Remove `@prisma/client` and `prisma` from `package.json` (both `dependencies` and `devDependencies`).
- Delete `prisma/schema.prisma`.
- Run `npm install` to remove from `node_modules`.
- Grep `scripts/` for any `prisma` CLI invocations; remove them.
- Grep `_docs/` for Prisma references; note them as stale in any affected doc.
- Run `npx tsc --noEmit` to confirm no type errors after removal.

---

## Track 2 — Author credit (product decision required first)

### ⚠️ Decision 2A — Which author-credit model ships?

Two models are in play. Confirm one before the engineering tasks below begin.

**Option A — PRD-locked model** (simpler, spec-aligned):
- Award = `AUTHOR_CREDIT_WEIGHT (0.5) × DIFFICULTY_BASE_POINTS[difficulty].first_correct`
- Restricted to Moderate and Specialist questions only; Accessible = zero credit
- One credit per question per answering player (already enforced by the `MASTERY_EVENTS` unique constraint on `(sourceType, questionId, answeredByUserId)`)
- No credit window; unlimited total credits as more unique players answer
- Apply to all three answer surfaces (Daily, Feed, Joshing Game)

**Option B — Current windowed model** (already in production for Joshing Game):
- Award = empirical-rate base points (25/50/100), full credit for first 2–5 answerers, half for next 2–5, zero after
- Currently Accessible questions are included — add the `accessible` filter or not, your choice
- Extend to Feed and Daily surfaces (same window logic, same DB constraint for idempotency)

The `AUTHOR_CREDIT_WEIGHT = 0.5` constant in `src/server/mastery/constants.ts:36–41` already documents this pending decision.

---

_Once Decision 2A is confirmed, execute the tasks below._

### 2.1 · Extract `countAuthorCreditEvents` into shared module

**Current location:** private function in `src/server/db/queries/joshing-game.ts:130–141`

Move to a new shared file `src/server/mastery/author-credit.ts`. Export it. Update `joshing-game.ts` to import from the new location. Feed and Daily routes will also import it in task 2.2.

### 2.2 · Add difficulty gate to `creatorMasteryAwardForNthCorrect`

**File:** `src/server/mastery/scoring.ts:75–94`

Add a `difficulty: LegacyDifficultyEstimate | null` parameter to the function. Add at the top of the function body:

```typescript
// PRD-locked: accessible questions earn no author credit
if (!difficulty || difficulty === 'accessible') {
  return { basePoints: 0, weight: 0, awardedPoints: 0 };
}
```

If Option A was chosen: also replace the empirical-rate base with:
```typescript
const basePoints = DIFFICULTY_BASE_POINTS[difficulty]?.first_correct ?? 50;
const awardedPoints = Math.round(basePoints * AUTHOR_CREDIT_WEIGHT);
return { basePoints, weight: AUTHOR_CREDIT_WEIGHT, awardedPoints };
```

Update the call site in `joshing-game.ts:427` to pass `question.calibratedDifficulty ?? question.llmDifficulty`.

Update the note in `scoring.ts` to remove "NOTE (F2.5)" and document the resolved model.

### 2.3 · Write author credit from Feed and Daily answer surfaces

**Files:** `src/app/api/feed/[feedItemId]/answer/route.ts`, `src/app/api/daily/answer/route.ts`, `src/app/api/daily/catchup/answer/route.ts`

After each surface's mastery event write, add author-credit logic. The pattern is the same for all three:

```typescript
if (isCorrect && question.creatorId && question.creatorId !== session.userId) {
  const difficulty = question.calibratedDifficulty ?? question.llmDifficulty ?? null;
  const existingCredits = await countAuthorCreditEvents(question.id, question.creatorId);
  const award = creatorMasteryAwardForNthCorrect(
    question.correctCount,
    question.askedCount,
    existingCredits + 1,
    difficulty,
  );
  if (award.awardedPoints > 0) {
    await writeMasteryEvent({
      userId: question.creatorId,
      questionId: question.id,
      domain,
      pointsAwarded: award.awardedPoints,
      sourceType: 'author_credit',
      sourceId: /* feedItemId / queue slot id / catchup item id */,
      broadCategory: question.broadCategory,
      eventQuestionId: question.id,
      basePoints: award.basePoints,
      weight: award.weight,
      answeredByUserId: session.userId,
    }).catch((err) => {
      console.warn('[surface/answer] author_credit write failed', err);
    });
  }
}
```

The existing `MASTERY_EVENTS` unique constraint on `(sourceType, questionId, answeredByUserId)` enforces idempotency — a duplicate write attempt will throw a constraint violation that the `.catch` handles silently.

Add tests in `src/server/mastery/__tests__/` verifying: author credit is written on Feed correct answer; author credit is NOT written on Accessible questions; no double-credit when same player answers same question from two surfaces.

---

## Track 3 — Ceremony architecture (product decision required first)

### ⚠️ Decision 3A — Biweekly personal, or two-act per-game?

The PRD specifies a two-act ceremony tied to game completion. The code ships a biweekly personal cron. Confirm which model is current:

**Option A — Biweekly personal (current code):** The shipped model. Update PRD ceremony sections (§8.1.x) to match what ships. No schema or server changes needed for the core ceremony logic. Minor UI changes in Task 3.1 can proceed now.

**Option B — Two-act per-game (PRD-specified):** Requires a separate, scoped prompt covering: new `gameCeremonies` table keyed on `gameId`; an "all players finished" trigger on `joshingGameResponses`; Act 1 / Act 2 fire functions with separate beat payloads; mode-specific beat suppression; UI changes for the two-act progression. This is a substantial scope — estimate and scope separately before starting.

---

_Task 3.1 is safe to implement regardless of Decision 3A:_

### 3.1 · Ceremony copy branches on `mode` (UI only)

**File:** `src/app/ceremony/[ceremonyId]/page.tsx`

Read `payload.mode` from the beats payload. The mode is already computed and stored (`'solo' | 'duo' | 'group'`).

- For Beat 3 section: if `mode === 'solo'` and beat3 is present for some reason, render with solo-register copy ("Questions that shaped your cycle" rather than "Questions your friends brought to you").
- For Beat 4 section: if `mode === 'solo'`, suppress the section entirely or display: "Play with friends to unlock your alignment story."
- For the overall ceremony header/intro: consider a solo-register variant ("Your last two weeks" rather than copy that implies group context).

No schema changes needed. Mode is already in the payload.

---

## Track 4 — Three open product questions (brief confirmation needed, then trivial fixes)

### 4.1 · Compound catch-up recovery discount

**Question for product:** Is it intentional that `first_correct_after_wrong` on a catch-up answer applies both `CATCHUP_SURFACE_WEIGHT (0.25) × RECOVERY_STATE_WEIGHT (0.25) = 6.25%` of live base? The PRD specifies each multiplier independently but is silent on their combination.

**If intentional:** Add a comment to `src/server/mastery/constants.ts` documenting the compound: "Catch-up recovery = CATCHUP_SURFACE_WEIGHT × RECOVERY_STATE_WEIGHT = 6.25% of live base. Intentional: catch-up already reduces reward; recovery on top of that is minimal credit."

**If not intentional (should be 25% = recovery only, ignoring catch-up penalty):** In `src/app/api/daily/catchup/answer/route.ts:122–128`, change the recovery line:
```typescript
// before
: masteryAnswerState === 'first_correct_after_wrong'
  ? Math.round(baseCatchupPoints * RECOVERY_STATE_WEIGHT)

// after — recovery on catch-up = same as regular recovery = 25% of base (not 6.25%)
: masteryAnswerState === 'first_correct_after_wrong'
  ? Math.round(catchupItem.basePoints * RECOVERY_STATE_WEIGHT)
```

### 4.2 · Cultural anchor required vs optional

**Question for product:** PRD §7.3 presents birth year + geography as a required Step 2. The route accepts it as optional (`src/app/api/onboarding/propose-interests/route.ts:86–105`). Is skipping Step 2 a valid user path?

**If required:** In the route, change `parseCulturalAnchor` result handling to:
```typescript
if (culturalAnchorResult === null) {
  return NextResponse.json(
    { error: 'cultural_anchor_required', message: 'Birth year and where you grew up are required.' },
    { status: 400 },
  );
}
```

**If optional (intentional):** No code change. Add a comment in the route noting the intentional departure from the PRD step ordering.

### 4.3 · Body font: Montserrat or Inter?

**Question for product:** The PRD specifies Inter as the body font. The code ships Montserrat. Is this a deliberate product choice or a drift from spec?

**If Inter:** In `src/app/layout.tsx`, change the import from `Montserrat` to `Inter`, update the variable name and className references. One-line change.

**If Montserrat:** Update PRD §typography to say Montserrat. No code change needed.

### 4.4 · Re-login policy for pre-fix accounts

**Question for product:** The current `verify-otp` re-login path grants any existing user a full session with `invitationAccepted: true`, including accounts created before the invitation gate was added. Is this intentional (grandfather existing accounts) or should pre-fix accounts be rejected until they go through an admin-mediated invitation flow?

**If grandfather (current intent):** Add a comment to `src/app/api/auth/verify-otp/route.ts:113–127` confirming this is deliberate policy: "Existing accounts are trusted. The invitation gate applies only to new account creation." No code change.

**If strict (reject non-invited accounts):** The re-login branch needs to check `friendInvitations` for an accepted row before minting a session. The `refreshSessionInvitationClaim` endpoint and the middleware check in 1.1 would then form a hard gate on every request for these accounts.

---

## Test and lint gate

After completing any track:

```bash
npm run typecheck     # or npx tsc --noEmit
npm test              # or npx vitest run
```

All pre-existing tests must continue to pass. New tests are required for: middleware (1.1), Beat 2 null-domain exclusion (1.5), author credit from Feed/Daily surfaces (2.3).

---

## What this prompt does NOT address

- The hardcoded `000000` OTP shortcut — known and intentional, excluded by standing instruction.
- Prisma schema drift content (deleted in 1.11, not reconciled — the Drizzle schema is authoritative).
- Phase 2 ceremony two-act architecture (Decision 3A Option B) — scoped separately if chosen.
- Improving fallback interest specificity (F5.3, P3) — low urgency, LLM-outage-only scenario.
