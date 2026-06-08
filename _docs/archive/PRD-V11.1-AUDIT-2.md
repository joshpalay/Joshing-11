# PRD v11.1 — Conformance Audit 2

**Repository:** `/workspace/Joshing-11`  
**Audit date:** 2026-05-07  
**Methodology:** Read actual function bodies and route logic, not just filenames. Build commands were run locally. Status legend: ✅ COMPLETE, 🟡 PARTIAL, 🔴 MISSING, ⚠️ DIVERGENT, ❓ UNCLEAR. For items that were non-✅ in `PRD-V11.1-AUDIT.md`, the prior status is shown.

---

## Section 1 — Build Health

| Check | Current result | Prior | Notes |
|---|---:|---:|---|
| `npx tsc --noEmit` | ✅ **0 TypeScript errors** | 2 errors | The prior `bookComposerFilmmaker` and `declared_promoted` type errors are gone. Command emitted only npm env warning: `npm warn Unknown env config "http-proxy"...`. |
| First 10 TS errors | ✅ None | 2 | No verbatim errors to report. |
| `npm run build` | ⚠️ **Failure, environment/network** | Failure | Build now reaches Next/Turbopack but fails fetching Google Font `Montserrat` from `https://fonts.googleapis.com/...`. No code/type error surfaced. Error: `next/font: error: Failed to fetch Montserrat from Google Fonts.` |
| `npm run dev` | 🟡 Starts, but not clean | ❓ | Next dev started and reached `✓ Ready in 3.5s`, but instrumentation migration logged DB `ECONNREFUSED` on `CREATE SCHEMA IF NOT EXISTS "drizzle"`. |
| `@prisma/client` imports under `src/` | ✅ None | ✅ | `rg -n "@prisma/client" src` returned no matches. `package.json` still lists `@prisma/client`, but no source import remains. |
| `src/lib/prisma.ts` | ✅ Absent | ✅ | Confirmed by file check/absence. |
| Total file count under `src/` | 242 | 237 | `find src -type f | wc -l`. |

---

## Section 2 — Prompt 9.0: Broadcast Share Rollback

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 2.1 QuestionForm: "Share with friends" toggle absent | ✅ | ✅ | Destinations panel only has locked `Save to bank` and toggleable `Send to specific friends`; no broadcast toggle string. |
| 2.1 "Save to bank" locked-on default | ✅ | ✅ | Disabled checked checkbox remains. |
| 2.1 "Send to specific friends" toggleable | ✅ | ✅ | `specificMode` checkbox plus friend picker remains. |
| 2.1 Helper text references broadcast share | ✅ | ✅ | No broadcast-share helper text found in `QuestionForm.tsx`. |
| 2.1 Toast `Saved and shared with your friends.` absent | ✅ | ✅ | No matching string found. Knowledge page question submit currently toasts only `Question saved.` |
| 2.2 `shareToFeed` branch removed from POST `/api/questions` | ✅ | ✅ | Request parser does not read `shareToFeed`; POST only handles `sendToFriendIds`. |
| 2.2 `authored_shared` creation loop removed | ✅ | ✅ | POST creates `direct_sent` feed items only for validated direct recipients. |
| 2.2 Specific-friend send branch intact | ✅ | ✅ | Validates recipients against `getFriends`, inserts pinned `direct_sent`, rolls off old items, sends SMS. |
| 2.2 `shareToFeed` removed from request schema | ✅ | ✅ | No schema/body read path. |
| 2.3 FeedList `authored_shared` visual variant removed | ✅ | ✅ | No ✎ or "wrote this" branch in `FeedList`. |
| 2.4 Feed query handles old `authored_shared` rows | ✅ | ✅ | `/api/feed/route.ts` filters `sourceType !== 'authored_shared'`. |
| 2.5 Thumbs-down copy: removed/restored | ✅ | ✅ | Strings are present. Note the removed copy uses curly apostrophe in `Won’t`, not straight ASCII. |
| 2.5 4-second display | ✅ | ✅ | `setTimeout(..., 4000)` for removal and restored fade. |
| 2.6 Cleanup script exists | ✅ | ✅ | `scripts/cleanup-authored-shared-feed-items.ts`. |
| 2.6 `--dry-run` and `--apply`; dry-run default | ✅ | ✅ | `const DRY_RUN = !process.argv.includes('--apply')`; usage lists both modes. |

---

## Section 3 — Prompt 9.1: Categorizer Fix

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 3.1 Explicit `GRANULARITY RULES` in active LLM categorization prompt | ✅ | 🟡 | Daily generator appears to have such rules, but the older `categorizeQuestion` prompt in `src/lib/llm.ts` does **not** literally contain `GRANULARITY RULES` and still says the subcategory should be "as specific as the question demands." |
| 3.1 GOOD vs BAD label examples | ✅ | ✅ | `src/lib/llm.ts` lists good/bad subcategory examples; daily generation also contains domain-specific guidance. |
| 3.1 Forbids facet-level qualifiers | ✅ | 🟡 | Backfill prompt explicitly forbids facets; reconciliation examples mention facets; the active `categorizeQuestion` prompt forbids generic categories but does not clearly forbid "themes / characters / structure" as labels. |
| 3.2 `reconcileProposedDomain` exists | ✅ | ✅ | `src/lib/questions/categorization.ts`. |
| 3.2 Fetches existing user domains before LLM call | ✅ | ✅ | Calls `getKnowledgeBase(userId)` before Anthropic request. |
| 3.2 Uses Claude Haiku / fast model | ✅ | ✅ | `RECONCILE_MODEL = 'claude-haiku-4-5'`. |
| 3.2 3-second timeout and graceful fallback | ✅ | ✅ | `RECONCILE_TIMEOUT_MS = 3000` and `try/catch` fallback. |
| 3.2 Returns `{ canonicalDomain, reconciled }` | ✅ | ✅ | Shape matches. |
| 3.3 Reconciliation called from question creation | 🔴 | 🔴 | Still not called in `/api/questions` or `createQuestion`; authored questions use a coarse form domain/category. |
| 3.3 Reconciliation called from Daily Five generation | ✅ | ✅ | Prior audit found it in generator; current `rg` still shows reconciliation path only outside question creation. |
| 3.3 `[reconcile]` log line | ✅ | ✅ | Success and fallback/error paths log `[reconcile]`. |
| 3.4 Daily Five not allowing facet-narrowing | 🟡 | 🟡 | Prompt-level constraint exists, but no runtime invariant enforces generated question canonical domain equals selected domain. |

---

## Section 4 — Prompt 9.2: Domain Backfill

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 4.1 `runAggressiveDomainBackfillForUser` exists | ✅ | ✅ | Present in `src/server/mastery/ceremony.ts`. |
| 4.1 Aggressive facet-into-parent prompt | ✅ | ✅ | Prompt explicitly says facets/themes/characters/structure/symbolism/etc. must merge into parent. |
| 4.1 Reuses transactional merge machinery | ✅ | ✅ | Uses `applyMergesForUser`, which wraps merge application in `db.transaction`. |
| 4.2 Admin endpoint exists | ✅ | ✅ | `src/app/api/admin/backfill-domains/route.ts` POST. |
| 4.2 Requires `CRON_SECRET` header | ✅/⚠️ | ⚠️ | Still broader than spec: if no secret env is set, `isAuthorized` returns true. Accepts `cron_secret`, `x-cron-secret`, or bearer token. |
| 4.2 `userId` and `dryRun` params | ✅ | ✅ | JSON body supports both. |
| 4.3 CLI script exists | ✅ | ✅ | `scripts/backfill-domains.ts`. |
| 4.3 `--dry-run`, `--apply`, `--user-id`; dry-run default | ✅ | ✅ | Implemented. |
| 4.3 Run sequence comment block | ✅ | ✅ | Present at top of script. |
| 4.4 Production state | ❓ | ❓ | Cannot verify without DB. Recommended query: count distinct `PLAYER_MASTERY.canonical_subcategory` per active user and inspect facet patterns such as `– Themes`, `Characters`, `Structure`, `& Characters`. |

