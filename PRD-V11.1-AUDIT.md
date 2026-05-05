# PRD v11.1 — Codebase audit (read-only)

**Repository:** `joshing-v11` (`C:\Users\rpala\Desktop\dev\joshing-11`)  
**Audit date:** 2026-05-05  
**Methodology:** Function-body and route logic reviewed per section; statuses use ✅ 🟡 🔴 ⚠️ ❓ as specified.

---

## Section 1 — Build Health

| Check | Result |
|--------|--------|
| **`npx tsc --noEmit`** | **2 errors** (exit code 2) |
| **First errors (verbatim)** | `src/app/onboarding/OnboardingFlow.tsx(197,35): error TS2339: Property 'bookComposerFilmmaker' does not exist on type 'WarmupAnswers'.` |
| | `src/server/knowledge/open-domain.ts(94,33): error TS1360: Type '"declared_promoted"' does not satisfy the expected type 'ActivityItemType'.` |
| **`npm run build`** | **Failure** — Turbopack: `Module not found: Can't resolve 'html2canvas'` from `./src/components/knowledge/SharePortraitModal.tsx:65` (dependency appears in `package.json` but resolution failed in this environment). |
| **`npm run dev` starts cleanly** | **Not verified** — automated start on this host failed (`Start-Process` / `npm` Win32 issue); no server log captured. Treat as ❓ **UNCLEAR** for this run. |
| **`@prisma/client` in `src/`** | **None found** (grep). |
| **`src/lib/prisma.ts`** | **Does not exist** ✅ |
| **Files under `src/`** | **237** files (PowerShell recursive file count). |

---

## Section 2 — Prompt 9.0: Broadcast Share Rollback

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 2.1 QuestionForm: "Share with friends" toggle absent | ✅ | Destinations block is only locked "Save to bank" + toggle "Send to specific friends" (`QuestionForm.tsx`; no broadcast toggle). |
| 2.1 "Save to bank" locked default | ✅ | Checkbox `checked readOnly disabled`. |
| 2.1 "Send to specific friends" toggleable | ✅ | `specificMode` + friend picker. |
| 2.1 Helper text references broadcast | ✅ | Text is either “Sent directly…” or “Saved to your bank.” — no broadcast. |
| 2.1 Toast "Saved and shared with your friends." | ✅ | `questions/page.tsx` uses `setToast('Saved to your bank.')`. |
| 2.2 POST `/api/questions`: `shareToFeed` branch removed | ✅ | `readCreatePayload` / POST have no `shareToFeed`; only `sendToFriendIds`. |
| 2.2 `authored_shared` creation loop removed | ✅ | POST creates `direct_sent` feed rows only when `sendToFriendIds.length > 0`. |
| 2.2 Specific-friend branch intact | ✅ | Validates friends, inserts pinned `direct_sent` items, SMS, `sharedToFriendsFeed`. |
| 2.2 `shareToFeed` removed from body schema | ✅ | Not read from body. |
| 2.3 FeedList: `authored_shared` variant removed | ✅ | No ✎ / "wrote this" branch; styles handle `direct_sent`, `friend_answered`, `joshing_game`, legacy `thumbs_upped`. |
| 2.4 `getFeedForUser`: `authored_shared` handled | ✅ | `/api/feed/route.ts` filters `sourceType !== 'authored_shared'` before mapping. |
| 2.5 Thumbs-down copy: removed / restored | ✅ | Strings match spec (`FeedList.tsx`). |
| 2.5 4-second behavior | ✅ | `setTimeout(..., 4000)` for remove + undo fade. |
| 2.6 Cleanup script exists | ✅ | `scripts/cleanup-authored-shared-feed-items.ts` |
| 2.6 `--dry-run` / `--apply` | ✅ | Defaults to dry-run unless `--apply`. |

---

