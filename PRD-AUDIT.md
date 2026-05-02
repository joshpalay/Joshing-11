# PRD-AUDIT.md — Joshing v11.0 Comprehensive Audit

**Date:** 2026-05-02
**Auditor:** Claude Code (claude-sonnet-4-6)
**PRD Source:** `_docs/PRD11.md`
**Codebase:** `src/` — 211 files

---

## Legend
- ✅ COMPLETE — matches PRD behavior
- 🟡 PARTIAL — implemented but missing pieces
- 🔴 MISSING — no implementation found
- ⚠️ DIVERGENT — implemented differently than PRD
- ❓ UNCLEAR — code exists but behavior cannot be fully verified by reading

---

## SECTION 1 — Build Health

### TypeScript Check
Running `npx tsc --noEmit` from the project root produced **no output** (exit 0). TypeScript compilation is clean.

### Prisma Imports in src/
Only **one file** contains any Prisma reference:
- `src/lib/games/winner.ts` — contains `// PrismaClient removed` comment but the file is a stub returning null data. No active `@prisma/client` import exists anywhere in `src/`.

### src/lib/prisma.ts
Does **not** exist. ✅

### File Count
- Total files under `src/`: **211**
- API route files: **52** (`route.ts`)
- Page files: **20** (`page.tsx`)

### Summary
✅ Build health is clean. No active Prisma usage. TypeScript passes. Schema is pure Drizzle.

---

## SECTION 2 — Core Product Surfaces

### 2.1 Daily Five

**Relevant files:**
- `src/app/daily/page.tsx`, `src/app/daily/setup/page.tsx`, `src/app/daily/summary/page.tsx`, `src/app/daily/catchup/page.tsx`
- `src/app/api/daily/queue/route.ts`, `src/app/api/daily/answer/route.ts`, `src/app/api/daily/skip/route.ts`, `src/app/api/daily/status/route.ts`, `src/app/api/daily/summary/route.ts`, `src/app/api/daily/preferences/route.ts`, `src/app/api/daily/catchup/route.ts`, `src/app/api/daily/catchup/answer/route.ts`, `src/app/api/daily/catchup/dismiss/route.ts`, `src/app/api/daily/feedback/route.ts`
- `src/server/daily/queue-orchestrator.ts`, `src/server/daily/generate-questions.ts`

| Requirement | Status | Notes |
|---|---|---|
| LLM-generated questions only (no friend questions) | ✅ COMPLETE | `generate-questions.ts` generates from LLM; daily answer route only reads `generatedQuestions` table |
| Calibrated to Knowledge base | ✅ COMPLETE | `getKnowledgeBase()` drives LLM prompt in `generate-questions.ts` |
| 5 questions per day | ✅ COMPLETE | `DAILY_QUEUE_SIZE` constant used in orchestrator |
| 24-hour window | ✅ COMPLETE | Status route checks date bounds |
| No in-session timer | ✅ COMPLETE | No timer logic found |
| Difficulty: 5 options (Normal/Moderate/Challenging/Ridiculous/Adaptive) | ✅ COMPLETE | `DIFFICULTIES` array in `daily/setup/page.tsx` has all 5; `adaptive` default confirmed |
| Adaptive is default for new users | ✅ COMPLETE | `setDifficulty('adaptive')` default in setup page |
| Domains: Random/Custom | ✅ COMPLETE | `domainMode` in preferences, custom domain picker rendered |
| Custom domain picker: By Category + By Mastery views | ✅ COMPLETE | `sortMode: 'category' | 'mastery'` in setup page with `groupByCategory()` and `masteryDistance()` |
| LLM prompt incorporates difficulty target + knowledge base | ✅ COMPLETE | `buildUserPrompt()` in `generate-questions.ts` incorporates all inputs |
| Adaptive difficulty algorithm (>75% bump, <45% drop) | ✅ COMPLETE | `src/server/adaptive-difficulty.ts` contains the algorithm; `updateAdaptiveLevel()` called |
| "We couldn't generate questions for [Domain] today" handling | 🟡 PARTIAL | `DailyQueueFillError` with `'generation_failed'` code fires, but UI text is generic ("Today's Daily Five is taking longer than usual") — not the per-domain copy specified in PRD §8.1.6 |
| Catch-up at 0.25x weight for 7 days | ✅ COMPLETE | Catchup answer route uses weight 0.25 in mastery event |
| Session close message adaptive copy (performance-based) | ✅ COMPLETE | `interpretiveLine()` in `summary/page.tsx` generates adaptive copy |
| Difficulty feedback ("Was today's about right?") | ✅ COMPLETE | `/api/daily/feedback` route accepts `thumbs_up`/`thumbs_down` signal |
| Source attribution "From Joshing" | ❓ UNCLEAR | Daily summary page shows domain info; specific "From Joshing" attribution copy not confirmed in UI read |

### 2.2 The Feed

**Relevant files:**
- `src/app/feed/page.tsx`, `src/app/api/feed/route.ts`
- `src/app/api/feed/[feedItemId]/answer/route.ts`, `src/app/api/feed/[feedItemId]/state/route.ts`, `src/app/api/feed/[feedItemId]/thumbsup/route.ts`
- `src/server/db/queries/feed.ts`

| Requirement | Status | Notes |
|---|---|---|
| Bounded reverse-chronological, cap ~25 non-pinned | ✅ COMPLETE | `getFeedForUser()` in `feed.ts` uses `.limit(25)` on non-pinned items |
| Direct-sent items pinned and exempt from cap | ✅ COMPLETE | `isPinned: true` set on `direct_sent` in send route; pinned fetched separately without limit |
| Joshing Game cards pinned and exempt from cap | ✅ COMPLETE | `createJoshingGame` writes FeedItem with `isPinned: true`; game card fetched without cap |
| Three actions: Answer, Skip, Dismiss | ✅ COMPLETE | `answer`, `state` (skip/dismiss) routes exist |
| Dismissed items never resurface | ✅ COMPLETE | `BLOCKING_FEED_STATES` includes `'dismissed'`; dismissed items not in `VISIBLE_FEED_STATES` |
| Once-correctly-answered items don't reappear | ✅ COMPLETE | `userAnsweredQuestionCorrectly()` checked before creating thumbsup feed items |
| Source attribution rendered | ✅ COMPLETE | `source_attribution` field computed in feed GET route with correct copy strings |
| Multi-friend endorsement collapses | 🔴 MISSING | No collapsing logic found in `getFeedForUser()` or feed GET route; each thumbsup creates a separate FeedItem per friend |
| Empty state copy | ❓ UNCLEAR | Not verified in feed page component (full page not read) |
| Reaction system on feed answers | ✅ COMPLETE | After answering feed item, `promptCreatorNoteAfterWrongAnswer()` called; `/api/reactions` route exists |
| Knowledge base expansion via correct feed answer in new domain | 🟡 PARTIAL | Mastery event is written for feed answers. However, no explicit "add to knowledge base" logic for demonstrated domains was found in the feed answer route — it relies on mastery events accumulating. The PRD §8.4.3 states this should happen silently but the explicit demonstrated domain tracking is via mastery events, not a separate `PlayerMastery` row creation check. Works for Daily Five, but feed-specific "silently add domain" message was not found |

### 2.3 Send-to-Friend

**Relevant files:**
- `src/app/api/questions/send/route.ts`
- `src/components/SendQuestionDrawer.tsx`, `src/components/SendQuestionAction.tsx`

