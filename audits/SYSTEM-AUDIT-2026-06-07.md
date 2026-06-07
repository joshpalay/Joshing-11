# Joshing — Full System Audit (read-only)

**Date:** 2026-06-07
**Branch audited:** `claude/joshing-system-audit-FkU6k`
**Scope:** Code is the source of truth. PRDs/specs deliberately not consulted. Every finding cites a file actually opened. No application code, schema, config, or content was modified — this report is the only artifact created.

> Status: **Map confirmed. Phases 1–5 complete.**
>
> **Build health:** `npx tsc -p tsconfig.typecheck.json` → clean (exit 0). `npm run lint` → clean (exit 0). The codebase compiles and lints; launch blockers below are behavioral/security, not build.
>
> **Method note:** Severities from the breadth sweeps were re-graded after spot-verifying the strongest claims against source. Two sub-agent "P0"s (an onboarding `Promise.all` "silent crash" and a blanket "no LLM fallback") were **discarded** — `assessInterestAnswerability` (`src/server/llm/interests.ts:443`) and `convergeDomain` (`src/server/knowledge/converge-domain.ts:117,150`) both catch internally and fail open, so the page does not crash; graceful degradation is pervasive. Findings below are ones I opened the file for.

---

## Phase 1 — Architecture Map

### Stack

- **Framework:** Next.js `16.1.6` (App Router), React latest, TypeScript.
- **ORM:** Drizzle (`drizzle-orm ^0.45.2`) over node-postgres `pg`. **Not Prisma** (the audit prompt says "Prisma schema" — there is no Prisma in this repo; schema is Drizzle at `src/server/db/schema.ts`).
- **DB:** Postgres (Supabase + PgBouncer per `CLAUDE.md`). Pool capped `max: 5` (`src/server/db/index.ts:23`), singleton across hot-reloads, with a saturation logger.
- **LLM:** `@anthropic-ai/sdk`. Model split confirmed in code: Sonnet `claude-sonnet-4-6` for generation (`src/lib/llm.ts:70`), Haiku `claude-haiku-4-5-20251001` for grading (`src/lib/llm.ts:72`) and categorization (`src/lib/questions/categorization.ts:4`). Breadcrumbs use Haiku (`src/server/daily/generate-breadcrumb.ts:3`).
- **SMS:** Twilio via raw `fetch` (`src/server/sms.ts`); **fails silently / logs only when env vars are missing**.
- **Email:** Resend (`resend ^4.8.0`); templates under `src/server/email/templates`.
- **Routing/middleware:** `src/proxy.ts` (the Next 16 proxy), **no `src/middleware.ts`** (confirmed; this is the documented invariant). The function is named `middleware` but exported as `proxy`.
- **Auth:** Phone OTP → JWT session cookie `joshing_session` (`jose`), edge-gated in `proxy.ts` with `inv`/`onb` claims; route handlers still call their own `getSession()`.
- **Build/test:** `next build`; Vitest (122 test files); ESLint with `--max-warnings 44`; strict typecheck via `tsconfig.typecheck.json`.

### Top-level layout

```
src/
  app/            Next App Router: ~32 pages + ~115 API route handlers
  components/     ~100 client components across 17 feature dirs
  server/         all business logic (no "use server" actions — logic is in API routes)
  lib/            pure/shared logic (llm.ts, knowledge, daily, games, reactions, ...)
  instrumentation.ts   54KB boot file: auto-migrate + idempotent DB guards
  proxy.ts        edge auth/onboarding gate
  env-check.ts    boot env validation
drizzle/          0000 … 0071 (72 migrations; CLAUDE.md head ref "0061" is stale)
scripts/          smoke tests + playtest harness
audits/           prior audit reports (this file joins them)
```

### Pages (App Router) — ~32

Onboarding/auth: `login`, `onboarding`, `verify-email`, invite landings `invite/[token]` and `u/[handle]/[token]`.
Daily play: `daily`, `daily/setup`, `daily/catchup`, `daily/summary`.
Core surfaces: `/` (home), `feed`, `friends`, `friends/find`, `questions`, `archive`, `activities`, `replay`, `knowledge` + `knowledge/[domain]`.
Profiles: `users/me`, `users/[id]`, `users/[id]/knowledge`, `u/[handle]/[token]`.
Games/ceremony: `new-game`, `games/[id]`, `games/[id]/summary`, `ceremony/[ceremonyId]`, `share/ceremony/[token]`.
Dev-only: `dev/flags`, `dev/noon-reset`, `dev/points-diagnostic`, `dev/reset-session`, `dev/test-game`, `dev/loading-preview`, `feed/debug/friend-coverage`.