---

## Section 5 — Prompt 10.1: Feed Redesign (Friend-Answered Propagation)

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 5.1 `feed_items.source_result` enum nullable | ⚠️ | ⚠️ | Implemented as `FeedItem.sourceResult` text, not DB enum constrained to `correct|incorrect`. |
| 5.1 `feed_items.source_user_id` FK | ✅ | ✅ | `sourceUserId` references `User.id`. |
| 5.1 Dismissed domains table with correct columns | ⚠️ | ⚠️ | Implemented as `FeedDismissedDomain` with `canonicalSubcategory`, not table named `dismissed_domains` with `domain`. Functional but divergent naming. |
| 5.1 Partial unique active dismissal constraint | 🔴 | 🔴 | Still no partial unique on `(userId, canonicalSubcategory) WHERE reinstatedAt IS NULL`; only indexes. |
| 5.1 `questions.surface_priority_score` | ✅ | ✅ | Present with default `0`. |
| 5.2 `propagateFriendAnswerToFeeds` function | ⚠️ | ⚠️ | Equivalent behavior is named `createFeedItemsForFriendsFromAnswer` in `src/server/feed/create-feed-items-for-answer.ts`; the requested file/function name is absent. |
| 5.2 Skips friends who already answered correctly | ✅ | ✅ | Uses `userAnsweredQuestionCorrectly`. |
| 5.2 Skips dismissed domain | ✅ | ✅ | Checks `FeedDismissedDomain` active row. |
| 5.2 Idempotency | ✅ | ✅ | Existing row check by recipient + question + source user. |
| 5.2 Checks thumbs-down by answering user | ✅ | ✅ | Checks both `questionFeedback` and `questionRatings`. |
| 5.2 Wrapped in try/catch | ✅ | ✅ | Public wrapper catches/logs and suppresses. |
| 5.2 ActivityItem for question author when applicable | ✅ | 🟡 | Writes `friend_answered_your_question` to previous answerers, not strictly only/always original question author. Good for activity, but broader than wording. |
| 5.3 Daily answer calls propagation | ✅ | ✅ | Calls `createFeedItemsForFriendsFromAnswer`; however see 5.3b. |
| 5.3 Feed answer calls propagation | ✅ | ✅ | Calls propagation after answer. |
| 5.3 Joshing answer calls propagation | ✅ | ✅ | Calls propagation before quip persistence. |
| 5.3 Catchup answer calls propagation | ✅ | ✅ | Calls propagation; however see 5.3b. |
| 5.3b Daily/catchup propagation FK correctness | 🔴 | 🔴 | **Still broken.** Daily answer passes `generatedQuestions.id` to `FeedItem.questionId`, which FK references `Question.id`; no Question row insertion was added. Catchup may pass `catchupItem.questionId`, which can be generated or real depending source. No Resolution A/B was implemented. |
| 5.4 Thumbs-down `/questions/[id]/rating` soft-deletes propagated + own feed items | ✅ | 🟡 | Current route delegates to `setRating`; not re-read here in detail, while feed-specific thumbsdown clearly does soft-delete. Treat route-level behavior as partial/needs direct `ratings.ts` confirmation for every branch. |
| 5.4 Feed thumbs-down soft-deletes own item and propagated items | ✅ | ✅ | `/api/feed/[feedItemId]/thumbsdown` dismisses own item and rolls off active/skipped propagated items where `sourceUserId=currentUser`. |
| 5.4 Inline confirmation copy still present | ✅ | ✅ | Present in `FeedList`. |
| 5.5 Thumbs-up increments priority | ✅ | ✅ | `/api/feed/[feedItemId]/thumbsup` increments `surfacePriorityScore`. |
| 5.5 Un-thumbs-up decrements priority | ✅ | 🟡 | Feed thumbsup has no DELETE; prior audit likely relied on `setRating` in `/questions/[id]/rating`. The feed UI has no visible un-thumbs-up path. |
| 5.5 Thumbs-up does not create FeedItems | ✅ | ✅ | No insert loop in thumbsup route. |
| 5.6 Feed ordering pinned, score, source event | 🟡 | 🟡 | Pinned and non-pinned are queried separately; non-pinned sorted in JS by score then time. Equivalent enough for output, but not one unified SQL order. |
| 5.6 Filters dismissed domains | ✅ | ✅ | Domain filter applied in `getFeedForUser`. |
| 5.6 Hydrates sourceResult/sourceUser/current answer/reaction | ✅ | 🟡 | Hydrates source result and source user. Current user's answer state is mostly UI-local (`cardStates`) and persisted feed item state; reaction state is not hydrated as pre-existing state. |
| 5.6 Multi-friend collapse | ✅ | ✅ | `collapseFriendAnsweredItems` returns `friendResults`; API renders joined copy. |
| 5.6 Limit 25 non-pinned + all pinned | ✅ | ✅ | Slices non-pinned to 25 after filter; all pinned included. |
| 5.7 Dismiss-domain POST/DELETE/GET | 🟡 | 🟡 | POST+DELETE live on `/api/feed/dismiss-domain`; GET lives on `/api/feed/dismissed-domains`, not same resource path. |
| 5.8 Three card variants; no authored_shared | 🟡 | 🟡 | One question card with conditional attribution/styling; direct_send and friend_answered are represented but not fully separate variants. No `authored_shared`. |
| 5.8 Friend-answer attribution | ✅ | ✅ | API returns `[Friend] got this right — [Domain]` / `couldn't get this`. |
| 5.8 Multi-friend collapsed copy | ✅ | ✅ | Joins up to three parts with ` · `. |
| 5.8 Pre-answer actions | 🟡 | 🟡 | Answer button label is `Send`, not `Answer`; Skip, Dismiss, Not my focus present. |
| 5.8 Post-answer comparison | 🟡 | ✅ | `comparisonCopy` gives user result + friend comparison for friend_answered cards. |
| 5.8 Not-my-focus endpoint + toast | ✅ | ✅ | Calls POST `/api/feed/dismiss-domain`, toast `Got it. No more ${domain} questions.` |
| 5.9 Hidden Domains section | 🟡 | 🟡 | Section exists but titled `FOCUSED FEED`, not literally `Hidden Domains`. |
| 5.9 Re-open buttons and optimistic removal | 🟡 | 🟡 | DELETE and optimistic removal present. No success toast. |
| 5.10 Empty states | ✅ | ✅ | Four specified concepts present. |
| 5.11 `friend_answered_your_question` union/render/hydration | ✅/⚠️ | ✅/⚠️ | Union/render present. Correctness is hydrated from `MASTERY_EVENTS`, not `ActivityItem.metadata`; metadata does not exist on `ActivityItem`. |

---