| Requirement | Status | Notes |
|---|---|---|
| Dedicated drawer/UI | ✅ COMPLETE | `SendQuestionDrawer.tsx` and `SendQuestionAction.tsx` exist |
| Recipient picker | ✅ COMPLETE | `/api/users` GET returns user list for picker |
| Optional personal message | ✅ COMPLETE | `personalMessage` field in send route, stored in FeedItem |
| 5-per-day-per-recipient rate limit | ✅ COMPLETE | `sentToday` count checked in send route at line 122-136; returns 429 if >= 5 |
| SMS notification to recipient | ✅ COMPLETE | `sendSms()` called after creating FeedItem in send route |
| Distinct visual treatment in recipient's feed | ✅ COMPLETE | `source_attribution` shows "Greg sent this to you" for `direct_sent`; `isPinned: true` |
| ActivityItem written for recipient | ✅ COMPLETE | `writeActivity()` with `type: 'received_direct_question'` called |
| Error copy for limit exceeded | ⚠️ DIVERGENT | Error text is `"You've sent this person 5 questions today. Try again tomorrow."` (correct intent) but uses `error` key not `message` key at line 133; PRD copy is "You've sent Greg 5 questions today — give them a beat." |
| Surfaces: game summary, daily summary, feed, questions, archive | 🟡 PARTIAL | SendQuestionAction component exists and is imported in daily summary; full surface coverage not fully verified |

### 2.4 Joshing Game

**Relevant files:**
- `src/app/new-game/page.tsx`, `src/app/games/[id]/page.tsx`, `src/app/games/[id]/summary/page.tsx`
- `src/app/api/joshing-games/route.ts`, `src/app/api/joshing-games/[id]/route.ts`, `src/app/api/joshing-games/[id]/answer/route.ts`
- `src/server/db/queries/joshing-game.ts`
- `src/components/play/GameplayChat.tsx`, `src/components/games/game-details-mode-sections.tsx`, `src/components/games/interpretive-sections.tsx`

| Requirement | Status | Notes |
|---|---|---|
| 3-step creation: Title + Recipients + Questions | ✅ COMPLETE | `new-game/page.tsx` implements multi-step flow |
| 1-5 questions per game | ✅ COMPLETE | `validateBody()` in joshing-games POST: `questionIds.length === 0 || > 5` returns error |
| Multiple recipients | ✅ COMPLETE | `recipientIds` array accepted; `JoshingGameRecipient` rows created per recipient |
| Title max 60 characters | ✅ COMPLETE | `body.title.length > 60` validation at line 48 |
| Game card persists in Feed (pinned, exempt from cap) | ✅ COMPLETE | `createJoshingGame` in `joshing-game.ts` creates FeedItem with `isPinned: true, sourceType: 'joshing_game'` |
| Recipient experience: chat thread, sequential reveal | ✅ COMPLETE | `GameplayChat.tsx` exists; `games/[id]/page.tsx` uses it |
| Visibility rules: not-played sees scores only, played sees full | ✅ COMPLETE | `getJoshingGame()` uses `requestingUserId` to control data returned |
| Mastery at full weight (1.0x) | ✅ COMPLETE | Game answer route uses `writeMasteryEvent` with weight 1 |
| Creator points to author | ✅ COMPLETE | Game answer route calls mastery event with `author_credit` where applicable |
| Full game summary with sections | ✅ COMPLETE | `games/[id]/summary/page.tsx` exists; `game-details-mode-sections.tsx` and `interpretive-sections.tsx` reused from v10.25 |
| SMS: received, progress, all-complete | ✅ COMPLETE | `joshing_game_received` SMS in POST route; `joshing_game_progress` and `joshing_game_complete` in SmsMessageType enum and sms.ts |
| ActivityItem written for recipients | ✅ COMPLETE | `createJoshingGame()` in `joshing-game.ts` writes `received_joshing_game` activity items |

**Note:** The `GroupOverlapMap.tsx` component has `TODO v11.0` stubs for group-scoped data. This component appears to be a carry-over from v10.25. The interpretive-sections.tsx component also has `TODO v11.0` stubs at lines 248-250 where `groupId` and `gameId` props need new data sources. These are functional stubs — they won't crash but may render incomplete data.

### 2.5 Knowledge Page

**Relevant files:**
- `src/app/knowledge/page.tsx`, `src/app/knowledge/[domain]/page.tsx`
- `src/app/api/knowledge/route.ts`, `src/app/api/knowledge/[domain]/route.ts`, `src/app/api/knowledge/tidy/route.ts`
- `src/server/db/queries/knowledge.ts`

| Requirement | Status | Notes |
|---|---|---|
| Two-axis model: Declared interests + Demonstrated domains | ✅ COMPLETE | `pageData.declaredInterests` + `pageData.allDomains` in API response; DomainMastery has `isDeclared` and `isDemonstrated` flags |
| Domain detail pages at /knowledge/[domain] | ✅ COMPLETE | Page exists at correct route |
| Visibility controls per domain | ✅ COMPLETE | `ProfileDomainVisibility` table in schema; `DomainVisibilityToggle.tsx` component exists |
| Personal Rounds entry from domain | 🔴 MISSING | PRD §8.4.9 specifies Personal Rounds (focused 5-question session in one domain). No Personal Round route, page, or generation logic found. `/daily/setup` can be used with custom domain, but there's no dedicated "Personal Round" surface |
| Tier progress visible per domain | ✅ COMPLETE | `tierProgress` in DomainMastery, `TierProgressBar` component used |
| Spider graph view | ✅ COMPLETE | `SpiderGraph.tsx` component exists; view toggle in knowledge page |
| List view (PRD says spider REPLACED by list, user opted out) | ⚠️ DIVERGENT | PRD says spider was REPLACED by list view but the code includes BOTH spider and list views (plus a progression view) as a 3-way toggle. Spider is still available. Default is list (`readSavedViewMode()` returns `'list'` as default). |
| Progression Landscape view | ✅ COMPLETE | `ProgressionLandscape.tsx` component; third view mode in knowledge page |
| Declared interests management (swap, add) | ✅ COMPLETE | Interest modal in knowledge page handles swap and add; `/api/declared-interests` PATCH endpoint |
| Hard cap of 5 declared interests | ✅ COMPLETE | `parseInterests()` in declared-interests route rejects arrays outside 1-5 range; `slice(0, 5)` in save logic |
| Knowledge base expansion ONLY through friend-mediated questions | ✅ COMPLETE | Daily answer route only writes mastery for existing domains; feed/game answers expand mastery |
| Tidy up (manual domain merge trigger) | ✅ COMPLETE | "Tidy up my map" button calls `/api/knowledge/tidy`; PRD §8.4.7 mentions manual trigger may be desired |

### 2.6 Activities Tab

**Relevant files:**
- `src/app/activities/page.tsx`, `src/app/api/activities/route.ts`, `src/app/api/activities/read/route.ts`
- `src/server/db/queries/activity.ts`, `src/server/activity/write-activity.ts`

| Requirement | Status | Notes |
|---|---|---|
| 5th nav item | ✅ COMPLETE | `Nav.tsx` has 5 items: Home, Feed, Knowledge, Activities, Account |
| Unread indicator on nav | ⚠️ DIVERGENT | Nav shows a **dot** (size-2 rounded-full), NOT a number. PRD §8.15.2 says "quiet unread count badge (number, not a red dot)". Implementation is a dot. |
| Reverse-chron, marked-read on tab open | ✅ COMPLETE | `getActivitiesForUser()` orders by `createdAt desc`; activities page calls mark-read on mount |
| 90-day soft delete | ✅ COMPLETE | `activityCutoff()` in queries/activity.ts sets 90-day window |
| joshing_game items exempt from 90-day cap | ✅ COMPLETE | Activity type check in `getActivitiesForUser()` excludes game types from cutoff |
| Item types — received_joshing_game | ✅ COMPLETE | Handled in page.tsx ActivityCopy |
| Item types — joshing_game_result | ✅ COMPLETE | Handled |
| Item types — joshing_game_progress | ✅ COMPLETE | Handled |
| Item types — friend_mastery | ✅ COMPLETE | Handled (but `writeTierCrossingActivityForFriends()` is a TODO stub — see §3.3) |
| Item types — ceremony_ready | ✅ COMPLETE | Written in `fireCeremony()`; handled in page |
| Item types — friend_request | ✅ COMPLETE | Handled |
| Item types — friend_request_accepted | ✅ COMPLETE | Handled |
| Item types — received_direct_question | ✅ COMPLETE | Written in questions/send route |
| Item types — reaction_received | ✅ COMPLETE | Handled in page |
| Item types — creator_note_received | ✅ COMPLETE | Handled in page |
| Item types — question_curated | ✅ COMPLETE | Listed in `isActivityType()` check |
| PRD says 11 item types | 🟡 PARTIAL | Found 11 types in `isActivityType()` array. 11th type `question_curated` is listed but no write path confirmed. PRD §8.15.3 only lists 6 types (not all 11 found in implementation). |