### API routes — ~115, by domain

- **auth/account:** `auth/request-otp`, `auth/verify-otp`, `auth/me`, `auth/logout`, `auth/refresh-session`, `auth/refresh-onboarding-claim`; `account/*` (profile, handle, email verify send/confirm, discoverability, visibility, reminders, invite-token, phone-hash-salt, adaptive-level, logout).
- **onboarding:** `onboarding/propose-interests`, `onboarding/canonicalize`, `onboarding/save-interests`.
- **daily:** `daily/status`, `daily/queue`, `daily/answer`, `daily/skip`, `daily/recheck`, `daily/refine`, `daily/reset`, `daily/summary`, `daily/feedback`, `daily/preferences` (+`add-domain`), `daily/catchup` (+`answer`/`dismiss`/`undismiss`).
- **questions:** `questions` (list/create), `questions/[id]` (+`answer`/`rating`), `questions/answered`, `questions/send`, `questions/suggest`, `questions/suggest-answer`, `questions/critique`.
- **feed:** `feed`, `feed/[feedItemId]/{answer,recheck,state,thumbsup,thumbsdown}`, `feed/dismiss-domain`, `feed/dismissed-domains`, `feed/friend-coverage`, `feed/backfill-missing-feed-items`, `feed/debug`.
- **friends/follow:** `friends`, `friends/search`, `friends/has-new-discovery`, `friends/invite-reflections`, `friend-requests` (+`[id]/{accept,cancel,ignore,remove}`), `friend-invitations`, `contact-hashes` (+`matches`).
- **knowledge/profile:** `knowledge`, `knowledge/[domain]`, `knowledge/converge`, `knowledge/tidy`, `users/me`, `users/[id]`, `users/recent`, `users/domain-exclusions` (+`[domain]`), `declared-interests`, `interests/check`, `interests/expand`, `handle/check`.
- **games/ceremony:** `joshing-games` (+`[id]`/`[id]/answer`), `ceremony/[id]` (+`share-token`/`viewed`), `ceremony/status`, `share/ceremony/[token]`, `replay/grade`, `replay/missed`.
- **engagement:** `activities` (+`read`/`opened`), `reactions` (+`[id]/reply`), `bank` (+`check`), `archive`, `breadcrumb`, `lately/milestone/answer`, `me/has-authored-question`.
- **cron:** `cron/{daily-assignments, weekly-ceremony, vet-questions, expire-friend-requests, pool-refill}` (Bearer-secret gated).
- **admin/dev/telemetry:** `admin/backfill-domains`, `dev/points-diagnostic`, `dev/pool-report`, `telemetry`.

### Data model — 37 tables, 28 enums (`src/server/db/schema.ts`, 1103 lines)

- **Identity/auth:** `User`, `UserSession`, `OtpCode`, `emailVerificationTokens`, `smsLogs`.
- **Questions/pool:** `questions`, `questionAudienceTags`, `userQuestionBank`, `generatedQuestions`, `questionFeedback`, `questionRatings`, `questionReactions`, `gradeDisputes`.
- **Mastery/play:** `playerMastery`, `masteryEvents`, `critiqueUsageDaily`.
- **Daily engine:** `dailyQueues`, `dailyPreferences`, `skippedDailyQuestions`, `userDomainDifficulties`, `userDomainExclusions`, `dailyRefineDecisions`.
- **Profile/knowledge:** `profileSectionVisibility`, `profileDomainVisibility`, `declaredInterests`.
- **Social graph:** `friendships`, `follows`, `contactHashes`, `friendInvitations`.
- **Games/feed/ceremony/activity:** `joshingGames`, `joshingGameRecipients`, `joshingGameQuestions`, `joshingGameResponses`, `feedItems`, `biweeklyCeremonies`, `activityItems`, `feedDismissedDomains`.
- **Enums of note:** `Category` (10 fixed categories), `QuestionVisibility` (incl. terminal `blocked` safety state), `TrustTier` (unverified→machine_verified→human_validated→author_confirmed), `MasteryTier`, `SmsMessageType` (many vestigial/tombstoned values documented inline), `ProfileSection` (with zombie enum values intentionally omitted from app code).