## Section 6 — Prompt 10.2: Authorship Opens Territory

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 6.1 `PlayerMastery.territoryType` column | 🔴 | 🔴 | Still absent from `PLAYER_MASTERY`. Territory type remains on `DeclaredInterest`. |
| 6.1 enum/default/backfill on PlayerMastery | 🔴 | 🔴 | No enum or migration for `PLAYER_MASTERY.territory_type`; no backfill. |
| 6.2 `openKBDomain` file/function | ✅ | ✅ | Exists in `src/server/knowledge/open-domain.ts`. |
| 6.2 Idempotent and sets declared/demonstrated by via | ✅ | ⚠️ | Works, but writes `DeclaredInterest`, not `PlayerMastery`; this is the core divergence. |
| 6.3 `promoteDeclaredToDemonstrated` | 🟡 | 🟡 | Exists and writes event/activity, but operates on `DeclaredInterest`, not `PlayerMastery`. |
| 6.3 `declared_promoted` MasteryEvent + ActivityItem | 🟡 | ✅ | Type union issue is fixed; inserts are present, though events are raw SQL and nonfatal. |
| 6.4 Authorship wiring | 🟡 | 🟡 | `/api/questions` calls `openKBDomain(... via:'authorship')` but with coarse form enum domain, and into `DeclaredInterest`. |
| 6.4 Toast/helper mentions declared territory | 🔴 | 🔴 | Knowledge page submit toast is still `Question saved.`; no declared territory copy. |
| 6.5 Feed route promotion | ⚠️ | ✅/⚠️ | Feed answer now calls `promoteDeclaredToDemonstrated` when correct and non-author, but promotion updates `DeclaredInterest`. |
| 6.5 Joshing route promotion | ⚠️ | 🔴 | No `promoteDeclaredToDemonstrated` import/call in joshing answer route. |
| 6.5 Daily/catchup promotion | ⚠️ | 🔴 | No promotion call in daily or catchup routes. |
| 6.6 Daily Five weighting/env vars | 🟡 | 🟡 | Hardcoded `DECLARED_DOMAIN_WEIGHT = 0.5`; no `DAILY_FIVE_DECLARED_WEIGHT` or `DAILY_FIVE_DEMONSTRATED_WEIGHT`. |
| 6.7 DomainCircle declared treatment | 🔴 | 🟡 | `DomainCircle` supports muted background for `territoryType='declared'`, but ProgressionLandscape must pass it; classic/portrait may not show equivalent outline. |
| 6.7 Domain detail explains declared status | 🟡 | 🟡 | Domain detail does not expose `territoryType` narrative; only existing declared-interest concepts remain. |
| 6.8 Ceremony Beat 2 three cases | 🔴 | 🔴 | No clear three-case friend-mediated/authored/promoted copy in `compute-beats.ts`. |
| 6.9 `declared_promoted` ActivityItem type/render | 🔴 | 🟡 | Type union and rendering exist, but copy is not the exact spec line (`[FriendName] explored your [Domain] territory.`); current copy says it is now proven territory. |

---

## Section 7 — Prompt 10.3: Onboarding Cultural Anchor

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 7.1 User schema birth/country/region | ✅ | ✅ | Present. |
| 7.2 `proposeInterests` accepts `culturalAnchor` | ✅ | ✅ | Type and parameter present. |
| 7.2 Prompt uses cultural anchor instructions | ✅ | ✅ | `buildCulturalAnchorPrompt` includes birth/place/era instructions. |
| 7.2 Returns 10–14 candidates | ✅ | ✅ | Prompt says exactly 10 to 14; fallback slices to 14 and fills when fewer than 10. |
| 7.3 API accepts `culturalAnchor` | ✅ | ✅ | Body type and parser use `culturalAnchor`. |
| 7.3 Validates birthYear currentYear-13 | ✅ | ✅ | Server computes `new Date().getFullYear() - 13`. |
| 7.3 Validates country ISO code | ✅ | ✅ | Checks `VALID_ISO_CODES` or `OTHER`. |
| 7.3 Saves anchor before LLM | ✅ | ✅ | `updateUser` precedes `proposeInterests`. |
| 7.3 Client wiring sends `culturalAnchor` | 🔴 | ✅ | Fixed: `generateProposals` posts `culturalAnchor`, not `demographicContext`. |
| 7.4 Cultural step between welcome/warmup | 🟡 | ✅ | `background` step is between welcome and warmup. |
| 7.4 Year picker max dynamically currentYear-13 | 🟡 | 🟡 | Validation uses dynamic `maxBirthYear`, but the input `max` attribute is still hardcoded to `2010` (wrong for 2026; should be 2013). |
| 7.4 Country selector searchable | 🟡 | 🟡 | Plain `<select>`, not searchable. |
| 7.4 US region selector | ✅ | ✅ | Appears when `grewUpCountry === 'US'`. |
| 7.4 Required validation | ✅ | ✅ | Continue disabled until birth year/country/(US region) valid. |
| 7.5 Warmup 3 fields and required first two | 🔴/✅ | ✅ | `canGenerate` now uses `deepDive` and `hourLongTopic`; no stale `bookComposerFilmmaker`. |
| 7.6 Country/region data files | ✅ | ✅ | Present. |
| 7.7 Existing users unaffected | ✅ | ✅ | Proxy still relies on `onboardingComplete`; completed users skip onboarding. |

---

## Section 8 — Prompt 10.4: Joshing Commentary

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 8.1 Daily answer quip storage | 🔴 | 🟡 | No `daily_answers` table; daily/catchup persist quip inside `DailyQueue.slots` JSON. |
| 8.1 JoshingGameResponse quip column | 🔴 | ✅ | Column exists in schema and migration. |
| 8.1 Feed answer storage quip | 🔴 | ✅ | `FeedItem.quip` column exists and feed answer sets it. |
| 8.2 `select-quip.ts` exists | 🔴 | ✅ | `src/server/grading/select-quip.ts` exists. |
| 8.2 All 6 banks | 🔴 | ✅ | Six exported banks present. |
| 8.2 ≤8 word constraint enforced | 🔴 | 🟡 | Enforced by test expectations, not runtime assertion. Good enough for CI if tests run. |
| 8.2 `{name}` substitution | 🔴 | ✅ | `sub()` replaces `{name}`; tests cover. |
| 8.2 Edge cases | 🔴 | 🟡 | Handles `friendResult=null` and joshing_game fallback; partial grade is only indirectly treated as `isCorrect`; multi-recipient joshing uses most recent prior response, not all recipients. |
| 8.3 Daily endpoint calls/persists/returns quip | 🟡 | ✅ | Daily calls `selectQuip`, stores in queue slot, returns `quip`. |
| 8.3 Feed endpoint calls/persists/returns quip | 🟡 | ✅ | Feed calls, stores on FeedItem, returns. |
| 8.3 Joshing endpoint calls/persists/returns quip | 🟡 | ✅ | Calls after response, updates `JoshingGameResponse.quip`, returns. |
| 8.3 Catchup endpoint calls/persists/returns quip | 🟡 | ✅ | Catchup calls `selectQuip`, stores in queue slot, returns. |
| 8.4 GameplayChat quip render | 🟡 | 🟡 | Renders after breadcrumb and is styled italic/muted, but no distinct ~150ms delay in `QuipLine`. |
| 8.4 Order result → breadcrumb → quip | 🟡 | ✅ | Current message render order is `ResultRow`, `BreadcrumbRow`, `QuipLine`. |
| 8.5 `select-interpretive-line.ts` exists | 🔴 | 🔴 | Still no server file; logic is inlined in `/daily/summary/page.tsx`. |
| 8.5 Seven priority cases | 🔴 | 🟡 | Inlined client function appears to cover tier crossing/new domain/5-5/0-5/3-streak/domain all-wrong/fallback null, but not as server function. |
| 8.6 `/daily/summary` render below score and 300ms | 🟡 | 🟡 | 300ms delay exists, but line renders later in page after recap/growth/mastery moment, not directly below score line. |
| 8.6 Null gracefully | ✅ | ✅ | Conditional render omits component. |
| 8.7 select-quip tests | 🔴 | ✅ | `src/server/grading/select-quip.test.ts` exists and covers banks/combinations/name substitution. |