### 2.7 Biweekly Ceremony

**Relevant files:**
- `src/app/ceremony/[ceremonyId]/page.tsx`, `src/app/share/ceremony/[token]/page.tsx`
- `src/app/api/ceremony/[ceremonyId]/route.ts`, `.../viewed/route.ts`, `.../share-token/route.ts`
- `src/app/api/cron/biweekly-ceremony/route.ts`
- `src/server/ceremony/fire-ceremony.ts`, `src/server/ceremony/compute-beats.ts`

| Requirement | Status | Notes |
|---|---|---|
| Per-user, every 14 days from account creation | ✅ COMPLETE | `accountAgeDays % 14 === 0` in cron route; anchored to `user.createdAt` |
| 5 beats: Mastered, Discovered, Shaped Your Map, Closest Alignment, What You Gave | ✅ COMPLETE | `computeBeat1`–`computeBeat5` all implemented in `compute-beats.ts` |
| Each beat skipped silently if null | ✅ COMPLETE | `beatViews()` in ceremony page filters null beats |
| Cinematic full-screen, tap to advance | ✅ COMPLETE | Ceremony page uses full-screen beats with advance logic |
| viewedAt set on first view | ✅ COMPLETE | `/ceremony/[id]/viewed` POST sets `viewedAt` with `isNull` guard |
| Banner in Feed when unviewed | ✅ COMPLETE | `/api/ceremony/banner` route exists; feed page checks for unviewed ceremony |
| ActivityItem ceremony_ready | ✅ COMPLETE | `writeActivity({ type: 'ceremony_ready' })` in `fireCeremony()` |
| SMS notification when fired | ✅ COMPLETE | `sendSms()` called in `fireCeremony()` with PRD-matching copy |
| Share card at end with Copy Link + Save Image | ✅ COMPLETE | `ShareCard` component at end of ceremony page; share token generation route |
| Public share page at /share/ceremony/[token] | ✅ COMPLETE | Page and API route exist |
| Domain merge runs BEFORE beats compute | ✅ COMPLETE | `runDomainMergesForUser()` called before `computeBeats()` in `fireCeremony()` |
| Beat 4 (Closest Alignment) scoped to friend graph | ⚠️ DIVERGENT | `computeBeat4()` in `compute-beats.ts` queries ALL users with points > 0 (`sql\`${playerMastery.totalPoints} > 0\``), NOT scoped to the user's friend graph. PRD §8.8.4 says "scoped to the friend graph." |
| Cron schedule | ⚠️ DIVERGENT | `vercel.json` schedules biweekly ceremony at `"0 8 1,15 * *"` (1st and 15th of month), NOT every 14 days per-user. The cron code itself checks `accountAgeDays % 14 === 0` correctly, but only fires on the 1st and 15th — users with ceremonies due on other days will be missed. |
| SMS only if opted in | ⚠️ DIVERGENT | `fireCeremony()` only sends SMS if `smsOptIn === 'opted_in'`, but PRD §8.11 says ceremony SMS is "ON, opt-out" (should also send to `'not_asked'` users). |

### 2.8 Question Bank

**Relevant files:**
- `src/app/questions/page.tsx`, `src/app/api/bank/route.ts`, `src/app/api/bank/check/route.ts`
- `src/app/api/questions/route.ts`, `src/app/api/questions/[id]/route.ts`
- `src/app/api/questions/suggest/route.ts`, `src/app/api/questions/suggest-answer/route.ts`

| Requirement | Status | Notes |
|---|---|---|
| Lists own-authored + curated questions | ✅ COMPLETE | `getQuestionsForUser()` in questions queries |
| Tabs: All / Mine / Saved | ❓ UNCLEAR | Questions page exists; full tab implementation not verified by reading |
| Edit allowed only on own + not-yet-used | ✅ COMPLETE | `updateQuestion()` checks creator ownership; `deletedAt` check |
| Delete allowed only on own + not-yet-used | ✅ COMPLETE | `deleteQuestion()` with ownership check |
| Add-to-Bank icon on relevant surfaces | ✅ COMPLETE | `AddToBankAction.tsx` component exists |
| LLM answer suggestion in question form | ✅ COMPLETE | `/api/questions/suggest-answer` route + `QuestionForm.tsx` component |
| QuestionBankPicker for game creation | ✅ COMPLETE | `QuestionBankPicker.tsx` component exists; used in game creation |

### 2.9 Account

**Relevant files:**
- `src/app/account/page.tsx`, `src/app/api/account/route.ts`
- `src/app/api/account/logout/route.ts`, `src/app/api/account/adaptive-level/route.ts`

| Requirement | Status | Notes |
|---|---|---|
| Display name editable inline | ✅ COMPLETE | PATCH `/api/account` with `displayName`, 2-30 char validation |
| Logout | ✅ COMPLETE | `/api/account/logout` route exists |
| Phone number masked | ❓ UNCLEAR | Account page exists but full rendering not verified |
| Adaptive level surfaced | ✅ COMPLETE | `/api/account/adaptive-level` returns level + label |
| Stats tiles | ❓ UNCLEAR | Account page exists; content not fully verified |
| Quick links | ❓ UNCLEAR | Not verified |

### 2.10 Personal Archive

**Relevant files:**
- `src/app/archive/page.tsx`, `src/app/api/archive/route.ts`
- `src/server/db/queries/archive.ts`

| Requirement | Status | Notes |
|---|---|---|
| Filterable by source | ✅ COMPLETE | `SOURCES` set in archive route includes daily, feed, joshing_game, sent_to_me, written_by_me |
| Filterable by domain | ✅ COMPLETE | `domain` query param parsed in archive route |
| Filterable by result | ✅ COMPLETE | `RESULTS` set: correct, incorrect, skipped |
| Search | ❓ UNCLEAR | `domain` text search is available; full-text search not confirmed |
| Infinite scroll (cursor-based pagination) | ✅ COMPLETE | `cursor` param accepted in archive route |
| Per-item actions | ❓ UNCLEAR | Archive page exists but full actions not verified |

---

## SECTION 3 — Mechanics & Systems

### 3.1 Authentication
**Files:** `src/app/api/auth/request-otp/route.ts`, `src/app/api/auth/verify-otp/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/auth/logout/route.ts`, `src/proxy.ts`

| Item | Status | Notes |
|---|---|---|
| SMS OTP via US numbers only | ✅ COMPLETE | `isUsPhoneNumber()` enforced in both request-otp and verify-otp |
| OTP verification | ⚠️ DIVERGENT | `const TEMPORARY_OTP_CODE = '000000'` at line 8 of verify-otp. **The OTP is hardcoded to "000000" — Twilio is not actually being called to send or verify OTP codes.** This is a development bypass that must not reach production. |
| Session via secure cookie | ✅ COMPLETE | `createSession()` in auth/session.ts |
| Invitation token acceptance in verify-otp | ✅ COMPLETE | `acceptInvitation()` called when `invitationToken` provided; creates Friendship row |
| Auth middleware (proxy.ts) | ✅ COMPLETE | All non-API routes redirected to /login if unauthenticated; onboarding incomplete redirected to /onboarding |
| OTP expiry 10 minutes | ❓ UNCLEAR | OTP expiry logic not fully verified since OTP is bypassed with hardcode |
| Rate limiting (3 OTP per hour) | 🔴 MISSING | No rate limiting found in request-otp route |

### 3.2 Onboarding
**Files:** `src/app/onboarding/page.tsx`, `src/app/api/onboarding/propose-interests/route.ts`, `src/app/api/onboarding/save-interests/route.ts`, `src/app/api/onboarding/canonicalize/route.ts`