### Server logic organization (`src/server/`)

Domain dirs each with `__tests__`: `auth`, `daily`, `feed`, `friends`, `knowledge`, `mastery`, `pool`, `play`, `questions`, `profile`, `ceremony`, `refine`, `replay`, `activity`, `answers`, `llm`, `lib`, `email`, plus `db/queries/` (34 query helpers). LLM-facing logic in `src/server/llm/` (critique, embeddings, interests, recheck, suggest-question, vet-question, vet-verdict) and `src/lib/llm.ts` (1322 lines, the grading/categorization/suggestion core).

### Data flow

`DB (Drizzle schema) → src/server/db/queries/* (query helpers) → src/server/<domain>/* (business logic) → src/app/api/**/route.ts (Zod-validated handlers) → client components (src/components/**) / pages`. Daily play and feed are the two heaviest pipelines (queue-orchestrator + retrieval-grounded generation; get-feed-page + create-feed-items-for-answer). `instrumentation.ts` runs migrations + idempotent guards at boot.

### Early observations to verify in later phases (NOT yet findings)

1. **OTP universal bypass — `code === '000000'` returns success unconditionally** (`src/server/auth/otp-store.ts:37`), with **no `NODE_ENV`/env guard**. Works in production. Candidate **P0**.
2. **Cron auth fails open:** `if (!secret) return true;` (`src/app/api/cron/daily-assignments/route.ts:43`) — if `CRON_SECRET`/`VERCEL_CRON_SECRET` unset, all cron endpoints are world-callable. Candidate P0/P1 (verify across all 5 cron routes).
3. **`cron/daily-assignments` is not in `vercel.json`** (only weekly-ceremony, vet-questions, expire-friend-requests, pool-refill are). Need to confirm whether daily assignment is on-demand instead.
4. **`CLAUDE.md` migration head (0061) is stale** vs actual `0071` — doc drift (out of audit scope per "code vs code only," noted for orientation).
5. No `use server` actions anywhere — all mutations go through API routes (consistent, good for the map).

---

## Findings

Grouped by lens (Dev/Backend · UX · Visual). Severity: **P0** blocks launch · **P1** hurts core experience · **P2** quality · **P3** nice-to-have.

### Lens 1 — Development / Architecture / Backend

#### DEV-1 (P0) — Universal OTP bypass `000000` works in production
`src/server/auth/otp-store.ts:37` — `verifyOtp` returns success for `code === '000000'` for **any** phone number, with **no `NODE_ENV` / env guard**. Combined with the invite gate this still lets anyone authenticate as any *existing* user (the bypass returns the normalized phone, then `verify-otp` finds the user and mints a session — no invite needed on the re-login path, `verify-otp/route.ts:176-214`). This is a full account-takeover primitive in production. Must be env-gated (dev/test only) or removed before launch.

#### DEV-2 (P0) — No rate limiting on OTP request or verify
`src/app/api/auth/request-otp/route.ts` and `verify-otp/route.ts` apply **zero** throttling. `getRecentOtpRequestCount` exists (`src/server/auth/otp-store.ts:67`) but is **never called by any route**. Consequences: (a) unbounded SMS send → cost/abuse/Twilio SLA risk; (b) unlimited verify attempts → a 6-digit code is brute-forceable. (The `000000` bypass makes brute-force moot today, but both must be fixed.)

#### DEV-3 (P1) — `daily-assignments` cron is documented as scheduled but is absent from `vercel.json`
`src/app/api/cron/daily-assignments/route.ts:11` comment says "Scheduled at 17:05 UTC (vercel.json)"; `vercel.json` schedules only `weekly-ceremony`, `vet-questions`, `expire-friend-requests`, `pool-refill` — **not** `daily-assignments`. This route is what pre-builds each user's daily queue just after the reset *and* sends the `daily_questions` SMS. With it unscheduled: queues are never pre-warmed, so **every** user hits the synchronous `/api/daily/queue` path (up to `GENERATION_TIMEOUT_MS` = 35s, user-blocking — the exact failure mode the comment says it exists to prevent), and **daily reminder SMS never fire**. Code-vs-code contradiction with real user impact.