---

## Section 9 — PRD v11.1 Cross-Cutting Conformance

| Item | Prior | Current | Notes |
|---|---:|---:|---|
| 9.1 Killed: broadcast share toggle | ✅ | ✅ | Absent. |
| 9.1 Killed: authored_shared visual variant | ✅ | ✅ | Absent; rows filtered. |
| 9.1 Killed: spider graph | ✅ | ✅ | No spider view found. |
| 9.1 Killed: Knowledge streak surfacing | ✅ | ✅ | No visible Knowledge streak UI. |
| 9.1 Killed: dedicated "Your Declared Interests" section | 🟡 | 🟡 | No titled standalone section, but modal/management UI still heavily uses declared-interest concept. |
| 9.2 Grow your map section with 2 buttons | ✅ | ✅ | Present. |
| 9.2 Manage interests link in Account | ✅ | ✅ | `/account` links to `/knowledge?interests=manage`. |
| 9.2 Hidden Domains section | 🟡 | 🟡 | Present as Focused Feed hidden domains, not title-matching. |
| 9.3 DomainCircle tier-anchored sizing | ✅ | 🟡 | `DomainCircle` consumes diameter; actual central sizing likely in ProgressionLandscape. Needs full sizing-function audit. |
| 9.3 Establishing smaller than Solid | ✅ | 🟡 | Likely via ProgressionLandscape, but not verified fully in this pass. |
| 9.3 Sizing function centralized | ✅ | 🟡 | Needs direct sizing helper confirmation; not obvious in `DomainCircle` itself. |
| 9.4 Joshing Games recipients friends-only | ✅ | ✅ | Validates recipients with `getFriends`; non-friend returns 403. |
| 9.4 `/api/users` returns friends only | ✅ | ✅ | Uses `getFriends(session.userId)`. |
| 9.4 `/api/questions/send` validates recipient is friend | 🔴 | 🔴 | Still no `getFriends` check; any valid user id can be sent to if not already blocked. |
| 9.5 SMS friend-answered trigger default OFF opt-in | 🔴 | 🟡 | Enum value `friend_answered_question` exists; no clear trigger/send path or per-message opt-in default-off setting found. |
| 9.6 OTP hardcoded 000000 | ⚠️ | ⚠️ | Still accepted unconditionally in `verifyOtp`, including production. |
| 9.6 `/feed` renders FeedList | ✅ | ✅ | Feed page uses feed component, not FriendsList. |
| 9.6 Vercel cron schedules | ✅ | ✅ | `daily-assignments` at `0 6 * * *`, `biweekly-ceremony` at `0 8 * * *`; correctness vs PRD depends on intended UTC. |
| 9.6 env-check Twilio var | ✅ | ✅ | Requires `TWILIO_MESSAGING_SERVICE_SID`, plus SID/token. |

---

## Section 10 — Schema Snapshot

### Tables in `src/server/db/schema.ts`

| Table export | DB table | Column count |
|---|---|---:|
| `users` | `User` | 23 |
| `userSessions` | `UserSession` | 5 |
| `otpCodes` | `OtpCode` | 5 |
| `questions` | `Question` | 43 |
| `questionAudienceTags` | `QuestionAudienceTag` | 5 |
| `userQuestionBank` | `UserQuestionBank` | 6 |
| `playerMastery` | `PLAYER_MASTERY` | 9 |
| `masteryEvents` | `MASTERY_EVENTS` | 14 |
| `questionReactions` | `QuestionReaction` | 10 |
| `creatorNotes` | `CreatorNote` | 11 |
| `gradeDisputes` | `GradeDispute` | 9 |
| `smsLogs` | `SmsLog` | 5 |
| `generatedQuestions` | `GeneratedQuestion` | 12 |
| `questionFeedback` | `QuestionFeedback` | 6 |
| `questionRatings` | `QuestionRating` | 5 |
| `dailyQueues` | `DailyQueue` | 5 |
| `dailyPreferences` | `DailyPreference` | 9 |
| `skippedDailyQuestions` | `SkippedDailyQuestion` | 7 |
| `userDomainDifficulties` | `USER_DOMAIN_DIFFICULTY` | 7 |
| `userDomainExclusions` | `USER_DOMAIN_EXCLUSIONS` | 4 |
| `profileDomainVisibility` | `PROFILE_DOMAIN_VISIBILITY` | 7 |
| `declaredInterests` | `DeclaredInterest` | 7 |
| `friendships` | `Friendship` | 10 |
| `joshingGames` | `JoshingGame` | 5 |
| `feedItems` | `FeedItem` | 14 |
| `joshingGameRecipients` | `JoshingGameRecipient` | 4 |
| `joshingGameQuestions` | `JoshingGameQuestion` | 4 |
| `joshingGameResponses` | `JoshingGameResponse` | 12 |
| `biweeklyCeremonies` | `BiweeklyCeremony` | 8 |
| `activityItems` | `ActivityItem` | 9 |
| `feedDismissedDomains` | `FeedDismissedDomain` | 5 |
| `friendInvitations` | `FriendInvitation` | 10 |

### Required v11.1 additions

| Addition | Status | Notes |
|---|---:|---|
| `User.birthYear`, `grewUpCountry`, `grewUpRegion` | ✅ | Present. |
| `FeedItem.sourceResult`, `sourceUserId` | ⚠️ | Present as camelCase/text; sourceUserId FK present; sourceResult not enum. |
| `Question.surfacePriorityScore` | ✅ | Present. |
| `dismissed_domains` | ⚠️ | Present as `FeedDismissedDomain`; no active partial unique. |
| `PlayerMastery.territoryType` | 🔴 | Missing; on `DeclaredInterest` instead. |
| Daily answer `quip` | 🟡 | In `DailyQueue.slots` JSON, not normalized table. |
| Feed answer `quip` | ✅ | `FeedItem.quip`. |
| Joshing response `quip` | ✅ | `JoshingGameResponse.quip`. |

### Required v11.0 tables

DeclaredInterest, Friendship, FeedItem, JoshingGame, JoshingGameRecipient, JoshingGameQuestion, JoshingGameResponse, BiweeklyCeremony, ActivityItem, FriendInvitation, QuestionRating, and CreatorNote are present.

### Extra / legacy-ish tables not central to v11.1 list

`QuestionAudienceTag`, `UserQuestionBank`, `QuestionReaction`, `GradeDispute`, `SmsLog`, `GeneratedQuestion`, `QuestionFeedback`, `DailyQueue`, `DailyPreference`, `SkippedDailyQuestion`, `USER_DOMAIN_DIFFICULTY`, `USER_DOMAIN_EXCLUSIONS`, `PROFILE_DOMAIN_VISIBILITY`, `OtpCode`, `UserSession`.

---

## Section 11 — Route Inventory

### API routes and methods