## Section 3 — Prompt 9.1: Categorizer Fix

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 3.1 Granularity prompt section + GOOD/BAD + forbid facets | ✅ | `generate-questions.ts` `SYSTEM_PROMPT` includes `GRANULARITY RULES`, lists GOOD/BAD, forbids facet qualifiers. |
| 3.2 `reconcileProposedDomain` | ✅ | `src/lib/questions/categorization.ts` — loads KB via `getKnowledgeBase`, Haiku `claude-haiku-4-5`, 3s timeout + fallback, logs `[reconcile]`, returns `{ canonicalDomain, reconciled }`. |
| 3.3 Reconciliation in question **creation** | 🔴 | `createQuestion` in `questions.ts` inserts with `category` only; **no** `reconcileProposedDomain` call. Authored domains are coarse enum from form, not LLM facets. |
| 3.3 Reconciliation in Daily Five generation | ✅ | `generate-questions.ts` calls `reconcileProposedDomain` before insert. |
| 3.3 `[reconcile]` log | ✅ | Present on success paths. |
| 3.4 Daily Five facet-narrowing | 🟡 | Prompt mandates matching domain; **no** runtime assert if LLM returns mismatched `canonical_subcategory`. |

---

## Section 4 — Prompt 9.2: Domain Backfill

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 4.1 `runAggressiveDomainBackfillForUser` in `ceremony.ts` | ✅ | Exists; uses `suggestAggressiveDomainMerges` with aggressive facet-to-parent rules; `applyMergesForUser` transactional. |
| 4.2 `src/app/api/admin/backfill-domains/route.ts` | ✅ | POST; auth via `CRON_SECRET` / `VERCEL_CRON_SECRET` / `cron_secret` / `x-cron-secret` / `Authorization: Bearer` (⚠️ header name is not strictly `CRON_SECRET` only — broader). |
| 4.2 `userId` + `dryRun` | ✅ | Optional JSON body. |
| 4.3 `scripts/backfill-domains.ts` | ✅ | Top comment run sequence; `--dry-run` default; `--apply`; `--user-id=`. |
| 4.4 Production backfill run | ❓ | **UNCLEAR** without DB — suggest sample query on `PLAYER_MASTERY.canonical_subcategory` for facet patterns. |

---