#### DEV-4 (P1) — Cron / admin auth fails open when the secret is unset
All five cron routes and `admin/backfill-domains` use `if (!secret) return true` (e.g. `cron/daily-assignments/route.ts:43`, `cron/weekly-ceremony/route.ts:19`, `cron/vet-questions/route.ts:20`, `cron/expire-friend-requests/route.ts:10`, `cron/pool-refill/route.ts:16`, `admin/backfill-domains/route.ts:9-17`). If `CRON_SECRET`/`VERCEL_CRON_SECRET` is ever unset in an environment, every one of these (including the LLM-spending `vet-questions`/`pool-refill` and the user-mutating `backfill-domains`) becomes world-callable. Fail *closed* in production.

#### DEV-5 (P1) — User-facing LLM endpoints have no per-user rate limit (token-burn vector)
`questions/suggest`, `interests/expand`, and `onboarding/propose-interests` each call Sonnet/Haiku with no per-user cap. (Contrast `questions/critique`, which is correctly capped at 5/day via `critiqueUsageDaily` — `questions/critique/route.ts:11`.) An authenticated user can drive unbounded LLM spend. P1 on cost, not correctness.

#### DEV-6 (P2) — Dev/diagnostic API routes are session-gated only, no prod/env guard
`api/dev/points-diagnostic/route.ts` and `api/dev/pool-report/route.ts` (and the `/dev/*` pages) are reachable by any authenticated user in production — they leak cross-user mastery/pool internals. (`feed/backfill-missing-feed-items` is the correct model: it gates on `process.env.NODE_ENV !== 'production'`.) Add the same env guard.

#### DEV-7 (P2) — Verification substrate is built but dormant; defaults hide its absence
Two PRD-D-5 quality safeguards ship OFF by default: (a) **trust-tier gating** is flag-gated off (`src/server/daily/verification-gating.ts:21`, `VERIFICATION_TIER_GATING_ENABLED` defaults false — shadow-log only), and (b) **semantic dedup** is key-gated off (`src/server/llm/embeddings.ts:24`, no `VOYAGE_API_KEY` ⇒ `isEmbeddingEnabled()` false ⇒ `embedAndResolveDuplicate` no-ops). Both are *intentional* "no behavior change" defaults, but the net effect today is: questions serve regardless of trust tier, and the only dedup is the deterministic fact-key/normalized-text/Haiku pass. Launch readiness depends on a deliberate flip + key provisioning, not just a deploy. Not a bug — a "this isn't actually on yet" flag.

#### DEV-8 (P2) — Duplicated categorization surface
`src/lib/question-categorization.ts` (normalize broad/canonical) and `src/lib/questions/categorization.ts` (`reconcileProposedDomain`) are distinct modules with overlapping concern, imported from different call sites. Both live; neither dead. Worth consolidating under `src/lib/questions/` to stop the "which categorizer?" ambiguity. Low risk.

#### DEV-9 (P3) — Two API routes bypass the "Zod on every input" rule with hand-rolled validators
`api/questions/route.ts` (`readCreateQuestionPayload`) and `api/friend-invitations/route.ts` (`validateCreateFriendInvitationBody`) validate without Zod. The validators are thorough and tested, so this is a convention drift, not a hole. Note for consistency.

#### DEV-10 (P3) — Vestigial enum values carried as tombstones
`SmsMessageType` (`schema.ts:123`) and `ProfileSection` (`schema.ts:183`) retain documented zombie values Postgres can't drop; `Category`/profile zombies similarly. Correctly handled (omitted from app code), noted only so the next schema editor doesn't "clean them up" and break the enum.

**Backend strengths (explicitly noted):** the grading "fail-toward-player" contract is honored by **all 8** answer-submitting consumers — each branches on `status === 'unscored'` and returns 503 without persisting a verdict (`daily/answer/route.ts:243`, `daily/catchup/answer/route.ts:147,431`, `feed/[feedItemId]/answer/route.ts:107`, `questions/[id]/answer/route.ts:85`, `replay/grade/route.ts:77`, `lately/milestone/answer/route.ts:79`, and `joshing-game.ts:492` via `JoshingGameGraderUnavailableError`). Grading retries once before conceding (`llm.ts:628`). The question-generation pipeline is real and layered (retrieval-grounded web search, source corroboration, ask-to-answer machine verification, insert-time dedup), all best-effort/non-blocking. Prompt-injection is defended with `wrapUserInput` + `INSTRUCTION_USER_INPUT_GUIDANCE` on every LLM call.