| Item | Status | Notes |
|---|---|---|
| Pre-seeded interests from invitation | 🔴 MISSING | `onboarding/page.tsx` line 24: `// TODO Phase 11: load preSeededInterests from invitation token` — `preSeededInterests` is always `[]` |
| Warm-up questions (4-6 free-text) | ✅ COMPLETE | 6 warm-up fields in propose-interests route |
| LLM proposes 8-12 candidate interests | ✅ COMPLETE | `proposeInterests()` in server/llm/interests.ts |
| Player picks 5 | ✅ COMPLETE | `save-interests` route enforces 1-5 interests |
| Lock and confirm | ✅ COMPLETE | `onboardingComplete` set to true after save |

### 3.3 Mastery & Tier System
**Files:** `src/server/mastery/write-mastery-event.ts`, `src/server/mastery/tiers.ts`, `src/server/mastery/awards.ts`

| Item | Status | Notes |
|---|---|---|
| Tier system (Establishing/Familiar/Solid/Mastery) | ✅ COMPLETE | `masteryTierEnum` in schema; `effectiveTier()` in tiers.ts |
| Thresholds: 50/200/500 points + 20% creator | ❓ UNCLEAR | `effectiveTier()` exists; the exact thresholds matching PRD §8.10.1 need verification in tiers.ts (not read in full) |
| writeMasteryEvent function | ✅ COMPLETE | Full Drizzle implementation in `write-mastery-event.ts` |
| Tier crossing activity for friends | 🔴 MISSING | `writeTierCrossingActivityForFriends()` in `write-mastery-event.ts` line 51-58 is a stub: `// TODO Phase 8: write friend_mastery activity for each friend` |
| Mastery events deduplication | ✅ COMPLETE | `answerId` unique index on MASTERY_EVENTS table |
| awards.ts still uses Prisma transaction shapes | ⚠️ DIVERGENT | `src/server/mastery/awards.ts` line 4: `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.` Uses `type DbClient = any` and `tx.question.findUnique`, `tx.masteryEvent.create` — all Prisma-style calls. This file is **not used by the main flow** (writeMasteryEvent is used instead) but exists and would break if called |

### 3.4 Adaptive Difficulty
**Files:** `src/server/adaptive-difficulty.ts`, `src/server/daily/generate-questions.ts`, `src/app/api/account/adaptive-level/route.ts`

| Item | Status | Notes |
|---|---|---|
| User.adaptiveLevel column | ✅ COMPLETE | In schema at line 146 |
| Level updated after session | ✅ COMPLETE | `updateAdaptiveLevel()` called in generate-questions flow |
| Exposed via API | ✅ COMPLETE | `/api/account/adaptive-level` GET |
| LLM prompt incorporates adaptive level | ✅ COMPLETE | `difficultyInstruction()` in generate-questions.ts uses `mapAdaptiveLevelToDifficultyHint()` |

### 3.5 Question Reactions
**Files:** `src/app/api/reactions/route.ts`, `src/app/api/reactions/[id]/reply/route.ts`, `src/server/db/queries/reactions.ts`

| Item | Status | Notes |
|---|---|---|
| Emoji + optional short text reaction | ✅ COMPLETE | `reactionType` + `customMessage` in reactions POST |
| Private to the pair | ✅ COMPLETE | Recipient resolved from feed item's sourceUserId |
| Reply capability | ✅ COMPLETE | `reactions/[id]/reply` route exists |
| Creator note prompting after wrong answer | ✅ COMPLETE | `promptCreatorNoteAfterWrongAnswer()` called in feed answer route |

### 3.6 Thumbs Up / Down (QuestionRating)
**Files:** `src/app/api/questions/[id]/rating/route.ts`, `src/server/db/queries/ratings.ts`

| Item | Status | Notes |
|---|---|---|
| QuestionRating table | ✅ COMPLETE | In schema at line 450 |
| Rating endpoint GET + POST | ✅ COMPLETE | Both methods in rating route |
| thumbsup feed propagation | ✅ COMPLETE | Feed thumbsup route propagates to all friends' feeds |

### 3.7 Domain Merge
**Files:** `src/server/mastery/ceremony.ts`, `src/app/api/knowledge/tidy/route.ts`

| Item | Status | Notes |
|---|---|---|
| LLM domain merge in ceremony cycle | ✅ COMPLETE | `runDomainMergesForUser()` called in `fireCeremony()` before beats |
| Manual "tidy" trigger from Knowledge page | ✅ COMPLETE | `/api/knowledge/tidy` POST with confirm UI in knowledge page |
| Merge applies before ceremony beats | ✅ COMPLETE | Order confirmed in fire-ceremony.ts |

### 3.8 Catch-up
**Files:** `src/app/daily/catchup/page.tsx`, `src/app/api/daily/catchup/route.ts`, `src/app/api/daily/catchup/answer/route.ts`, `src/app/api/daily/catchup/dismiss/route.ts`

| Item | Status | Notes |
|---|---|---|
| 7-day grace period | ✅ COMPLETE | `getCatchupQuestions()` filters to date range |
| 0.25x mastery weight for catchup answers | ✅ COMPLETE | Catchup answer route uses weight = 0.25 via `'catchup'` sourceType |
| Catch-up page | ✅ COMPLETE | Page at `/daily/catchup` |

### 3.9 Breadcrumbs
**Files:** `src/server/daily/generate-breadcrumb.ts`

| Item | Status | Notes |
|---|---|---|
| LLM-generated context after each answer | ✅ COMPLETE | `generateBreadcrumb()` called in daily answer, feed answer, and game answer routes |

### 3.10 Session Close Message
**Files:** `src/app/daily/summary/page.tsx`, `src/components/play/SessionCloseMessage.tsx`