## Section 5 — Prompt 10.1: Feed Redesign (Friend-Answered Propagation)

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 5.1 `feed_items.source_result` enum | ⚠️ | Column `sourceResult: text` — not DB enum `correct|incorrect` (behavior still uses those strings). |
| 5.1 `source_user_id` FK | ✅ | `sourceUserId` references `users`. |
| 5.1 `dismissed_domains` table | ⚠️ | Implemented as **`FeedDismissedDomain`** (`feedDismissedDomains`) with `canonicalSubcategory`, `dismissedAt`, `reinstatedAt`. |
| 5.1 Unique (userId, domain) where `reinstatedAt` null | 🔴 | Only indexes on `(userId)` and `(userId, canonicalSubcategory)` — **no** partial unique constraint in schema. |
| 5.1 `questions.surface_priority_score` | ✅ | `surfacePriorityScore` default 0. |
| 5.2 `propagateFriendAnswerToFeeds` file | ⚠️ | Logic lives as **`createFeedItemsForFriendsFromAnswer`** in `src/server/feed/create-feed-items-for-answer.ts` (same responsibilities). |
| 5.2 Skips friends already correct | ✅ | `userAnsweredQuestionCorrectly`. |
| 5.2 Skips dismissed domain | ✅ | Queries `feedDismissedDomains`. |
| 5.2 Idempotency same source+friend+question | ✅ | Existing `feedItems` row check. |
| 5.2 Thumbs-down before propagate | ✅ | `questionFeedback` + `questionRatings` down. |
| 5.2 try/catch no break parent | ✅ | Outer function catches/logs. |
| 5.2 Activity for author | ✅ | `writeActivity` `friend_answered_your_question` for prior answerers. |
| 5.3 Wiring: daily answer | ✅ | Calls `createFeedItemsForFriendsFromAnswer` — see **5.3b** below. |
| 5.3 Wiring: feed answer | ✅ | `void createFeedItemsForFriendsFromAnswer(...)`. |
| 5.3 Wiring: joshing answer | ✅ | Same. |
| 5.3 Wiring: catchup answer | ✅ | Same. |
| **5.3b Daily/catchup propagation correctness** | 🔴 | Passes **`generatedQuestions.id`** into propagation; `feedItems.questionId` **FKs to `Question`**. Inserts will **fail** (caught/logged) — friends do **not** receive feed items from Daily Five / catch-up answers in practice. |
| 5.4 Thumbs-down `/questions/[id]/rating` | ✅ | `setRating` on `down` rolls off propagated items + own feed items (`ratings.ts`). |
| 5.4 Feed thumbs-down (`/api/feed/.../thumbsdown`) | ✅ | `questionFeedback` + dismiss item + roll off propagated. |
| 5.4 Inline confirmation regression | ✅ | Still in `FeedList.tsx`. |
| 5.5 Thumbs-up priority | ✅ | `thumbsup` route increments `surfacePriorityScore`. |
| 5.5 Un-thumbs-up decrement | ✅ | `setRating` deletes or switches from `up` decrements score. |
| 5.5 Thumbs-up does not create friend FeedItems | ✅ | No insert loop in thumbsup route. |
| 5.6 Feed query ordering | 🟡 | Pinned block first (by `sourceEventAt` desc), then non-pinned sorted by **`surfacePriorityScore` then `sourceEventAt`** — not a single SQL `ORDER BY isPinned, score, time`. |
| 5.6 Filter dismissed domains | ✅ | `filterItem` + `getDismissedDomains`. |
| 5.6 Hydration sourceUser, sourceResult, collapse | ✅ | `/api/feed` builds attribution, `friend_results`, etc. "Own answer state" on feed card is implicit via card state; **reaction state** present via post-answer `QuestionReactionPrompt`. |
| 5.6 Multi-friend collapse | ✅ | `collapseFriendAnsweredItems` in `feed.ts`. |
| 5.6 Limit 25 non-pinned + pinned | ✅ | `slice(0, 25)` on filtered non-pinned; all pinned included. |
| 5.7 dismiss-domain POST/DELETE/GET | 🟡 | POST+DELETE on `/api/feed/dismiss-domain`; **GET list** on **`/api/feed/dismissed-domains`** (⚠️ path split vs single resource). |
| 5.8 Card variants | 🟡 | Question cards share `direct_sent` + default styling; `friend_answered` uses API attribution (not three totally separate components). **No** `authored_shared`. |
| 5.8 Friend attribution copy | ✅ | API `resultVerb` / multi-friend strings align with spec intent. |
| 5.8 Pre/post actions | 🟡 | Answer / Skip / Dismiss / Not my focus / thumbs — **post-answer** comparison line uses `comparisonCopy`; order of explanation vs quip vs breadcrumb in feed card: explanation, then quip, then breadcrumb (**⚠️ order** vs PRD 10.4 chat order). |
| 5.8 "Not my focus" toast | ✅ | `Got it. No more ${domain} questions.` |
| 5.9 Knowledge: Hidden / dismissed domains | 🟡 | Section titled “FOCUSED FEED… DOMAINS YOU'VE HIDDEN…” (not literally “Hidden Domains”); lists + Re-open via DELETE. |
| 5.9 Re-open toast "Re-opened" | 🔴 | `reinstateDomain` removes locally **no** success toast. |
| 5.10 Empty feed states | ✅ | Matches four cases in `emptyCopy` (`FeedList.tsx`). |
| 5.11 `friend_answered_your_question` in union | ✅ | `write-activity.ts` `ActivityItemType`. |
| 5.11 `/activities` copy | ✅ | `ActivityCopy` renders domain + correct/incorrect phrasing. |
| 5.11 `isCorrect` from metadata | ⚠️ | **Hydrated from `masteryEvents`**, not `ActivityItem.metadata` (schema has no JSON metadata on `ActivityItem`). |

---