### Lens 2 — UX flows & state

> Re-graded from the flow sweep after spot-checks. The send-question drawer DOES show a post-send "Sent ✓" toast (`SendQuestionDrawer.tsx:105,115-119`) and the friend-list error is recoverable by reopening (refetch on open, `:34-58`) — both originally over-rated; corrected below.

#### UX-1 (P1) — Daily play has no recovery affordance when the grader is unavailable
When `/api/daily/answer` returns the `grader_unavailable` 503, the answer input stays enabled and the warm message ("answer-checker is taking a breather") is shown, but there is no explicit retry/"try again in a moment" CTA — the user can only re-submit into the same error (`src/app/daily/page.tsx:84-87`). The backend does the right thing (holds the answer); the front end needs a clear retry path so the held answer isn't a silent dead-feeling stall.

#### UX-2 (P1) — Daily summary fetch failure is a dead end
`src/app/daily/summary/page.tsx:151-178` sets a plain "Could not load your daily summary." with no retry button and no cached fallback. After finishing the five, a transient 500/timeout strands the user with no way to see their session — the emotional payoff screen is the one most worth making resilient.

#### UX-3 (P2) — Custom-topic entry lacks contextual progress / failure recovery
Onboarding custom-topic add (`src/components/interests/AddTopicField.tsx:183-273`) shows a generic "Working…" during converge/expand with no indication of what's happening; and if `interests/expand` fails mid-retry, the field can be left with stale `candidates` and `busy=false`, producing a confusing half-state. Connection starts with declaring what you care about — this path should never feel stuck. (Functional fail-open exists server-side; this is purely the client affordance.)

#### UX-4 (P2) — Daily generation auto-retry can't distinguish "slow" from "broken"
`src/app/daily/page.tsx:190-220` retries queue generation 4× with the same warm copy regardless of the underlying error, so a genuine empty/unanswerable state reads identically to transient slowness. Add a terminal diagnostic state after exhausting retries.

#### UX-5 (P2) — Feed empty-state copy is ambiguous across causes
`src/components/FeedList.tsx:824-846` picks among "no friends" / "domains muted" / "quiet today", but a user with items only in the "Sent to me" tab can see "Quiet today" on the broadcast tab — misleading. Disambiguate per-tab.

#### UX-6 (P2) — New-user empty knowledge map offers no next step
`src/app/users/[id]/page.tsx:405-437` renders "0 points across 0 territories" with a link into an equally-empty knowledge base and no "play daily / write a question to start" prompt. First-run profiles are the most common and the least guided.

#### UX-7 (P2) — Thumbs-down "Undo" is lost on navigation though the write is immediate
`src/components/FeedList.tsx:694-706` persists the thumbs-down to the server immediately but the Undo affordance is transient (~4s, page-local). Leaving the feed forfeits the undo with no other way to reverse.

**UX strengths:** the daily/summary "interpretive line" and session-close copy are thoughtful; grading-down handling is correct server-side everywhere; the invite/onboarding gate is carefully reasoned (the `verify-otp` comments document the grandfathering and race handling in detail).

### Lens 3 — Visual system coherence (internal only)

The token system itself is well-defined — `src/app/globals.css` holds the Ink-on-Cream palette, radius tiers, and shadow variables; `_docs/DESIGN-SYSTEM.md` documents the scale; Montserrat → `--font-sans`. The problem is **adoption drift**: subsystems are internally consistent (feed cards via `FeedCardShell`, activity stream via `lib/.../tokens.ts`) but disagree with each other and with the token set. Nothing in lint/TS prevents bypassing the tokens. Counts below were re-verified by grep.