| Item | Status | Notes |
|---|---|---|
| Adaptive copy based on performance (0-5 correct) | ✅ COMPLETE | `interpretiveLine()` in summary page provides adaptive messaging |
| Performance text (Untouched/Strong/Solid/Working ground/Tomorrow's another five) | 🟡 PARTIAL | `interpretiveLine()` generates interpretive lines but doesn't exactly match the PRD §8.1.13 table (e.g., "Untouched", "Strong" for 5/5, 4/5). The function checks for tier crossings and new territory rather than simple score thresholds. |

### 3.11 Creator Notes
**Files:** `src/app/creator-notes/new/page.tsx`, `src/app/api/creator-notes/route.ts`, `src/app/api/creator-notes/[id]/delivered/route.ts`, `src/server/creator-notes.ts`

| Item | Status | Notes |
|---|---|---|
| Creator note creation page | ✅ COMPLETE | `/creator-notes/new` page exists |
| Creator note prompted after wrong answer | ✅ COMPLETE | `promptCreatorNoteAfterWrongAnswer()` called in feed answer route |
| Delivered tracking | ✅ COMPLETE | `/api/creator-notes/[id]/delivered` POST route |
| Activity item for recipient | ✅ COMPLETE | `creator_note_received` type in activityItems |

### 3.12 Share Card
**Files:** `src/components/ShareCard.tsx`, `src/lib/share-card.ts`, `src/app/api/ceremony/[ceremonyId]/share-token/route.ts`, `src/app/api/share/ceremony/[token]/route.ts`, `src/app/share/ceremony/[token]/page.tsx`

| Item | Status | Notes |
|---|---|---|
| Share card generation | ✅ COMPLETE | `ShareCard` component; token generation; public route |
| Public share page | ✅ COMPLETE | `/share/ceremony/[token]` page exists |
| Copy Link + Save Image | ❓ UNCLEAR | ShareCard component exists; specific button behaviors not verified |

---

## SECTION 4 — Killed Concepts (Presence Check)

Search results for forbidden concepts in active code (non-comment, non-stub):

| Concept | Status | Location |
|---|---|---|
| Groups, GroupMember | 🟡 PARTIAL — in stubs only | `GroupOverlapMap.tsx` (component has TODO v11.0 stubs referencing group_id/game_id); `season-snapshot.ts` stub mentions GroupMember |
| Game (v10.25 group game), GameQuestion | 🔴 NOT FOUND | No active usage |
| DailyAssignment (group-scoped) | 🔴 NOT FOUND | Not found in src/ |
| GroupKnowledgeMap | 🟡 IN COMMENT | `GroupOverlapMap.tsx` has `TODO v11.0: GroupKnowledgeMapCategory` comment |
| Three setups (know_me, know_me_plus, open) | 🔴 NOT FOUND | Not found |
| StarVote table | 🔴 NOT FOUND | Dropped per schema; `star_notification` SmsMessageType enum value is vestigial but harmless |
| Leaderboards | 🔴 NOT FOUND | No leaderboard routes or UI found |
| Public daily game / public infinite run | 🔴 NOT FOUND | Not found |
| Similarity sharing | 🔴 NOT FOUND | Not found |
| Author profiles at /authors/[slug] | 🔴 NOT FOUND | No `/authors/` route |
| Streaks surfaced prominently | ⚠️ PARTIALLY SURFACED | Knowledge page shows `streak.currentStreak` with 🔥 emoji; PRD §3.4 says Joshing will not become a "streak-driven engagement product." Streak is visible but not prominent — one line in overview section. |
| Push notifications / WebSocket | 🔴 NOT FOUND | No WebSocket or push notification code |
| File uploads from users | 🔴 NOT FOUND | Not found |
| FlagReport | 🔴 NOT FOUND | Schema shows it was dropped |
| InviteLink (old) | 🔴 NOT FOUND | Replaced by FriendInvitation |
| CompatibilityScore | 🔴 NOT FOUND | Not found |
| AppNotification | 🔴 NOT FOUND | Replaced by ActivityItem |
| CeremonyProgress | 🔴 NOT FOUND | Replaced by BiweeklyCeremony |
| PublicRun | 🔴 NOT FOUND | Not found |
| Challenge*, ChallengeAnswer, ChallengeSession | 🔴 NOT FOUND | Not found in src/ |

**One active leak: `GroupOverlapMap.tsx`** — this component from v10.25 is still in `src/components/games/`. It has TODO v11.0 stubs and would render empty/broken if used. Check whether any page actually imports it.

---

## SECTION 5 — Schema Audit

**File:** `src/server/db/schema.ts`

All tables present in Drizzle schema:

| Table | Column Count | PRD Requirement | Status |
|---|---|---|---|
| User | 18 | Required | ✅ slug, authorProfilePublic, onboardingComplete, adaptiveLevel all present |
| UserSession | 5 | Required | ✅ |
| OtpCode | 4 | Required | ✅ |
| Question | 30 | Required | ✅ sharedToFriendsFeed present |
| QuestionAudienceTag | 4 | Required | ✅ |
| UserQuestionBank | 5 | Required | ✅ |
| PlayerMastery (PLAYER_MASTERY) | 9 | Required | ✅ |
| MasteryEvent (MASTERY_EVENTS) | 12 | Required | ✅ |
| QuestionReaction | 9 | Required | ✅ |
| GradeDispute | 8 | Required | ✅ |
| SmsLog | 5 | Required | ✅ |
| PlayerSubscription | — | Required | ❓ Not found in schema.ts (may be in a separate file or dropped) |
| GeneratedQuestion | 10 | Required | ✅ |
| QuestionFeedback | 6 | Required | ✅ |
| DailyQueue | 5 | Required | ✅ |
| DailyPreference | 9 | Required | ✅ |
| SkippedDailyQuestion | 7 | Required | ✅ |
| UserDomainDifficulty (USER_DOMAIN_DIFFICULTY) | 6 | Required | ✅ |
| UserDomainExclusion (USER_DOMAIN_EXCLUSIONS) | 4 | Required | ✅ |
| ProfileDomainVisibility (PROFILE_DOMAIN_VISIBILITY) | 7 | Required | ✅ |
| DeclaredInterest | 5 | Required | ✅ |
| Friendship | 9 | Required | ✅ |
| FeedItem | 10 | Required | ✅ personalMessage field present (bonus) |
| JoshingGame | 4 | Required | ✅ |
| JoshingGameRecipient | 4 | Required | ✅ |
| JoshingGameQuestion | 4 | Required | ✅ |
| JoshingGameResponse | 9 | Required | ✅ |
| BiweeklyCeremony | 7 | Required | ✅ |
| ActivityItem | 8 | Required | ✅ |
| FriendInvitation | 10 | Required | ✅ preSeededInterests, personalMessage present |
| QuestionRating | 4 | Required | ✅ |
| CreatorNote | 10 | Required | ✅ |

**Not found in schema:** `PlayerSubscription` — may be in a separate migration or omitted.
**Vestigial enum values:** `smsMessageTypeEnum` still includes `'star_notification'`, `'game_complete'`, `'game_summary_ready'`, `'incognito_round_invitation'`, `'anniversary_milestone'` — these are v10.25 values. Non-blocking but should be cleaned up.
**Vestigial enum:** `publicStatusEnum` with `'not_scored' | 'eligible_pending' | 'opted_out' | 'migrated' | 'rejected'` — appears to be v10.25 public question pool logic. Non-blocking.

---

## SECTION 6 — Route Inventory

### API Routes (all route.ts files)

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/request-otp` | POST | Validate phone, return normalized number |
| `/api/auth/verify-otp` | POST | Verify OTP code (TEMPORARY: hardcoded '000000'), create session, accept invitation |
| `/api/auth/me` | GET | Return current user |
| `/api/auth/logout` | POST | Destroy session |
| `/api/account` | GET, PATCH | Get/update account profile |
| `/api/account/adaptive-level` | GET | Get adaptive difficulty level and label |
| `/api/account/logout` | POST | Logout (duplicate of auth/logout) |
| `/api/activities` | GET | Get activity items + unread count |
| `/api/activities/read` | POST | Mark all activities as read |
| `/api/archive` | GET | Get personal archive with filters |
| `/api/bank` | GET, POST | Get/create question bank entries |
| `/api/bank/check` | POST | Check if questions are in bank |
| `/api/ceremony/[ceremonyId]` | GET | Get ceremony data |
| `/api/ceremony/[ceremonyId]/viewed` | POST | Mark ceremony as viewed |
| `/api/ceremony/[ceremonyId]/share-token` | POST | Generate share token |
| `/api/ceremony/banner` | GET | Get unviewed ceremony for feed banner |
| `/api/creator-notes` | GET, POST | Get/create creator notes |
| `/api/creator-notes/[id]/delivered` | POST | Mark creator note as delivered |
| `/api/cron/daily-assignments` | GET | Cron: generate daily queues for all users + SMS |
| `/api/cron/biweekly-ceremony` | GET | Cron: fire ceremonies for users on 14-day cycle |
| `/api/daily/queue` | GET, POST | Get/create daily queue |
| `/api/daily/answer` | POST | Submit answer to daily question |
| `/api/daily/skip` | POST | Skip a daily question |
| `/api/daily/status` | GET | Get daily session status |
| `/api/daily/summary` | GET | Get daily session summary |
| `/api/daily/preferences` | GET, PATCH | Get/update daily preferences |
| `/api/daily/feedback` | POST | Submit thumbs up/down on question |
| `/api/daily/catchup` | GET | Get catch-up questions |
| `/api/daily/catchup/answer` | POST | Submit catch-up answer |
| `/api/daily/catchup/dismiss` | POST | Dismiss catch-up question |
| `/api/declared-interests` | GET, PATCH | Get/update declared interests |
| `/api/feed` | GET | Get feed for user |
| `/api/feed/[feedItemId]/answer` | POST | Submit answer to feed question |
| `/api/feed/[feedItemId]/state` | POST | Update feed item state (skip/dismiss) |
| `/api/feed/[feedItemId]/thumbsup` | POST | Thumbs-up a feed item; propagate to friends |
| `/api/joshing-games` | POST | Create Joshing Game |
| `/api/joshing-games/[id]` | GET | Get Joshing Game details |
| `/api/joshing-games/[id]/answer` | POST | Submit answer to Joshing Game question |
| `/api/knowledge` | GET | Get knowledge page data (mastery, domains, streak) |
| `/api/knowledge/[domain]` | GET | Get domain detail |
| `/api/knowledge/tidy` | POST | Run domain merge manually |
| `/api/onboarding/propose-interests` | POST | LLM-propose interests from warmup answers |
| `/api/onboarding/save-interests` | POST, PATCH | Save declared interests + complete onboarding |
| `/api/onboarding/canonicalize` | POST | Canonicalize a single interest label |
| `/api/questions` | GET, POST | Get questions / create question |
| `/api/questions/[id]` | GET, PATCH, DELETE | Get/update/delete question |
| `/api/questions/[id]/rating` | GET, POST | Get/set question rating |
| `/api/questions/send` | POST | Send question to a friend |
| `/api/questions/suggest` | POST | LLM suggest question from domain |
| `/api/questions/suggest-answer` | POST | LLM suggest answer for question |
| `/api/reactions` | GET, POST | Get reactions / create reaction |
| `/api/reactions/[id]/reply` | POST | Reply to a reaction |
| `/api/share/ceremony/[token]` | GET | Get public ceremony share card data |
| `/api/users` | GET | Get user list (TODO: replace with friends-only) |

### Missing Expected Routes
| Route | Status | Notes |
|---|---|---|
| `/api/users/[id]/profile` | 🔴 MISSING | No friend profile route. `/api/users` only lists all users. |
| `/api/reactions` GET with unread count | ✅ Present | `getUnrepliedReactionCount()` used in activities |

### Pages

| Page | Purpose | Status |
|---|---|---|
| `/` (page.tsx) | Home hub with Today's Five card, feed preview, nav links | ✅ |
| `/login` | Phone + OTP auth flow | ✅ |
| `/onboarding` | Interest declaration flow | ✅ |
| `/daily` | Daily Five chat-thread interface | ✅ |
| `/daily/setup` | Difficulty + domain configuration | ✅ |
| `/daily/summary` | End-of-session summary | ✅ |
| `/daily/catchup` | Catch-up questions interface | ✅ |
| `/feed` | Feed page | ✅ |
| `/knowledge` | Knowledge page with spider/list/progression views | ✅ |
| `/knowledge/[domain]` | Domain detail page | ✅ |
| `/activities` | Activities tab | ✅ |
| `/account` | Account page | ✅ |
| `/questions` | Question bank | ✅ |
| `/archive` | Personal archive | ✅ |
| `/new-game` | Joshing Game creation | ✅ |
| `/games/[id]` | Joshing Game play | ✅ |
| `/games/[id]/summary` | Joshing Game summary | ✅ |
| `/ceremony/[ceremonyId]` | Biweekly ceremony cinematic | ✅ |
| `/share/ceremony/[token]` | Public ceremony share card | ✅ |
| `/creator-notes/new` | Create creator note | ✅ |
| `/users/[slug]` | **Friend profile** | 🔴 MISSING |

---

## SECTION 7 — Salvaged Files & Orphaned Code

### Files with Stub / TODO Markers (Not Yet Ported to Drizzle)

| File | Issue | Severity |
|---|---|---|
| `src/server/mastery/awards.ts` | Uses `type DbClient = any` and Prisma-style calls (`tx.question.findUnique`, `tx.masteryEvent.create`). File is NOT called by active routes (writeMasteryEvent supersedes it) but is a risk if accidentally invoked | High |
| `src/lib/games/winner.ts` | All logic is stubbed out with `// TODO v11.0`. Returns empty data. Not called by active routes. | Medium |
| `src/server/mastery/season-snapshot.ts` | Stubbed: `// TODO v11.0: "GroupMember" raw SQL table`. Not called by active routes. | Medium |
| `src/lib/knowledge-card.ts` | All functions return `null as any` with `// TODO Phase 8`. `parseKnowledgeCardToken`, `buildKnowledgeCardPayload`, etc. — not used by active routes. | Medium |
| `src/lib/questions/categorization.ts` | Uses Prisma-style `db.question.findMany` interface (`TODO R2: rewire to Drizzle`). This IS used: `canonicalizeSubcategoryLabel()` called from elsewhere | High |
| `src/server/profile/portrait.ts` | All functions stub with `// TODO Phase 8`. `getPortraitData()`, `getMasteryData()` return `null as any`. Called from profile tests but not active API routes | Medium |
| `src/server/profile/knowledge.ts` | All functions stub with `// TODO Phase 8`. Not used by active routes. | Low |
| `src/server/profile/friend.ts` | `getFriendPortraitData()` is a stub with `// TODO Phase 8`. Not used by active routes. | Low |
| `src/components/games/GroupOverlapMap.tsx` | v10.25 component with `TODO v11.0` stubs. References `group_id`, `game_id`, `GroupKnowledgeMapCategory` — killed concepts. | High if imported |

### Prisma Files Check
Only `src/lib/games/winner.ts` has a Prisma comment (`// PrismaClient removed`). No active `@prisma/client` imports.

### Files with `canonicalizeSubcategoryLabel` called from Drizzle code
The `src/lib/questions/categorization.ts` file uses a Prisma-like interface stub (`TODO R2`) but its function `canonicalizeSubcategoryLabel` is expected to be called during question categorization. If question creation hits this code path and a real `db` with Prisma methods is passed, it will fail. If a Drizzle client is passed, `db.question.findMany` won't exist.

---

## SECTION 8 — TODO Markers

### TODO Phase (future work)
| File | Line | Text |
|---|---|---|
| `src/app/api/users/route.ts` | 17 | `TODO Phase 8: replace with friends-only list when friend system is built` |
| `src/app/onboarding/page.tsx` | 24 | `TODO Phase 11: load preSeededInterests from invitation token when friend invitation flow is built` |
| `src/lib/knowledge-card.ts` | 9, 15, 21, 27, 33 | `TODO Phase 8: port to Drizzle when friend profiles are built` (x5) |
| `src/server/mastery/write-mastery-event.ts` | 57 | `TODO Phase 8: write friend_mastery activity for each friend when friend system is built` |
| `src/server/profile/friend.ts` | 2 | `TODO Phase 8: port to Drizzle when friend profiles are built` |
| `src/server/profile/knowledge.ts` | 23, 29, 36, 42 | `TODO Phase 8: port to Drizzle when friend profiles are built` (x4) |
| `src/server/profile/portrait.ts` | 38, 44, 50 | `TODO Phase 8: port to Drizzle when friend profiles are built` (x3) |
| `src/server/db/queries/joshing-game.ts` | 502 | `TODO Phase 8: replace with getFriends() when friend system is built` |

### TODO R2 (Drizzle migration)
| File | Line | Text |
|---|---|---|
| `src/lib/games/winner.ts` | 1 | `// PrismaClient removed - TODO R2: rewire to Drizzle db client` |
| `src/lib/questions/categorization.ts` | 8 | `// TODO R2: rewire to Drizzle db client` |
| `src/server/mastery/awards.ts` | 5 | `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents` |
| `src/server/mastery/season-snapshot.ts` | 1 | `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents` |
| `src/server/daily/mastery.ts` | 52 | `// TODO R2: complex mastery query — needs full Drizzle rewrite` |

### TODO v11.0
| File | Line | Text |
|---|---|---|
| `src/components/games/GroupOverlapMap.tsx` | 22, 24, 28, 126, 128 | Various `TODO v11.0` group data source stubs |
| `src/components/games/interpretive-sections.tsx` | 248, 250 | `TODO v11.0: groupId prop - needs new data source` |
| `src/lib/games/winner.ts` | 31, 32, 33 | `TODO v11.0: group member/lookup/answer needs new data source` |
| `src/server/mastery/season-snapshot.ts` | 23 | `TODO v11.0: "GroupMember" raw SQL table - needs new data source` |
| `src/server/sms.ts` | 155 | `TODO v11.0: group member lookup needs new data source` |

---

## SECTION 9 — Production Readiness

### vercel.json
Present and configured:
```json
{
  "crons": [
    { "path": "/api/cron/daily-assignments", "schedule": "0 6 * * *" },
    { "path": "/api/cron/biweekly-ceremony", "schedule": "0 8 1,15 * *" }
  ]
}
```
**Issue:** `biweekly-ceremony` is scheduled only on the 1st and 15th of the month. Users with ceremonies due on other days will never receive them. The cron code correctly computes `accountAgeDays % 14 === 0` but will only run on the 1st and 15th. This needs to be `"0 8 * * *"` (daily) to check all users.

### src/env-check.ts
Present and correctly lists required variables:
- DATABASE_URL, CRON_SECRET, JWT_SECRET, ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
- NEXT_PUBLIC_APP_URL (optional)

**Issue:** `.env.example` references `TWILIO_MESSAGING_SERVICE_SID` (used in `server/sms.ts` at the `MessagingServiceSid` key) but `env-check.ts` checks for `TWILIO_PHONE_NUMBER` instead. The actual SMS code uses `TWILIO_MESSAGING_SERVICE_SID`, not `TWILIO_PHONE_NUMBER`. This mismatch means env-check will pass but SMS will silently fail.

### Authentication Enforcement
`src/proxy.ts` correctly:
- Redirects unauthenticated users to `/login`
- Redirects users with incomplete onboarding to `/onboarding`
- Redirects onboarded users away from `/login` and `/onboarding`
- Matcher excludes API routes, static, images — appropriate

### SMS (Twilio)
`src/server/sms.ts`: SMS implementation is functional via Twilio HTTP API (not SDK). Uses `TWILIO_MESSAGING_SERVICE_SID`. Will fail silently (log only) if env vars missing. This is safe for dev but means missing vars won't cause startup failure.

### OTP Implementation (Critical Production Blocker)
`src/app/api/auth/verify-otp/route.ts` line 8: `const TEMPORARY_OTP_CODE = '000000'` — the OTP check at line 134 only accepts `'000000'`. **Real SMS OTP is not implemented.** The `request-otp` route validates the phone number but does NOT generate or send an OTP code via Twilio. Any user who knows the phone number can log in with `000000`.

---

## SECTION 10 — E2E Flow Verification

### 10.1 New User Onboarding: /login → SMS OTP → /onboarding → warmup → review → confirmation → /

| Step | Status | Notes |
|---|---|---|
| `/login` page | ✅ | Page exists |
| Phone validation | ✅ | `request-otp` validates US number |
| SMS OTP send | 🔴 MISSING | OTP is hardcoded to `000000`; Twilio not called |
| OTP verify | ⚠️ DIVERGENT | Accepts only `000000` |
| Session created | ✅ | `createSession()` on verify |
| Redirect to `/onboarding` | ✅ | `proxy.ts` routes incomplete users |
| Pre-seeded interests load | 🔴 MISSING | Always empty `[]` |
| Warmup questions | ✅ | 6 questions in propose-interests API |
| LLM proposes candidates | ✅ | `proposeInterests()` implemented |
| Player picks 5 and confirms | ✅ | `save-interests` route |
| `onboardingComplete: true` | ✅ | Set in save-interests |
| Redirect to `/` | ✅ | `proxy.ts` redirects complete users |

### 10.2 Daily Ritual: / → "Play now" → /daily/setup → /daily → answer 5 → /daily/summary

| Step | Status | Notes |
|---|---|---|
| Home card "Play now" | ✅ | `TodaysFiveCard` component on home |
| `/daily/setup` config | ✅ | Difficulty + domain selection |
| POST `/api/daily/queue` to generate | ✅ | `fillDailyQueueForUser()` |
| `/daily` chat thread | ✅ | Page exists |
| Answer each question (POST `/api/daily/answer`) | ✅ | Full grading + mastery event |
| Sequential reveal | ✅ | Slot-based queue |
| `/daily/summary` | ✅ | Summary page with adaptive copy |

### 10.3 Creating a Joshing Game: / → "+ New Game" → /new-game → POST /api/joshing-games → SMS + ActivityItem

| Step | Status | Notes |
|---|---|---|
| "New Game" entry point | ✅ | Nav has Activities link; floating `+` button links to `/new-game` |
| 3-step creation flow | ✅ | Title + Recipients + Questions |
| POST `/api/joshing-games` | ✅ | Creates game, recipients, feed items |
| SMS notification | ✅ | `joshing_game_received` SMS sent per recipient |
| ActivityItem written | ✅ | `received_joshing_game` activity |

### 10.4 Receiving + Playing a Joshing Game: SMS → /activities → /games/[id] → answer 5 → summary

| Step | Status | Notes |
|---|---|---|
| SMS with game link | ✅ | Sent in POST /api/joshing-games |
| ActivityItem for recipient | ✅ | Written on game creation |
| Game appears in Activities tab | ✅ | Activity query returns received_joshing_game |
| `/games/[id]` play page | ✅ | Page + `GameplayChat` |
| POST `/api/joshing-games/[id]/answer` | ✅ | Grading + mastery |
| Redirect to summary when complete | ✅ | `if (view.viewerStatus === 'complete') redirect(summary)` |
| Game summary page | ✅ | Exists |

### 10.5 Feed Engagement: / → /feed → answer → thumbs up → others see feed

| Step | Status | Notes |
|---|---|---|
| Home shows feed preview | ✅ | `FeedList` on home |
| Feed page with items | ✅ | Feed page renders items |
| Answer a feed item | ✅ | POST `/api/feed/[id]/answer` |
| Thumbs up propagation to friends | ✅ | POST `/api/feed/[id]/thumbsup` iterates getFriends() |
| Multi-friend endorsement collapses | 🔴 MISSING | No collapse logic — each thumbsup creates separate FeedItem |

### 10.6 Biweekly Ceremony: Cron → ActivityItem → SMS → /ceremony/[id] → beats → ShareCard

| Step | Status | Notes |
|---|---|---|
| Cron fires at scheduled time | ⚠️ DIVERGENT | Only fires on 1st and 15th; should be daily |
| Domain merge runs before beats | ✅ | Confirmed in `fireCeremony()` |
| Beats computed and stored | ✅ | `computeBeats()` stores in `beatsPayload` |
| ActivityItem written | ✅ | `ceremony_ready` activity |
| SMS sent | ⚠️ DIVERGENT | Only sends if `smsOptIn === 'opted_in'`; should be opt-out (default ON) |
| Ceremony page with cinematic beats | ✅ | Page exists, beats rendered |
| `viewedAt` set on view | ✅ | `/ceremony/[id]/viewed` POST |
| ShareCard at end | ✅ | `ShareCard` component at ceremony end |
| Public share page | ✅ | `/share/ceremony/[token]` |
| Beat 4 scoped to friends | 🔴 MISSING | `computeBeat4()` queries all users, not just friends |

### 10.7 Knowledge Exploration: /knowledge → /knowledge/[domain] → /daily/setup with custom domain

| Step | Status | Notes |
|---|---|---|
| Knowledge page loads | ✅ | Multiple views |
| Domain list/spider/progression views | ✅ | All three implemented |
| Domain detail page | ✅ | `/knowledge/[domain]` page |
| Declared interest management | ✅ | Swap/add modal |
| Navigate to setup with custom domain | ✅ | Button navigates to `/daily/setup` |
| Personal Round entry from domain | 🔴 MISSING | No Personal Round surface (PRD §8.4.9) |

---

## SECTION 11 — Top Risks

### Top 5 MISSING PRD Requirements

1. **Personal Rounds (PRD §8.4.9)** — No implementation at all. The PRD specifies a focused 5-question session in a single domain, launched from Knowledge page, counting at full weight. This is an explicitly documented feature with no corresponding route, page, or generation logic.

2. **Pre-seeded interests from invitation (PRD §7.3)** — `onboarding/page.tsx` line 24 confirms this is a TODO stub: `preSeededInterests` is always `[]`. A core onboarding mechanic (the invitation as gift, with pre-seeded interests) is completely absent.

3. **Friend profiles at /users/[slug] (PRD §8.6)** — No friend profile page or route exists. The PRD specifies profiles visible to confirmed friends with Knowledge Portrait, declared interests, authored questions, and "Send a question" CTA. Multiple stub files (`portrait.ts`, `knowledge.ts`, `friend.ts`) are all TODO Phase 8.

4. **Multi-friend endorsement collapsing in Feed (PRD §8.2.3)** — Feed should collapse multiple thumbsups into "Greg + 2 others thumbed up." Instead, each thumbsup creates a separate FeedItem record with no collapse. The UI may show redundant feed items.

5. **Beat 4 (Closest Alignment) scoped to friend graph (PRD §8.8.4)** — `computeBeat4()` queries ALL users with any mastery points, then finds overlap with the requesting user. On a production system with many users, this will surface a random user who happens to share a domain rather than a friend, completely misrepresenting the "Closest Alignment" ceremony beat.

### Top 5 PARTIAL/DIVERGENT Requirements (Most Concerning)

1. **OTP Hardcoded to '000000' (PRD §7.1)** — This is the single most critical production blocker. The verify-otp route accepts any submission of `000000` as valid, bypassing real SMS OTP entirely. Any phone number can be accessed by anyone.

2. **Biweekly ceremony cron schedule (PRD §8.8.2)** — `vercel.json` schedules the ceremony cron on `1,15 * *` (1st and 15th of month only). The ceremony is supposed to fire every 14 days per user (rolling from account creation), meaning users whose 14-day mark falls on other dates will never receive a ceremony. This defeats the personalized cadence entirely.

3. **SMS opt-in logic for ceremony (PRD §8.11)** — `fireCeremony()` only sends SMS when `smsOptIn === 'opted_in'`. But PRD §8.11 specifies the ceremony SMS as "ON, opt-out" — meaning new users (who are `'not_asked'`) should also receive it. Most new users will silently not get ceremony notifications.

4. **Spider graph still surfaced (PRD says replaced by list view)** — The PRD explicitly states "Spider graph REPLACED by list view (user opted out)." The implementation includes a 3-way view toggle (spider/list/progression) where spider is still available. This contradicts the PRD, though having more views is arguably better than fewer.

5. **Activities nav shows a dot, not a number (PRD §8.15.2)** — PRD explicitly says "quiet unread count badge (number, not a red dot)." Implementation uses `size-2 rounded-full bg-primary` (a dot). This is a minor UX divergence but explicitly specified in the PRD.

### Top 5 Forbidden Concepts That May Have Leaked Back In

1. **`GroupOverlapMap.tsx`** — Component from v10.25 group game system remains in `src/components/games/`. It has TODO v11.0 stubs but still references `group_id`, `game_id`, and `GroupKnowledgeMapCategory` — all killed concepts. Risk: if imported anywhere, it renders silently broken.

2. **`src/components/games/interpretive-sections.tsx`** — Still has `TODO v11.0: groupId prop - needs new data source` at lines 248-250. This component IS used by the game summary page; those stubs mean parts of the summary render incomplete.

3. **Streak displayed on Knowledge page** — Knowledge page shows `🔥 {currentStreak} day streak` if streak > 0. PRD §3.4 explicitly says Joshing will not become "a streak-driven engagement product." The streak is calculated via `getUserAnswerStreak()` and is present in the API response. Not prominently featured, but visible.

4. **`src/server/mastery/awards.ts`** — Contains Prisma-style calls and v10.25 mastery logic (including `'authored'` source type at the old point system). Not called by active routes, but its presence is a maintenance hazard.

5. **`smsMessageTypeEnum` vestigial values** — `'star_notification'`, `'game_complete'`, `'game_summary_ready'`, `'incognito_round_invitation'`, `'anniversary_milestone'` remain in the schema enum. These reference v10.25 mechanics (star voting, group games, incognito rounds) that are explicitly killed.

### Top 5 Weakest Implementation Areas

1. **Friend Profile System** — Nearly entirely unimplemented. `portrait.ts`, `knowledge.ts`, `friend.ts` are all stubs. `/api/users` returns ALL users instead of friends only. No profile page exists. The friend discovery and intellectual portrait features are absent.

2. **OTP / Real SMS Authentication** — The authentication flow is functional only with hardcoded `000000`. Twilio OTP delivery is not implemented. This blocks the product from launching.

3. **Categorization/Canonicalization pipeline** — `src/lib/questions/categorization.ts` has `TODO R2` and uses a Prisma-style interface that won't work with Drizzle if called with a real `db` client. Question creation may fail to properly canonicalize subcategories.

4. **`src/server/mastery/awards.ts`** — This file contains the v10.25 mastery awarding logic in Prisma syntax. The new `writeMasteryEvent.ts` has superseded it, but `awards.ts` still exists with `type DbClient = any` and Prisma-style calls. Any code path that accidentally calls `awardMasteryPoints()` from this file will fail.

5. **Daily Five difficulty calibration feedback loop** — The `/api/daily/feedback` (thumbs up/down on difficulty) endpoint exists, but whether this signal actually feeds back into the adaptive level update is not verified. The adaptive difficulty update appears to run after session completion based on correct rate, independently of the feedback signal.

---

## SECTION 12 — Verdict

### Overall PRD Conformance Estimate

| Section | Complete | Partial | Missing | Divergent |
|---|---|---|---|---|
| Core Surfaces | ~55% | ~25% | ~15% | ~5% |
| Auth & Onboarding | ~50% | ~10% | ~30% | ~10% |
| Mastery & Points | ~75% | ~10% | ~5% | ~10% |
| Schema | ~95% | ~5% | 0% | 0% |
| Routes | ~90% | ~5% | ~5% | 0% |
| **Overall** | **~70%** | **~15%** | **~10%** | **~5%** |

**Estimated conformance: 70-75% complete**

### What Would Block a Production Launch Right Now

**Blocker 1 (Critical):** OTP is hardcoded to `000000`. No real SMS OTP is implemented. Any user can log into any phone number. Must implement actual Twilio OTP before launch.

**Blocker 2 (Critical):** Ceremony cron schedule (`"0 8 1,15 * *"`) only fires on the 1st and 15th. Users on any other day never receive a ceremony. Must change to daily (`"0 8 * * *"`).

**Blocker 3 (High):** Beat 4 (Closest Alignment) in the ceremony is computed across ALL users, not the user's friend graph. This will surface random strangers as "closest alignment" on a multi-user production system.

**Blocker 4 (High):** `src/lib/questions/categorization.ts` uses a Prisma-style interface with `TODO R2`. If question categorization is called during question creation with a Drizzle `db`, the subcategory canonicalization will fail silently or throw. Question bank creation flow needs verification.

**Blocker 5 (Medium):** `/api/users` returns ALL users instead of friends only (TODO Phase 8). This means the friend picker for sending questions exposes all registered users to each other — a privacy violation and scope bleed.

**Blocker 6 (Medium):** `TWILIO_MESSAGING_SERVICE_SID` is used in `server/sms.ts` but `env-check.ts` validates `TWILIO_PHONE_NUMBER` instead. Production deployments will pass the env check but SMS will silently fail.

### Smallest Set of Fixes to Reach Launchable State

1. **Implement real OTP** — Add Twilio OTP send in `request-otp` route; add OTP code storage in `OtpCode` table; remove hardcoded `'000000'` in `verify-otp`.

2. **Fix ceremony cron schedule** — Change `vercel.json` from `"0 8 1,15 * *"` to `"0 8 * * *"`.

3. **Scope Beat 4 to friend graph** — In `compute-beats.ts:computeBeat4()`, add a `getFriends(userId)` call and filter `rows` to only include userId values in the friend list.

4. **Scope /api/users to friends only** — Replace `ne(users.id, session.userId)` in `users/route.ts` with `getFriends(session.userId)` query.

5. **Fix env-check.ts** — Change `TWILIO_PHONE_NUMBER` to `TWILIO_MESSAGING_SERVICE_SID` to match actual env var used in sms.ts.

6. **Fix SMS opt-out logic for ceremony** — In `fireCeremony()`, change `smsOptIn === 'opted_in'` to `smsOptIn !== 'opted_out'` so not_asked users also receive the ceremony notification (PRD §8.11 default ON).

7. **Confirm `canonicalizeSubcategoryLabel` wiring** — Verify that the Drizzle `db` client is correctly adapted to the interface expected by `categorization.ts`, or rewrite `canonicalizeSubcategoryLabel` to use Drizzle directly.

8. **Remove or gate `GroupOverlapMap.tsx`** — Ensure this component is not imported by any live page, or delete it.

---

*End of PRD-AUDIT.md*