## Section 6 — Prompt 10.2: Authorship Opens Territory

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 6.1 `PlayerMastery.territoryType` | 🔴 | **Not on `PLAYER_MASTERY`**. `territoryType` exists on **`DeclaredInterest`** (`declaredInterests.territoryType` default `'declared'`). |
| 6.2 `openKBDomain` | ✅ | `src/server/knowledge/open-domain.ts` — idempotent `alreadyExisted`, sets `declared` vs `demonstrated` by `via`. |
| 6.3 `promoteDeclaredToDemonstrated` | 🟡 | Exists with mastery event + activity insert — **but** activity type is not in TS union (**tsc error**); **`promoteDeclaredToDemonstrated` is never called** from answer routes. |
| 6.4 Questions POST + `openKBDomain` | 🟡 | Calls `addKBDomainAsDeclared` → `openKBDomain(..., via: 'authorship')` with **form `domain` (category enum)**. |
| 6.4 Toast "declared territory" | 🔴 | Only “Saved to your bank.” |
| 6.5 Promotion on answer endpoints | ⚠️ | Uses **`upgradeKBDomainToDemonstrated`** in `daily.ts` (updates `DeclaredInterest` only) from **`feed/[id]/answer`** and **`joshing-game`** submit — **not** `promoteDeclaredToDemonstrated`; **no** `declared_promoted` activity / mastery event in normal flow; **daily** path: N/A for author credit; uses `question.category` which may **not** match string domain row if canonical differs. |
| 6.6 Daily Five declared weight | 🟡 | **`DECLARED_DOMAIN_WEIGHT = 0.5` hardcoded** in `generate-questions.ts`; **no** `process.env.DAILY_FIVE_DECLARED_WEIGHT` / `DEMONSTRATED_WEIGHT`. |
| 6.7 DomainCircle declared styling | 🔴 | **`PortraitCircles.tsx`** has **no** declared/demonstrated/outline distinction (grep). |
| 6.7 Domain detail declared explanation | 🟡 | Badge “Declared Interest” only (`knowledge/[domain]/page.tsx`) — **not** full PRD narrative. |
| 6.8 Ceremony Beat 2 three cases | 🔴 | `compute-beats.ts` `computeBeat2` still **skips all `declaredDomains`** when building “discovered” — no distinct authored-declared / promoted copy. |
| 6.9 Activity `declared_promoted` | 🔴 | **Not** in `ActivityItemType`; insert type-asserted in `open-domain.ts` (**compile error**). |

---

## Section 7 — Prompt 10.3: Onboarding Cultural Anchor

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 7.1 User schema columns | ✅ | `birthYear`, `grewUpCountry`, `grewUpRegion` on `User`. |
| 7.2 `proposeInterests` + cultural anchor | ✅ | `interests.ts` accepts `culturalAnchor`, `buildCulturalAnchorPrompt`, 10–14 candidates in prompt rules. |
| 7.3 propose-interests API validation + save before LLM | ✅ | Validates anchor; `updateUser` with anchor fields **before** `proposeInterests`. |
| **7.3 Client wiring** | 🔴 | `OnboardingFlow.generateProposals` sends **`demographicContext`**, not **`culturalAnchor`**. Server ignores it → **anchor never saved at propose time**; LLM never receives cultural signal from onboarding. |
| 7.4 Cultural step UI | 🟡 | Step `'background'` between welcome and warm-up with year input + country `<select>` + US states — **not** a searchable country control; birth year max **2010** in UI vs API **currentYear − 13** (2013 for 2026). |
| 7.5 Warmup three fields | ✅ | `WARMUP_FIELDS`: deepDive, hourLongTopic, anythingElse optional. |
| 7.5 Validation to continue | 🔴 | `canGenerate` references **`warmupAnswers.bookComposerFilmmaker`** (removed field) — **always false**; **TS2339**. Users cannot pass warm-up gate without fix. |
| 7.6 `countries.ts` / `us-regions.ts` | ✅ | Present with ISO list / states. |
| 7.7 Existing users | ✅ | `src/proxy.ts` gates incomplete onboarding; complete users skip `/onboarding`. |

---