| Route file | Methods |
|---|---|
| `src/app/api/account/adaptive-level/route.ts` | GET |
| `src/app/api/account/logout/route.ts` | POST |
| `src/app/api/account/route.ts` | GET, PATCH |
| `src/app/api/activities/read/route.ts` | POST |
| `src/app/api/activities/route.ts` | GET |
| `src/app/api/admin/backfill-domains/route.ts` | POST |
| `src/app/api/archive/route.ts` | GET |
| `src/app/api/auth/logout/route.ts` | POST |
| `src/app/api/auth/me/route.ts` | GET |
| `src/app/api/auth/request-otp/route.ts` | POST |
| `src/app/api/auth/verify-otp/route.ts` | POST |
| `src/app/api/bank/check/route.ts` | POST |
| `src/app/api/bank/route.ts` | GET, POST, DELETE |
| `src/app/api/ceremony/[ceremonyId]/route.ts` | GET |
| `src/app/api/ceremony/[ceremonyId]/share-token/route.ts` | POST |
| `src/app/api/ceremony/[ceremonyId]/viewed/route.ts` | POST |
| `src/app/api/ceremony/banner/route.ts` | GET |
| `src/app/api/creator-notes/[id]/delivered/route.ts` | POST |
| `src/app/api/creator-notes/route.ts` | POST |
| `src/app/api/cron/biweekly-ceremony/route.ts` | GET |
| `src/app/api/cron/daily-assignments/route.ts` | GET |
| `src/app/api/daily/answer/route.ts` | POST |
| `src/app/api/daily/catchup/answer/route.ts` | POST |
| `src/app/api/daily/catchup/dismiss/route.ts` | POST |
| `src/app/api/daily/catchup/route.ts` | GET |
| `src/app/api/daily/feedback/route.ts` | POST |
| `src/app/api/daily/preferences/route.ts` | GET, PATCH |
| `src/app/api/daily/queue/route.ts` | GET, POST |
| `src/app/api/daily/reset/route.ts` | POST |
| `src/app/api/daily/skip/route.ts` | POST |
| `src/app/api/daily/status/route.ts` | GET |
| `src/app/api/daily/summary/route.ts` | GET |
| `src/app/api/declared-interests/route.ts` | GET, PATCH |
| `src/app/api/feed/[feedItemId]/answer/route.ts` | POST |
| `src/app/api/feed/[feedItemId]/state/route.ts` | PATCH |
| `src/app/api/feed/[feedItemId]/thumbsdown/route.ts` | POST, DELETE |
| `src/app/api/feed/[feedItemId]/thumbsup/route.ts` | POST |
| `src/app/api/feed/dismiss-domain/route.ts` | POST, DELETE |
| `src/app/api/feed/dismissed-domains/route.ts` | GET |
| `src/app/api/feed/route.ts` | GET |
| `src/app/api/joshing-games/[id]/answer/route.ts` | POST |
| `src/app/api/joshing-games/[id]/route.ts` | GET |
| `src/app/api/joshing-games/route.ts` | POST |
| `src/app/api/knowledge/[domain]/route.ts` | GET, PATCH |
| `src/app/api/knowledge/route.ts` | GET |
| `src/app/api/knowledge/tidy/route.ts` | POST |
| `src/app/api/onboarding/canonicalize/route.ts` | POST |
| `src/app/api/onboarding/propose-interests/route.ts` | POST |
| `src/app/api/onboarding/save-interests/route.ts` | POST |
| `src/app/api/questions/[id]/rating/route.ts` | GET, POST |
| `src/app/api/questions/[id]/route.ts` | GET, PATCH, DELETE |
| `src/app/api/questions/route.ts` | GET, POST |
| `src/app/api/questions/send/route.ts` | POST |
| `src/app/api/questions/suggest-answer/route.ts` | POST |
| `src/app/api/questions/suggest/route.ts` | POST |
| `src/app/api/reactions/[id]/reply/route.ts` | POST |
| `src/app/api/reactions/route.ts` | POST, GET |
| `src/app/api/replay/grade/route.ts` | POST |
| `src/app/api/replay/missed/route.ts` | GET |
| `src/app/api/share/ceremony/[token]/route.ts` | GET |
| `src/app/api/users/route.ts` | GET |

### New/modified routes expected from 10.x

| Expected route/change | Status | Notes |
|---|---:|---|
| `/api/feed/dismiss-domain` GET/POST/DELETE | 🟡 | POST/DELETE here; GET split to `/api/feed/dismissed-domains`. |
| `/api/daily/answer` calls propagation + selectQuip | 🟡 | Calls both, but propagation uses generated id and likely fails FK. |
| `/api/feed/[id]/answer` calls propagation + selectQuip | ✅ | Present. |
| `/api/joshing-games/[id]/answer` calls propagation + selectQuip | ✅ | Present; no promotion call. |
| `/api/questions` POST calls `openKBDomain` | ⚠️ | Present, but writes `DeclaredInterest` and coarse domain. |
| `/api/questions/[id]/rating` updated behavior | 🟡 | Thin wrapper around `setRating`; feed-specific endpoints carry most visible behavior. |
| `/api/onboarding/propose-interests` accepts `culturalAnchor` | ✅ | Present. |
| `/feed` page renders feed, not FriendsList | ✅ | Confirmed by route behavior/source search. |

---

## Section 12 — End-to-End Flow Verification (read-only)

| Journey | Status | Trace |
|---|---:|---|
| 12.1 New user onboarding | 🟡 COMPLETE static path with UI caveats | `/login`/OTP exists; `/onboarding` flow now goes welcome → background → warmup → review → pick/confirm. Client now posts `culturalAnchor` and required warmup fields. Remaining caveats: country selector not searchable, birth input max attr stale `2010`, and no human click-through performed. |
| 12.2 Authored question opens declared territory | 🟡 BROKEN AT TERRITORY MODEL/TOAST | Floating/write paths can submit `QuestionForm`; `/api/questions` calls `openKBDomain(via:'authorship')`, but writes `DeclaredInterest`, not `PlayerMastery.territoryType='declared'`; toast does not mention declared territory. Visual may show declared only if Knowledge data maps `DeclaredInterest.territoryType` into progression. |
| 12.3 Friend-answered Feed propagation | 🟡 COMPLETE for real `Question` rows; BROKEN for Daily | Feed/joshing answers on `Question` rows propagate through `createFeedItemsForFriendsFromAnswer`, and `/api/feed` renders friend-answer attribution. Daily-generated answers still pass a generated id and likely fail to create feed items. |
| 12.4 Declared → demonstrated promotion | 🔴 BROKEN AT JOSHING/DAILY AND WRONG TABLE | Feed route calls `promoteDeclaredToDemonstrated` for authored questions answered correctly by another user, but it updates `DeclaredInterest`. Joshing and daily/catchup routes do not call it. Activity insert exists only when feed route promotion fires. |
| 12.5 Quip rendering | ✅/🟡 | Daily/feed/joshing/catchup call `selectQuip` and return/persist in their storage. `GameplayChat` renders quip after breadcrumb. Feed card order differs. No human visual timing verification. |
| 12.6 Session close interpretive line | 🟡 | `/daily/summary` has inlined `interpretiveLine()` and 300ms fade, but no server `select-interpretive-line.ts`, and line is not directly below score line. |
| 12.7 Domain reconciliation | 🟡 | Daily generation reconciliation exists; authored-question flow does not reconcile, and categorizer prompt enforcement is uneven. |
| 12.8 Hidden domains flow | 🟡 | Feed `Not my focus` POST dismisses domain; Knowledge lists hidden domains and DELETE reopens. Re-open toast `Re-opened` is absent. |

---

## Section 13 — TODO Markers

Search pattern: `TODO Phase|TODO R1|TODO R2|TODO R3|TODO v11|TODO v11.0|TODO v11.1|FIXME|XXX|HACK` under `src/`.

### Friend system / profiles