#### VIS-1 (P2) — Pervasive hardcoded hex colors outside the token set
**193** `#rrggbb` literals across `src/components` + `src/app` `.tsx`. A meaningful fraction is legitimate SVG illustration (`ShareCard.tsx`, `OverlapMap.tsx`, `home/FeedEmptyArt.tsx`, `knowledge/PortraitCircles.tsx`) — call those out-of-scope. But UI chrome is also hardcoding: `LoadingScreen.tsx` (`#E8DCC0`, `#F5EBD3`, `#1a1208`), `replay/ReplaySummary.tsx` (`#111111` ×3), `home/CeremonyPin.tsx` (`#D9A82E`), and `app/knowledge/page.tsx` (`#8b1a0e`, `#0e0e0e`, `#fff7e8`, …). These should map to existing `--ink`/`--cream`/`--destructive`/warm tokens. The cream/ink hardcodes are especially wrong because exact-named tokens already exist.

#### VIS-2 (P2) — 148 arbitrary `text-[Npx]` / `text-[N rem]` sizes off the type scale
`text-[13px]`, `text-[14px]`, `text-[22px]`, and fractional-rem oddities (`text-[0.62rem]`, `text-[0.68rem]`, `text-[0.88rem]` in `replay/ReplaySummary.tsx`, `QuestionForm.tsx`) bypass the Tailwind scale wholesale. Heaviest in the feed surface (`feed/AnsweredByYouCard.tsx`, `feed/SparkleEnvelope.tsx`, `FeedList.tsx`, `TodaysFiveCard.tsx`). No rationale for the fractional rems. Collapse to the nearest scale step.

#### VIS-3 (P2) — Toast UI re-implemented identically in 6 files instead of a shared component
The same `fixed bottom-24 left-1/2 z-… -translate-x-1/2 rounded-full bg-foreground …` toast markup is copied across `AddToBankAction.tsx`, `SendQuestionDrawer.tsx`, `friends/AddFriendButton.tsx`, `friends/ContactMatchBlock.tsx`, `friends/InviteSomeoneNew.tsx`, `profile/settings/PrivacyForm.tsx`. There is no `Toast` in `src/components/ui` (which holds only one component). Extract once.

#### VIS-4 (P2) — Inline `style={{}}` typography overrides bypass utility classes
`activity/ActivityStreamItem.tsx` is the worst offender (~40 inline style props hardcoding `fontFamily: 'Georgia, serif'`, `fontSize`, `letterSpacing`, `lineHeight`), with the same pattern in `activity/DirectQuestionAnswer.tsx` and `activity/InlineAnswerFlow.tsx`. This is a Tailwind-first codebase elsewhere; these surfaces opt out entirely, making them the hardest to keep on-system.

#### VIS-5 (P2) — Off-scale radius and ad-hoc shadows
`rounded-[4px]` appears 8× (feed cards + `TodaysFiveCard`) though the scale starts at `--radius-sm` (6px); 5 distinct `shadow-[…]` custom values exist, with `shadow-[0_4px_12px_rgba(40,32,30,0.04)]` reused across feed components — a tier that wants to be a token (`--feed-card-shadow`) rather than a copy-pasted arbitrary value.

#### VIS-6 (P3) — `[var(--brand-*)]` arbitrary-value classes instead of semantic tokens
`FeedList.tsx`, `TodaysFiveCard.tsx`, `feed/FeedCardShell.tsx`, `feed/DismissedFeedBar.tsx` use `border-[var(--brand-border)]` / `bg-[var(--brand-card)]` instead of the semantic `border`/`bg-card` utilities the rest of the app uses. Cosmetic, but it's two parallel ways to spell the same token.

#### VIS-7 (P3) — Ad-hoc letter-spacing / font-weight roles
~15 ad-hoc `tracking-[…]` / inline `letterSpacing` values and inconsistent `font-medium` vs `font-semibold` for the same visual role. The design doc lists the weights "in use" but doesn't assign roles, so usage drifts. Doc + consolidation, not a bug.

**Visual verdict:** good foundation, inconsistent execution. Register bleed (warm editorial Georgia/serif on the navy brand) is largely *intentional and documented* — not flagged as a defect. The real cost is the absence of any guardrail: every drift above is something lint could catch.

---

## Honest stock-take

**What's solid:** The core game loop is real and carefully engineered. The grading path's "fail-toward-player" contract is honored at every one of the 8 answer-submitting routes — wrong answers are never manufactured by an outage. The question-generation pipeline (retrieval-grounded web search → corroboration → machine verification → dedup) is genuinely built, not stubbed, and degrades gracefully when keys are absent. Prompt injection is defended uniformly. The build is clean (typecheck + lint both pass) and test coverage is broad (122 test files). The invite/onboarding auth model is thought through to the race conditions.