## Section 8 — Prompt 10.4: Joshing Commentary

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 8.1 Schema `quip` on answer tables | 🔴 | **No** `quip` on `JoshingGameResponse` or dedicated `daily_answers` table; daily state is JSON in `DailyQueue.slots` (`reveal_quip` / `quip` fields in slot type — **not** normalized column). |
| 8.2 `select-quip.ts` + six banks | 🔴 | **`selectQuip`** lives in **`src/server/grading.ts`** — inline arrays, not separate file/banks; **no `{name}` substitution**; word caps **not** enforced in code or tests. |
| 8.3 Endpoints call + persist + return | 🟡 | Daily/feed return `quip` in JSON; slot stores `quip` for daily; **joshing** returns `quip` from `selectQuip` **without persisting** to `JoshingGameResponse`; **catchup** returns `quip: grade.consolation` (**not** `selectQuip`). |
| 8.4 GameplayChat quip | 🟡 | Renders `text-sm text-muted-foreground italic` under bubble — **no** 150ms delay; **order**: result block → **quip** → domain exclusion / reaction; **breadcrumb** is **after** `ResultRow` (sibling), i.e. **result → quip → breadcrumb** (⚠️ vs spec **result → breadcrumb → quip**). |
| 8.5 `select-interpretive-line.ts` | 🔴 | **Does not exist** — logic **inlined** in `daily/summary/page.tsx` `interpretiveLine()` (~7 cases + null). |
| 8.6 Summary session close | 🟡 | `InterpretiveLine` uses **300ms** delay + opacity transition; placed after `MasteryMoment` block, not strictly directly under score line only. |
| 8.7 Tests | 🔴 | **`src/server/grading/select-quip.test.ts`** **missing**. |

---

## Section 9 — PRD v11.1 Cross-Cutting