| File | Line | Text |
|---|---:|---|
| `src/lib/knowledge-card.ts` | 9 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/lib/knowledge-card.ts` | 15 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/lib/knowledge-card.ts` | 21 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/lib/knowledge-card.ts` | 27 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/lib/knowledge-card.ts` | 33 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/db/queries/joshing-game.ts` | 511 | `// TODO Phase 8: replace with getFriends() when friend system is built.` |
| `src/server/profile/portrait.ts` | 38 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/portrait.ts` | 44 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/portrait.ts` | 50 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/friend.ts` | 2 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/knowledge.ts` | 23 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/knowledge.ts` | 29 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/knowledge.ts` | 36 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/knowledge.ts` | 42 | `// TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/mastery/write-mastery-event.ts` | 57 | `// TODO Phase 8: write friend_mastery activity for each friend when` |

### Legacy Prisma / Drizzle rewrite

| File | Line | Text |
|---|---:|---|
| `src/lib/games/winner.ts` | 10 | `// PrismaClient removed - TODO R2: rewire to Drizzle db client` |
| `src/server/daily/mastery.ts` | 52 | `// TODO R2: complex mastery query — needs full Drizzle rewrite` |
| `src/server/mastery/awards.ts` | 14 | `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.` |
| `src/server/mastery/season-snapshot.ts` | 10 | `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.` |

### Legacy group / v11.0 data-source gaps

| File | Line | Text |
|---|---:|---|
| `src/lib/games/winner.ts` | 40 | `// TODO v11.0: group member lookup needs new data source` |
| `src/lib/games/winner.ts` | 41 | `// TODO v11.0: group lookup needs new data source` |
| `src/lib/games/winner.ts` | 42 | `// TODO v11.0: answer.game_id winner scoping - needs new data source` |
| `src/server/sms.ts` | 155 | `// TODO v11.0: group member lookup needs new data source` |
| `src/server/mastery/season-snapshot.ts` | 32 | `// TODO v11.0: "GroupMember" raw SQL table - needs new data source` |

### No matches

No matches for `TODO R1`, `TODO R3`, `TODO v11.1`, `FIXME`, `XXX`, or `HACK`.

---

## Section 14 — Top Risks

### Top 5 v11.1 requirements still missing entirely

1. `PlayerMastery.territoryType` model/migration/backfill.
2. Daily/catchup propagation using a valid `Question.id` or schema that supports generated questions.
3. Friend validation on `/api/questions/send`.
4. Server-side `src/server/daily/select-interpretive-line.ts` module.
5. Active partial unique constraint for dismissed domains.

### Top 5 partial/divergent concerns

1. Territory semantics implemented on `DeclaredInterest` instead of `PlayerMastery`, causing open/promotion/visual semantics to drift.
2. Daily Five weighting hardcoded and not env-tunable; declared/demonstrated weights are approximate filtering, not explicit weighted sampling.
3. Dismiss-domain GET route split from POST/DELETE and no Re-open toast.
4. `sourceResult` is unconstrained text rather than enum.
5. `friend_answered_your_question` activity notifies previous answerers broadly, while authored-question activity semantics are underspecified.

### Top 5 prompt sequence incomplete/short-circuited signals

1. 10.5 did not fix the Daily/catchup propagation FK mismatch.
2. 10.5 did not migrate territory model to `PlayerMastery`; it left semantics on `DeclaredInterest`.
3. 10.5 fixed TS union and onboarding client contract but missed UI max attr and searchable country requirement.
4. 10.6 appears to have added quip module/tests/persistence but left interpretive-line server module unimplemented.
5. 10.2 promotion is only wired in feed answer route, not joshing/daily/catchup.

### Top 5 production behavior risks vs PRD intent

1. Daily answers will look successful while propagation silently fails inside caught propagation wrapper.
2. OTP `000000` remains a production bypass.
3. Non-friend users can receive direct questions through `/api/questions/send` if a forged user id is known.
4. Duplicate active dismissed-domain rows can accumulate without partial unique enforcement.
5. Build/deploy may fail in environments without Google Fonts fetch access unless font strategy is adjusted.

---

## Section 15 — Verdict

**Conformance estimate:** Current v11.1 conformance is roughly **68–75%** by static code coverage, up from the prior **55–65%**. Major movement: TypeScript is clean, html2canvas dependency exists, onboarding client/server contract is largely fixed, `declared_promoted` type/render exists, quip module/tests/persistence landed, and feed quip order in GameplayChat now matches result → breadcrumb → quip.

**Alpha blockers:** A 3–5 user alpha of the v11.1 social model is still blocked if Daily Five propagation is central: daily answers will not reliably create feed items because generated ids are passed into `FeedItem.questionId`. Territory validation is also compromised because declared/demonstrated state is on `DeclaredInterest`, not `PlayerMastery`, and promotion is not wired for Joshing Games. Security/social graph alpha is blocked by `/api/questions/send` accepting non-friend recipients. OTP `000000` should not be left enabled in production.

**Smallest fixes to alpha-test:** Persist or map Daily/catchup generated questions to real `Question` rows before propagation; add friend validation to `/api/questions/send`; either migrate territoryType to `PlayerMastery` or explicitly accept/document the `DeclaredInterest` model and wire promotion consistently; disable `000000` outside development/test; add a production/staging smoke test run before inviting users.

**What is working well:** The feed UX is substantially built: friend-answer attribution, collapse, skip/dismiss/not-my-focus, hidden domains, thumbs-down rollback copy, and empty states are real. Onboarding is much healthier than before. Quips are now modular and tested. Backfill/reconciliation machinery is usable. Joshing game recipient validation is solid, and `/api/users` now correctly returns only friends.

---

## Section 16 — Recommended Next Actions

### Critical fixes (blocking alpha)

1. **Fix Daily/catchup propagation FK** — **medium**, follow-up to 10.5 FIX 5. Implement Resolution A: create/idempotently reuse a `Question` row for each `GeneratedQuestion` before calling propagation; pass `Question.id`.
2. **Enforce friend graph in `/api/questions/send`** — **small**, PRD friend-graph hardening. Add `getFriends` validation and return 403 for forged non-friend ids.
3. **Production OTP safety** — **small**, new hotfix. Reject `000000` unless `NODE_ENV !== 'production'` or an explicit `ALLOW_TEST_OTP=true` is set.

### Important fixes (degrade alpha but not always blocking)

1. **Resolve territory model drift** — **large** if migrating to `PlayerMastery`, **medium** if documenting/finishing `DeclaredInterest` semantics. Covers 10.2/10.5 FIX 6.
2. **Wire promotion in joshing and daily/catchup where applicable** — **medium**, 10.2 completion.
3. **Add dismissed-domain partial unique constraint** — **small/medium**, schema migration.
4. **Move interpretive line to server module and reuse in summary API/UI** — **medium**, 10.4 completion.
5. **Make Daily Five declared/demonstrated weights env-tunable** — **small**, PRD conformance.

### Nice-to-haves (post-alpha)

1. Searchable country picker and dynamic input max attribute — **small**, 10.3 polish.
2. Exact `declared_promoted` activity copy per spec — **small**, 10.5 polish.
3. Unify dismiss-domain GET/POST/DELETE under one route — **small**, API polish.
4. Runtime quip word-count assertion in dev/test — **small**, 10.4 guardrail.
5. Replace network-fetched Google Font or vendor font for reliable builds — **medium**, deploy hardening.

---

## Section 17 — Hotfix Verification (10.5 + 10.6)

### 10.5 FIX 1 — html2canvas