**What's fragile:** Launch-readiness operational hygiene. A universal OTP bypass (`000000`) ships unguarded; OTP request/verify have no rate limiting; cron/admin auth fails *open*; user-facing LLM endpoints have no spend cap. None of these are visible in normal play, which is exactly why they're dangerous. The `daily-assignments` cron being unscheduled means the whole pre-warm + reminder system the code describes isn't actually running — a contradiction only visible by cross-reading the route and `vercel.json`.

**What's missing / dormant:** The PRD-D-5 quality substrate is built but switched off — trust-tier gating is shadow-only and semantic dedup needs a Voyage key, so questions currently serve regardless of verification tier. The front-end recovery layer is the weakest part of the UX: the backend correctly *holds* answers and *fails open*, but several surfaces (daily grader-down, daily summary load, custom-topic add) don't give the user a clear way forward when that happens.

**Net:** This is a mature, coherent codebase with a strong spine and a thin operational/edge-state shell. The gap between "works when everything is up" and "safe to put in front of strangers" is concentrated in a handful of auth/ops fixes, not in the product itself.

## Prioritized prompt backlog (stubs)

Ordered so each leaves the tree working after merge. IDs follow the repo `B-…` convention.

1. **B-Auth-OTP-Hardening** — Env-gate the `000000` bypass to non-production and add rate limiting to request-otp + verify-otp (wire the existing `getRecentOtpRequestCount`). *Resolves DEV-1, DEV-2.*
2. **B-Cron-Auth-Failclosed** — Make cron + admin auth fail *closed* in production (require the secret); keep dev fail-open behind `NODE_ENV`. *Resolves DEV-4.*
3. **B-Cron-DailyAssignments-Schedule** — Add `daily-assignments` to `vercel.json` (reconcile to the 17:05 UTC schedule the route documents) and verify pre-warm + reminder SMS fire. *Resolves DEV-3.*
4. **B-LLM-Endpoint-RateLimit** — Add per-user daily caps (mirroring the critique pattern) to `questions/suggest`, `interests/expand`, `onboarding/propose-interests`. *Resolves DEV-5.*
5. **B-Dev-Routes-EnvGate** — Gate `dev/*` API routes and pages behind `NODE_ENV !== 'production'` like `feed/backfill-missing-feed-items`. *Resolves DEV-6.*
6. **B-Daily-Recovery-States** — Add explicit retry affordances for grader-unavailable and summary-load failures; terminal diagnostic state after generation retries exhaust. *Resolves UX-1, UX-2, UX-4.*
7. **B-Onboarding-CustomTopic-States** — Contextual progress + clean error recovery for custom-topic converge/expand; clear the stale-candidates half-state. *Resolves UX-3.*
8. **B-Feed-Profile-EmptyStates** — Per-tab feed empty copy; new-user knowledge-map next-step prompt; durable thumbs-down undo. *Resolves UX-5, UX-6, UX-7.*
9. **B-Verification-GoLive** — Operational runbook + flip plan for `VERIFICATION_TIER_GATING_ENABLED` and `VOYAGE_API_KEY` (eligible-pool health check before enforcing). *Resolves DEV-7.*
10. **B-Visual-Token-Enforcement** — Lint rules against raw hex / `text-[Npx]` / ad-hoc shadows in UI (excluding SVG art); migrate `LoadingScreen`/`ReplaySummary`/`knowledge` hardcodes to tokens. *Resolves VIS-1, VIS-2, VIS-5.*
11. **B-Shared-UI-Primitives** — Extract a shared `Toast`; standardize avatar usage on `AvatarChip`; replace `[var(--brand-*)]` with semantic utilities. *Resolves VIS-3, VIS-6.*
12. **B-Editorial-Surfaces-OnSystem** — Move `ActivityStreamItem` / activity inline-style typography onto utility classes / a scoped layer. *Resolves VIS-4, VIS-7.*
13. **B-Categorization-Consolidate** — Merge the two categorization modules under `src/lib/questions/`; normalize the two non-Zod route validators. *Resolves DEV-8, DEV-9.*

---

*End of audit. Findings cite files opened during the audit; severities re-graded after source verification of the strongest sub-agent claims.*