| Item | Status | Notes |
|------|--------|------|
| 9.1 Killed: broadcast toggle | ✅ | Absent. |
| 9.1 Killed: `authored_shared` FeedList | ✅ | Filtered + cleanup script. |
| 9.1 Spider graph on Knowledge | ✅ | **No** spider graph; portrait + progression views only. |
| 9.1 Streak on Knowledge | ✅ | No 🔥 streak UI found on `knowledge/page.tsx`. |
| 9.1 "Your Declared Interests" dedicated section | 🟡 | Interests managed via modals / `declaredInterests` API — **no** standalone titled section like PRD wording; interest modal copy references “declared interests”. |
| 9.2 "Grow your map" | ✅ | Two buttons (send / write). |
| 9.2 "Manage interests" in Account | ✅ | Link to `/knowledge?interests=manage`. |
| 9.2 Hidden domains section | 🟡 | Present under different labeling (see 5.9). |
| 9.3 Circle sizing | ✅ | `circle-sizing.ts` tier-anchored ranges; used from portrait circles. |
| 9.4 Joshing POST friends | ✅ | `joshing-games/route.ts` validates recipients ∈ `getFriends()`. |
| 9.4 `/api/users` friends only | ✅ | `getFriends` only. |
| 9.4 `/api/questions/send` friend validation | 🔴 | **No** `getFriends` check — only recipient user exists + rate limits. |
| 9.5 SMS `friend_answered_question` | 🔴 | Enum value in schema **only** — **no** `sendSms(..., 'friend_answered_question')` in `src/`. |
| 9.6 OTP `000000` | ⚠️ | `otp-store.ts` accepts `000000` unconditionally. |
| 9.6 `/feed` = FeedList | ✅ | `feed/page.tsx` imports `FeedList`. |
| 9.6 Vercel cron | ✅ | `vercel.json`: daily-assignments `0 6 * * *`, biweekly-ceremony `0 8 * * *`. |
| 9.6 `env-check.ts` Twilio | ✅ | Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`. |

---

## Section 10 — Schema Snapshot

**Drizzle models in `schema.ts` (32 `pgTable` exports):**  
`User`, `UserSession`, `OtpCode`, `Question`, `QuestionAudienceTag`, `UserQuestionBank`, `PLAYER_MASTERY`, `MASTERY_EVENTS`, `QuestionReaction`, `CreatorNote`, `GradeDispute`, `SmsLog`, `GeneratedQuestion`, `QuestionFeedback`, `QuestionRating`, `DailyQueue`, `DailyPreference`, `SkippedDailyQuestion`, `USER_DOMAIN_DIFFICULTY`, `USER_DOMAIN_EXCLUSIONS`, `PROFILE_DOMAIN_VISIBILITY`, `DeclaredInterest`, `Friendship`, `JoshingGame`, `FeedItem`, `JoshingGameRecipient`, `JoshingGameQuestion`, `JoshingGameResponse`, `BiweeklyCeremony`, `ActivityItem`, `FeedDismissedDomain`, `FriendInvitation`.

**Required v11.1 additions (PRD checklist):**

| Requirement | Status |
|-------------|--------|
| `User.birthYear`, `grewUpCountry`, `grewUpRegion` | **PRESENT** |
| `FeedItem.source_result`, `source_user_id` | **PRESENT** (as `sourceResult` text, `sourceUserId`) |
| `Question.surface_priority_score` | **PRESENT** |
| `dismissed_domains` | **MISSING** as named table — **`FeedDismissedDomain`** implements role |
| `PLAYER_MASTERY.territoryType` | **MISSING** — territory on **`DeclaredInterest`** instead |
| `quip` on persistent answer rows | **MISSING** (daily in-queue JSON only; joshing row has no `quip`) |

**Extra / legacy (not exhaustive):** e.g. `QuestionAudienceTag`, `USER_DOMAIN_DIFFICULTY`, `USER_DOMAIN_EXCLUSIONS`, `PROFILE_DOMAIN_VISIBILITY`, `GradeDispute`, `SkippedDailyQuestion`, etc.

---

## Section 11 — Route Inventory (high level)

**Page:** `/feed` → `FeedList` ✅ (`src/app/feed/page.tsx`).

**API routes** — every `src/app/api/**/route.ts` exports at least the methods found by static scan (abbreviated list; full set is grep-complete in workspace):

- Auth: `auth/request-otp` POST; `auth/verify-otp` POST; `auth/me` GET; `auth/logout` POST  
- Account: `account` GET/PATCH; `account/logout` POST; `account/adaptive-level` GET  
- Onboarding: `onboarding/propose-interests` POST; `onboarding/save-interests` POST; `onboarding/canonicalize` POST  
- Daily: `daily/queue` GET/POST; `daily/status` GET; `daily/answer` POST; `daily/skip` POST; `daily/summary` GET; `daily/reset` POST; `daily/preferences` GET/PATCH; `daily/feedback` POST; `daily/catchup` GET; `daily/catchup/answer` POST; `daily/catchup/dismiss` POST  
- Feed: `feed` GET; `feed/[feedItemId]/answer` POST; `feed/[feedItemId]/state` PATCH; `feed/[feedItemId]/thumbsup` POST; `feed/[feedItemId]/thumbsdown` POST/DELETE; `feed/dismiss-domain` POST/DELETE; `feed/dismissed-domains` GET  
- Questions: `questions` GET/POST; `questions/[id]` GET/PATCH/DELETE; `questions/[id]/rating` GET/POST; `questions/send` POST; `questions/suggest` POST; `questions/suggest-answer` POST  
- Joshing: `joshing-games` POST; `joshing-games/[id]` GET; `joshing-games/[id]/answer` POST  
- Knowledge: `knowledge` GET; `knowledge/[domain]` GET/PATCH; `knowledge/tidy` POST  
- Social: `users` GET; `reactions` GET/POST; `reactions/[id]/reply` POST; `declared-interests` GET/PATCH; `friend_invitations` (if present — not in grep snippet; verify if added)  
- … plus `activities`, `bank`, `archive`, `ceremony/*`, `creator-notes/*`, `cron/*`, `replay/*`, `share/*`, etc.

**Expected wiring:** `createFeedItemsForFriendsFromAnswer` + `selectQuip` on answer routes — **see Sections 5 and 8** for gaps (daily ID mismatch, catchup quip, joshing persist).

---

## Section 12 — End-to-End Flows (code trace)

| Journey | Verdict | blocking / notes |
|---------|---------|------------------|
| 12.1 New user onboarding 10.3 | **BROKEN AT warm-up → suggestions** | `canGenerate` / wrong payload key `demographicContext`; tsc error `bookComposerFilmmaker`. |
| 12.2 Authorship opens declared | **PARTIAL** | `openKBDomain` fires; toast does not mention declared territory; UI doesn’t show outlined declared circles. |
| 12.3 Friend-answered propagation | **PARTIAL** | Works for **canonical `Question`** IDs; **broken for Daily/catchup** generated IDs. |
| 12.4 Declared → demonstrated + activity | **BROKEN / PARTIAL** | `upgradeKBDomainToDemonstrated` only; no `declared_promoted` activity union / events as specified. |
| 12.5 Quip E2E | **PARTIAL** | Returned on several paths; ordering and persistence incomplete; catchup uses consolation. |
| 12.6 Interpretive line | **COMPLETE** (logic) | In `daily/summary/page.tsx`; no shared module. |
| 12.7 Domain reconciliation 9.1 | **PARTIAL** | Daily generation ✅; authored creation ❌; onboarding interest generation currently broken. |
| 12.8 Hidden domains | **PARTIAL** | POST + Knowledge re-open ✅; no “Re-opened” toast; GET on alternate path. |

---

## Section 13 — TODO / markers (`src/`)

| Category | File | Line | Text |
|----------|------|------|------|
| Friend / profile | `server/db/queries/joshing-game.ts` | 506 | `TODO Phase 8: replace with getFriends() when friend system is built.` |
| Friend / activity | `server/mastery/write-mastery-event.ts` | 57 | `TODO Phase 8: write friend_mastery activity...` |
| Legacy group | `server/sms.ts` | 155 | `TODO v11.0: group member lookup needs new data source` |
| Legacy group | `server/mastery/season-snapshot.ts` | 32 | `TODO v11.0: "GroupMember" raw SQL table...` |
| Legacy group | `lib/games/winner.ts` | 40–42 | `TODO v11.0: group member/group/game_id...` |
| Profile porting | `server/profile/*.ts`, `lib/knowledge-card.ts` | multiple | `TODO Phase 8: port to Drizzle when friend profiles are built` |

_No matches for `TODO R1/R2/R3`, `TODO v11.1`, `FIXME`, `XXX`, or `HACK` in the scanned grep set._

---

## Section 14 — Top Risks

**Top 5 MISSING (v11.1):**

1. Onboarding → `propose-interests` **cultural anchor payload** + **`canGenerate` bug** — onboarding effectively blocked / anchor never persisted.  
2. **Daily/catchup friend feed propagation** (wrong `questionId` vs FK).  
3. **`promoteDeclaredToDemonstrated` / `declared_promoted` activity** — not wired; type broken.  
4. **PRD quip module** (`select-quip.ts`, banks, `{name}`, tests, persistence on joshing rows).  
5. **Friend validation on `/api/questions/send`**, **SMS `friend_answered_question`**, **partial unique on dismissed domains**.

**Top 5 PARTIAL / DIVERGENT (most concerning):**

1. **Territory model** on `DeclaredInterest` vs **PRD `PlayerMastery.territoryType`**.  
2. **Ceremony Beat 2** still excludes declared territory story.  
3. **GameplayChat** bubble order vs PRD (breadcrumb vs quip).  
4. **Dismiss-domain GET** split across two routes.  
5. **Promotion** uses `question.category` not canonical domain string — silent mismatches.

**Top 5 “prompt sequence short-circuited” signals:**

1. Onboarding client/server contract drift (`demographicContext`).  
2. `bookComposerFilmmaker` leftover vs `deepDive` rename.  
3. `declared_promoted` half-added (runtime try/catch hides failure).  
4. `createFeedItemsForFriendsFromAnswer` named differently and Daily IDs never validated against FK.  
5. Quip work folded into `grading.ts` without test enforcement.

**Top 5 production vs PRD intent risks:**

1. **Feed propagation volume** from every answer (correct + incorrect) — may exceed intended “signal” cadence.  
2. **OTP master code** `000000` in production.  
3. **Declared weight** not tunable via env (hardcoded 0.5).  
4. **Domain dismiss** mismatch when `canonicalSubcategory` null on questions.  
5. **html2canvas** / build fragility blocking deploy.

---

## Section 15 — Verdict

**Conformance estimate:** Roughly **55–65%** of v11.1 *intent* is reflected in working code paths: friend graph, feed UX, propagation for real `Question` rows, dismiss domains, thumbs routing, granular prompts + merge backfill, and account/knowledge entry points are largely present. **Onboarding 10.3**, **Daily propagation**, **declared promotion + ceremony/activity**, and **commentary/quip spec** are the largest deltas.

**Alpha blockers:** TypeScript **does not pass**; **production build failed** in this audit (`html2canvas` resolution). New-user onboarding **cannot reach interest proposals** until **`WarmupAnswers` gate** and **API body shape** are fixed. Daily Five **does not propagate** to friends’ feeds due to **FK**. Together these mean you cannot honestly run a 3–5 user alpha **using the PRD’s full journey**.

**Smallest fix set for a credible alpha of the *social model*:** (1) fix onboarding `canGenerate` + send `culturalAnchor` to match `propose-interests`; (2) fix Daily/catchup propagation to use a real `Question` id or relax FK with a deliberate design; (3) repair `ActivityItemType` + either wire `promoteDeclaredToDemonstrated` or drop dead code; (4) restore `tsc` clean + `next build` (dependencies).  

**What is solid:** Feed list UX (empty states, dismiss domain, thumbs-down confirmation, friend-answered attribution), `createFeedItemsForFriendsFromAnswer` for **non-daily** surfaces, SMS enum extension scaffolding, Drizzle schema breadth, reconciliation + aggressive backfill machinery, weighted declared sampling (conceptually), and `/feed` page wiring.

---

## Section 16 — Recommended Next Actions

1. **[Critical — small]** Fix `OnboardingFlow.tsx`: `canGenerate` → use `deepDive` + `hourLongTopic`; POST body → `{ culturalAnchor: { birthYear, grewUpCountry, grewUpRegion } }` per API. *(Prompt 10.3 + hotfix)*  
2. **[Critical — medium]** Daily/catchup propagation: resolve **Question FK** (e.g. ensure `FeedItem.questionId` references a persisted `Question`, or migrate schema to allow generated IDs intentionally). *(Prompt 10.1)*  
3. **[Critical — small]** Extend `ActivityItemType` with `'declared_promoted'` **or** remove broken insert; call **`promoteDeclaredToDemonstrated`** from feed/joshing answer paths if PRD events are required. *(Prompt 10.2)*  

4. **[Important — medium]** `/api/questions/send`: validate `recipientUserId` ∈ friends. *(PRD § friend graph)*  
5. **[Important — small]** Add partial unique index on active dismiss rows; align `GET` listing with PRD path or document split.  
6. **[Important — medium]** Extract `select-quip` to module, add `{name}` + ≤8-word guard + tests; align catchup with `selectQuip`. *(10.4)*  
7. **[Important — small]** GameplayChat order + optional 150ms quip delay per PRD.

8. **[Nice — medium]** Env-loaded `DAILY_FIVE_DECLARED_WEIGHT` / `DEMONSTRATED_WEIGHT`.  
9. **[Nice — large]** Ceremony Beat 2 narratives for declared vs demonstrated.  
10. **[Nice — medium]** Visual declared territory on portrait + domain detail copy.  
11. **[Nice — small]** OTP dev gate (`NODE_ENV` / allowlist) instead of bare `000000`.

---

*End of audit — generated from static analysis of the repo at audit time.*