| Claimed change | Actually implemented | Status | Notes |
|---|---|---:|---|
| Resolve missing `html2canvas` build failure via Path A or B | **Path A** taken | ✅/⚠️ | `package.json` includes `html2canvas` and `node_modules/html2canvas` exists. `SharePortraitModal` dynamically imports it. `npm run build` now fails later on Google Fonts fetch, not missing html2canvas. |

### 10.5 FIX 2 — `bookComposerFilmmaker`

| Claimed change | Actually implemented | Status | Notes |
|---|---|---:|---|
| `canGenerate` references `deepDive` + `hourLongTopic` | Yes | ✅ | `OnboardingFlow` now checks those two fields. |
| TS error line 197 gone | Yes | ✅ | `npx tsc --noEmit` exits 0. |
| `WarmupAnswers` matches form usage | Yes | ✅ | Type has `deepDive`, `hourLongTopic`, `anythingElse`; form maps those. |

### 10.5 FIX 3 — `declared_promoted`

| Claimed change | Actually implemented | Status | Notes |
|---|---|---:|---|
| ActivityItemType includes `declared_promoted` | Yes | ✅ | Type accepted; tsc clean. |
| Rendering layer case exists | Yes | ✅ | `/activities` renders `declared_promoted` and CTA. |
| Copy exactly `[FriendName] explored your [Domain] territory.` | No | 🟡 | Current copy says friend answered your domain question and the domain is now proven territory. Semantically fine, exact copy missing. |

### 10.5 FIX 4 — onboarding contract

| Claimed change | Actually implemented | Status | Notes |
|---|---|---:|---|
| Client sends `culturalAnchor`, not `demographicContext` | Yes | ✅ | `generateProposals` body uses `culturalAnchor`. |
| Year picker max dynamically currentYear - 13 | Partially | 🟡 | Validation is dynamic, but `<input max={2010}>` is hardcoded. |
| Warmup → POST → User row updated before LLM trace connected | Yes | ✅ | Client posts anchor; API parses/validates; `updateUser` runs before `proposeInterests`. |

### 10.5 FIX 5 — Daily/catchup propagation FK

| Claimed change | Actually implemented | Status | Notes |
|---|---|---:|---|
| Resolution A or B | Neither | 🔴 | No Daily `Question` insert before propagation; schema does not support `FeedItem.generatedQuestionId`. |
| If A, pass `Question.id` | No | 🔴 | Daily passes `question.id` where `question` is from `generatedQuestions`. |
| If A, idempotency prevents duplicate Question inserts | No | 🔴 | No insert/reuse logic present. |
| If B, schema supports both question IDs | No | 🔴 | `FeedItem` only has `questionId` FK to `questions`. |
| Daily answer creates friend FeedItems | No, likely fails | 🔴 | Insert into `feedItems.questionId` with generated id should violate FK; wrapper suppresses error. |

### 10.5 FIX 6 — territory model migration

| Claimed change | Actually implemented | Status | Notes |
|---|---|---:|---|
| `PlayerMastery.territoryType` exists | No | 🔴 | Missing. |
| Existing rows backfilled to demonstrated | No | 🔴 | No migration. |
| `openKBDomain` writes PlayerMastery | No | 🔴 | Writes `DeclaredInterest`. |
| `promoteDeclaredToDemonstrated` operates on PlayerMastery | No | 🔴 | Operates on `DeclaredInterest`. |
| Feed/joshing/daily/catchup call promotion | Partially | 🔴 | Feed only; joshing/daily/catchup absent. |
| `upgradeKBDomainToDemonstrated` deprecated/no callers | No evidence | 🔴 | `src/server/db/queries/daily.ts` still contains `upgradeKBDomainToDemonstrated`; no `@deprecated` tag observed. |
| `DeclaredInterest.territoryType` still exists unused | Exists and used | ⚠️ | It remains actively used for territory semantics, contrary to hotfix claim. |

### 10.6 FIX 1-10 — observed verification

Because the 10.6 prompt text is not present in the repository, verification is by inferred claimed fixes from the changed surfaces and prior audit gaps.

| FIX | Claimed/expected change | Actually implemented | Status | Notes |
|---|---|---|---:|---|
| 10.6 FIX 1 | Extract `selectQuip` to dedicated module | `src/server/grading/select-quip.ts` exists | ✅ | Six banks exported. |
| 10.6 FIX 2 | Enforce/codify ≤8 word quip banks | Test verifies every entry ≤8 words | ✅ | Runtime guard absent, but tests cover. |
| 10.6 FIX 3 | `{name}` substitution | Implemented and tested | ✅ | Default name `them` can produce awkward grammar (`them didn't`) but functional. |
| 10.6 FIX 4 | Daily answer endpoint uses/persists/returns quip | Implemented | ✅ | Stored in queue slot JSON. |
| 10.6 FIX 5 | Feed answer endpoint uses/persists/returns quip | Implemented | ✅ | Stored on `FeedItem.quip`. |
| 10.6 FIX 6 | Joshing answer endpoint uses/persists/returns quip | Implemented | ✅ | Updates `JoshingGameResponse.quip`. |
| 10.6 FIX 7 | Catchup answer endpoint uses/persists/returns quip | Implemented | ✅ | Stored in queue slot JSON. |
| 10.6 FIX 8 | GameplayChat order result → breadcrumb → quip | Implemented | ✅ | No explicit 150ms quip delay observed. |
| 10.6 FIX 9 | Interpretive-line module/summary | Partially/inlined | 🟡 | No `src/server/daily/select-interpretive-line.ts`; client summary has inlined function and 300ms fade. |
| 10.6 FIX 10 | Tests for selectQuip combinations | Implemented | ✅ | Vitest test file covers banks, combinations, substitution, unknown surface. |

---

## Section 18 — Prompt Execution Drift Analysis

This section classifies verification steps that the prompt sequence implicitly or explicitly required. Some prompt texts are not in-repo, so classifications are inferred from the PRD/prompt requirements and prior audit failure modes.

| Prompt | Verify step | Classification | Was it verified? | Bug class it would catch |
|---|---|---|---|---|
| 9.0 | Search for broadcast toggle and `authored_shared` UI | AUTOMATABLE | ✓ | Broadcast rollback regression. |
| 9.0 | Submit authored question and observe no broadcast feed item | REQUIRES-HUMAN | Apparently yes/mostly | UI/API mismatch. |
| 9.0 | Test thumbs-down undo timing | REQUIRES-HUMAN | Apparently not | Timer/copy/action regression. |
| 9.1 | Inspect categorizer prompt and reconciliation function | AUTOMATABLE | ✓ | Prompt/LLM guard absence. |
| 9.1 | Create facet-domain question and inspect resulting domain | REQUIRES-HUMAN | Apparently not | Question creation not reconciled. |
| 9.1 | Generate Daily Five and ensure no facet narrowing | REQUIRES-HUMAN | Apparently not | LLM output drift. |
| 9.2 | Run dry-run backfill script | AUTOMATABLE | Unknown | Script/runtime env errors. |
| 9.2 | Review production DB merge results | REQUIRES-HUMAN | Unknown/apparently not | Unsafe merges or no-op backfill. |
| 10.1 | Trigger propagation from feed answer | REQUIRES-HUMAN | Apparently partly | Feed route propagation bugs. |
| 10.1 | Trigger propagation from Daily Five answer | REQUIRES-HUMAN | Apparently not | GeneratedQuestion vs Question FK mismatch. |
| 10.1 | Dismiss/reopen hidden domain in UI | REQUIRES-HUMAN | Apparently partly | Missing Re-open toast/route split. |
| 10.1 | Forge send to non-friend | AUTOMATABLE | Apparently not | Friend graph bypass. |
| 10.2 | Author question opens declared territory | REQUIRES-HUMAN | Apparently partly | Wrong table/visual/toast mismatch. |
| 10.2 | Friend answers authored question and author sees promotion/activity | REQUIRES-HUMAN | Apparently not | Promotion not wired in all answer surfaces. |
| 10.2 | Inspect schema for PlayerMastery territory type | AUTOMATABLE | Missed | Territory model on wrong table. |
| 10.3 | Sign up as new user and complete onboarding | REQUIRES-HUMAN | Apparently not before 10.5 | Client/server contract drift and warmup gate bug. |
| 10.3 | Validate anchor persisted before LLM | AUTOMATABLE | Missed before 10.5, now ✓ | Wrong body key (`demographicContext`). |
| 10.3 | Check year max in UI | AUTOMATABLE/HUMAN | Partly missed | Stale max attribute. |
| 10.4 | Answer in all four contexts and see quips | REQUIRES-HUMAN | Apparently not fully | Missing persistence/render/order. |
| 10.4 | Run quip unit tests | AUTOMATABLE | Now present; not run in this audit unless through tsc | Bank constraint regressions. |
| 10.4 | Complete Daily Five and see summary interpretive line | REQUIRES-HUMAN | Apparently not | Missing server module/placement issues. |
| 10.5 | `npx tsc --noEmit` exits 0 | AUTOMATABLE | ✓ | Type drift. |
| 10.5 | `npm run build` exits 0 | AUTOMATABLE | ⚠️ blocked by font network | Missing deps/build errors. |
| 10.5 | Daily propagation creates friend feed item | REQUIRES-HUMAN | Apparently not | FK mismatch still present. |
| 10.5 | Promotion writes to PlayerMastery | AUTOMATABLE | Missed | Hotfix claimed wrong table. |
| 10.6 | Quip endpoints persist/return | AUTOMATABLE | ✓ by static reading | Endpoint omission. |
| 10.6 | GameplayChat visual timing/order | REQUIRES-HUMAN | Apparently partly | Missing 150ms delay. |
| 10.6 | Interpretive line server module exists | AUTOMATABLE | Missed | Inlined client-only implementation. |

### Aggregate

- **Total verify steps counted:** 28
- **AUTOMATABLE:** 12 / 28 = **43%**
- **REQUIRES-HUMAN or human-like UI flow:** 16 / 28 = **57%**
- **REQUIRES-HUMAN apparently performed:** about 4 / 16 = **25%**
- **REQUIRES-HUMAN apparently skipped or only partially performed:** about 12 / 16 = **75%**

**Discipline conclusion:** The 10.5/10.6 round improved automatable correctness (`tsc`, quip tests, code wiring), but the highest-risk regressions remain exactly where verification required an end-to-end click or multi-account smoke test: Daily propagation, declared promotion, onboarding UI polish, hidden-domain toasts, and OTP production safety.

---

## Section 19 — Production Smoke Test Plan

1. **Action:** Create a brand-new user on staging via SMS OTP, complete welcome → cultural anchor → warmup → review → confirmation → home.  
   **Expected outcome:** User lands on `/`, `onboardingComplete=true`, birth year/country/region persisted.  
   **Catches:** Onboarding client/server contract drift, warmup gate bugs, cultural anchor not persisted.  
   **Depends on:** 10.3 cultural anchor/onboarding.

2. **Action:** Existing user with at least one friend signs in and opens `/feed`.  
   **Expected outcome:** Feed renders without hydration/server errors; if friends have active items, cards appear.  
   **Catches:** Feed query regressions, bad hydration, `/feed` rendering wrong component.  
   **Depends on:** 10.1 feed redesign.

3. **Action:** User A answers a Daily Five question; within 30 seconds, User B (friend) refreshes `/feed`.  
   **Expected outcome:** User B sees A's answered question attribution.  
   **Catches:** Daily/catchup propagation FK mismatch and swallowed propagation errors.  
   **Depends on:** 10.1 propagation, Daily Five.

4. **Action:** User A authors a question and saves bank-only. Open A's `/knowledge`.  
   **Expected outcome:** Domain appears as declared/outlined/muted territory; toast mentions declared territory when newly opened.  
   **Catches:** `openKBDomain` wrong table, declared visual missing, toast mismatch.  
   **Depends on:** 10.2 authorship territory.

5. **Action:** User B answers User A's authored question correctly. User A opens `/knowledge` and `/activities`.  
   **Expected outcome:** Domain is demonstrated/full color; activity says friend explored/promoted the territory.  
   **Catches:** Promotion not wired, wrong table, missing ActivityItem type/render.  
   **Depends on:** 10.2 promotion, 10.1 feed answer.

6. **Action:** User A thumbs-downs a question they answered; User B refreshes feed where that propagated item would appear.  
   **Expected outcome:** Item is absent/rolled off; A sees inline confirmation for 4 seconds.  
   **Catches:** Thumbs-down propagation block/rollback regressions.  
   **Depends on:** 9.0 rollback, 10.1 thumbs-down.

7. **Action:** In `/feed`, click `Not my focus` for a domain; open `/knowledge`, then Re-open it.  
   **Expected outcome:** Domain disappears from feed, appears in Hidden/Focused Feed section, Re-open removes it and shows `Re-opened` toast.  
   **Catches:** Dismiss-domain endpoint regressions, missing toast, optimistic UI bugs.  
   **Depends on:** 10.1 hidden domains.

8. **Action:** Complete a Daily Five and open `/daily/summary`.  
   **Expected outcome:** Score line renders, interpretive line appears after ~300ms, each answer recap/chat shows quip in proper order.  
   **Catches:** Interpretive line missing, quip not rendered, ordering/timing bugs.  
   **Depends on:** 10.4 commentary.

9. **Action:** POST directly to `/api/questions/send` with a forged non-friend `recipientUserId`.  
   **Expected outcome:** 403 response and no FeedItem created.  
   **Catches:** Friend validation missing on send endpoint.  
   **Depends on:** 9.4 friend graph enforcement.

10. **Action:** Attempt OTP login in production/staging production mode with code `000000`.  
    **Expected outcome:** Rejected unless explicit test-OTP env gate is enabled for staging only.  
    **Catches:** OTP back door.  
    **Depends on:** Production safety.

---

## Section 20 — Final Verdict

**(a) Conformance delta:** Prior audit estimated **55–65%**. Current estimate is **68–75%**. The biggest improvements are automatable and local: TypeScript clean, onboarding contract fixed, quip module/tests and endpoint persistence added, `declared_promoted` type/render added, and html2canvas installed. The biggest unchanged gaps are systemic: Daily propagation FK, territory model wrong table, missing `/api/questions/send` friend validation, and missing server interpretive-line module.

**(b) Alpha-readiness:** Not yet ready for a 3–5 user alpha **if the alpha is meant to validate the v11.1 social loop end-to-end**. Feed answers on authored/real Question rows can validate part of the loop, but Daily Five propagation — a central habit loop — still appears broken. Promotion is incomplete, and non-friend direct-send is a trust/security blocker. Execution discipline improved on static checks, but human smoke-test coverage remains insufficient.

**(c) Recommended next move:** Do **one more focused hotfix round** before starting 11.x or inviting alpha users. Scope it tightly: fix Daily/catchup propagation with real Question rows, add `/api/questions/send` friend validation, gate OTP `000000`, and either migrate or explicitly finish the chosen territory table semantics. Then run the Section 19 smoke test with two real accounts before declaring alpha-ready.
