# PRD-AUDIT.md - Joshing v11.0 Comprehensive Audit

**Date:** 2026-05-02  
**PRD source:** `_docs/PRD11.md`  
**Scope:** `src/` implementation, schema, routes, build health, production readiness  
**Method:** read PRD sections, located relevant source files, read function bodies/routes/components, ran read-only checks except for writing this audit file.

## Legend

- ✅ COMPLETE - matches PRD behavior
- 🟡 PARTIAL - implemented but missing pieces
- 🔴 MISSING - no implementation found
- ⚠️ DIVERGENT - implemented differently than PRD
- ❓ UNCLEAR - code exists but behavior cannot be verified by reading

---

## SECTION 1 - Build Health

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors. Initial PowerShell `npx` invocation was blocked by execution policy, rerun as `npx.cmd tsc --noEmit` and exited 0. |
| `npm run build` | ⚠️ Failure. Rerun as `npm.cmd run build`; Next 16 compiled successfully, then failed during build TypeScript phase with `Error: spawn EPERM`. No source TypeScript errors were printed. |
| `@prisma/client` imports in `src/` | ✅ 0 active imports. `rg` found only `src/lib/games/winner.ts` comments/signatures mentioning Prisma, no `@prisma/client`. |
| `src/lib/prisma.ts` | ✅ Does not exist. |
| Total files under `src/` | 214 files. |

---

## SECTION 2 - Core Product Surfaces

### 2.1 Daily Five (PRD §8.1, §8.7)

Relevant files: `src/app/daily/page.tsx`, `src/app/daily/setup/page.tsx`, `src/app/daily/summary/page.tsx`, `src/app/daily/catchup/page.tsx`, `src/app/api/daily/*`, `src/server/daily/*`, `src/server/db/queries/daily.ts`, `src/server/adaptive-difficulty.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Generated daily, LLM only | ✅ COMPLETE | `generateDailyQuestionsFromKnowledgeBase()` writes `GeneratedQuestion`; daily answer rejects slots without `generated_question_id`. |
| Calibrated to Knowledge base | ✅ COMPLETE | `getKnowledgeBase()` combines declared + demonstrated domains; LLM prompt uses selected domains and calibration text. |
| Config controls: Difficulty 5 options | ✅ COMPLETE | `daily/setup/page.tsx` supports `normal`, `moderate`, `challenging`, `ridiculous`, `adaptive`. |
| Domains Random/Custom | ✅ COMPLETE | `DailyPreference.domainMode` and setup UI implement `random`/`custom`. |
| Custom domain picker By Category + By Mastery | ✅ COMPLETE | `DomainSortMode = 'category' | 'mastery'`, `groupByCategory()` and `masteryDistance()`. |
| 24-hour window, no in-session timer | 🟡 PARTIAL | No client timer. Queue/date bounds are used, but 24-hour hard expiry is implicit through daily queue date rather than a clear per-slot expiration check. |
| Adaptive default for new users | ✅ COMPLETE | Setup state defaults to `adaptive`; schema has `User.adaptiveLevel` default. |
| LLM prompt target correct rate | ✅ COMPLETE | `mapAdaptiveLevelToDifficultyHint()` maps to 70/55/35/15% prompts; fixed difficulties also map through the same hints. |
| LLM prompt uses Knowledge base domains | ✅ COMPLETE | `generate-questions.ts` builds prompt from `knowledgeBase`/selected domains. |
| Per-domain generation failure copy | 🟡 PARTIAL | `DailyQueueFillError('generation_failed')` exists, but user-facing route returns generic failure; no exact "We couldn't generate questions for [Domain] today" handling found. |
| Daily summary and adaptive close copy | ✅ COMPLETE | `daily/summary/page.tsx` plus `session-close-copy.ts`; `daily/page.tsx` shows final close row before redirect. |
| Catch-up 7 days, 0.25x | ✅ COMPLETE | `daily/catchup/*` routes and `writeMasteryEvent({ sourceType: 'catchup', weight: 0.25 })`. |
| LLM Daily Five cannot expand Knowledge base | ✅ COMPLETE | Daily answer writes mastery with `eventQuestionId: null`; `getKnowledgeBase()` only treats demonstrated domains as mastery events with non-null question IDs. |

### 2.2 The Feed (PRD §8.2)

Relevant files: `src/components/FeedList.tsx`, `src/app/page.tsx`, `src/app/feed/page.tsx`, `src/app/api/feed/*`, `src/server/db/queries/feed.ts`, `src/server/db/queries/ratings.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Bounded reverse-chronological cap ~25 non-pinned | ✅ COMPLETE | `getFeedForUser()` fetches pinned separately and non-pinned `.limit(25)` ordered by `sourceEventAt desc`; `rollOffOldItems()` exists. |
| Direct-sent pinned/exempt | ✅ COMPLETE | `questions/send` creates `sourceType: 'direct_sent'`, `isPinned: true`. |
| Three actions Answer/Skip/Dismiss | ✅ COMPLETE | `FeedList` calls answer and state routes; state route accepts skip/dismiss. |
| Dismissed never resurface | ✅ COMPLETE | Dismissed is excluded from visible states and counted as blocking duplicate resurfacing. |
| Once-correctly-answered items don't reappear | ✅ COMPLETE | `userAnsweredQuestionCorrectly()` is checked before feed creation. |
| Source attribution | ✅ COMPLETE | API emits "sent this to you", "wrote this", "sent you a Joshing Game", and thumbed-up copy. |
| Multi-friend endorsement collapse | ✅ COMPLETE | `collapseThumbsUpItems()` groups `thumbs_upped` items by question ID and API renders "Greg + 2 others thumbed up". |
| Empty state copy | ✅ COMPLETE | `FeedList` has empty/error copies. |
| Reaction system on feed answers | ✅ COMPLETE | `GameplayChat` reaction UI, `/api/reactions`, `reaction_received` activities/SMS. |
| Top-level `/feed` surface | ⚠️ DIVERGENT | `src/app/feed/page.tsx` renders `<FriendsList />` with header "Your friends", not the feed stream. Home renders `FeedList`, but PRD expects Feed as a top-level destination. |

### 2.3 Send-to-Friend (PRD §8.3)

Relevant files: `src/components/SendQuestionAction.tsx`, `src/components/SendQuestionDrawer.tsx`, `src/app/api/questions/send/route.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| First-class drawer/UI | ✅ COMPLETE | Dedicated action + drawer component. |
| Recipient picker | ✅ COMPLETE | Drawer fetches `/api/users`; route returns friends from `getFriends()`. |
| Optional personal message | ✅ COMPLETE | `personalMessage` accepted, capped at 200, stored on `FeedItem`. |
| 5-per-day-per-recipient rate limit | ✅ COMPLETE | `questions/send` counts today's direct sends to recipient and returns 429 at >=5. |
| SMS notification | ✅ COMPLETE | `sendSms(..., 'direct_question_received')` called unless opted out. |
| Distinct visual treatment | ✅ COMPLETE | Direct sent items are pinned and get special border/copy in `FeedList`. |
| Surfaces: game summary, daily summary, feed, questions, archive | ✅ COMPLETE | `SendQuestionAction` imported in daily summary, game summary, feed list, questions page, archive, and knowledge domain page. |

### 2.4 Joshing Game (PRD §8.14)

Relevant files: `src/app/new-game/page.tsx`, `src/app/games/[id]/page.tsx`, `src/app/games/[id]/play-client.tsx`, `src/app/games/[id]/summary/page.tsx`, `src/app/api/joshing-games/*`, `src/server/db/queries/joshing-game.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Title + Recipients + Questions 3-step creation | ✅ COMPLETE | `new-game/page.tsx` uses `Step = 1 | 2 | 3`. |
| 1-5 questions | ✅ COMPLETE | API validates question count 1-5 and uniqueness. |
| Multiple recipients same questions | ✅ COMPLETE | `recipientIds[]` and `joshingGameQuestions` rows per game. |
| Game card persists in Feed, pinned/exempt | ✅ COMPLETE | `createJoshingGame()` writes pinned `FeedItem` per recipient. |
| Recipient chat, sequential reveal | ✅ COMPLETE | `/games/[id]` uses `JoshingGamePlayClient` and shared chat component. |
| Visibility rules | 🟡 PARTIAL | `getJoshingGame()` hides other responses until viewer completes, but creators can see all responses even if not a player; PRD says not-played sees scores only, played sees full. Creator exception may be intentional but is not explicit in the requirement. |
| Mastery full weight | ✅ COMPLETE | Game answer route writes `writeMasteryEvent(... sourceType: 'joshing_game', weight: 1)`. |
| Creator points to author | ✅ COMPLETE | Correct answers call author-credit event for non-self authors. |
| Full summary with 4-5 sections | 🟡 PARTIAL | Summary exists and reuses v10.25 sections, but copy includes "Group Progress Recap" for multi-recipient games and salvaged summary code still has group-oriented concepts. |
| SMS: received/progress/all-complete | ✅ COMPLETE | POST sends received SMS; answer route sends progress/all-complete SMS to creator. |
| Activities items | ✅ COMPLETE | `received_joshing_game`, `joshing_game_progress`, `joshing_game_result` are written. |
| Recipient picker constrained to friends | 🟡 PARTIAL | `/api/users` returns friends, but `POST /api/joshing-games` only verifies user IDs exist, not friendship; crafted requests can send games to any user ID. |

### 2.5 Knowledge Page (PRD §8.4, §8.27, §8.33, §8.37)

Relevant files: `src/app/knowledge/page.tsx`, `src/app/knowledge/[domain]/page.tsx`, `src/app/api/knowledge/*`, `src/app/api/declared-interests/route.ts`, `src/server/db/queries/knowledge.ts`, `src/server/mastery/ceremony.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Two-axis model declared + demonstrated | ✅ COMPLETE | `getKnowledgePageData()` and `getKnowledgeBase()` carry declared and demonstrated flags. |
| Domain detail pages `/knowledge/[domain]` | ✅ COMPLETE | Page and GET/PATCH route exist. |
| Visibility controls private/friends/public | ✅ COMPLETE | `ProfileDomainVisibility` has 3-state visibility; UI toggle writes PATCH. |
| Personal rounds/deep dive from domain | 🟡 PARTIAL | Domain page links to `/daily/setup?domainMode=custom&domain=...`; this is a custom Daily setup, not a distinct Personal Round that does not consume Daily Five. |
| Tier progress visible per domain | ✅ COMPLETE | Domain page and list show tier/progress. |
| Spider graph removed/replaced by list | ⚠️ DIVERGENT | `SpiderGraph` remains available behind a 3-way view toggle (`spider`, `list`, `progression`). PRD says user opted out of spider graph. |
| Progression Landscape view | ✅ COMPLETE | `ProgressionLandscape` exists. |
| Declared interests management + cap 5 | ✅ COMPLETE | Knowledge page add/swap UI and PATCH route enforce max 5. |
| Expansion only through friend-mediated questions | ✅ COMPLETE | Daily-generated answers do not add non-null `questionId` mastery events; feed/game/direct sends do. |
| Domain merge/tidy | ✅ COMPLETE | `runDomainMergesForUser()` transaction updates mastery/events/questions/declared visibility; `/api/knowledge/tidy` rate-limited once/24h. |
| Killed manual consolidate trigger absent | ⚠️ DIVERGENT | PRD §14.1 explicitly kills "Manual consolidate domain trigger from Knowledge page"; implementation has "Tidy up my map." The user prompt expected this button, but PRD11 also lists it as killed. |
| Streaks not surfaced | ⚠️ DIVERGENT | Knowledge page shows "On a streak" and a day streak line, contrary to PRD non-goal against surfaced streak metrics. |

### 2.6 Activities Tab (PRD §8.15)

Relevant files: `src/components/Nav.tsx`, `src/app/activities/page.tsx`, `src/app/api/activities/*`, `src/server/db/queries/activity.ts`, `src/server/activity/write-activity.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| 5th nav item | ✅ COMPLETE | Nav has Home, Feed, Knowledge, Activities, Account. |
| Item types listed in prompt | ✅ COMPLETE | All 11 listed types exist in `ActivityItemType` / hydrate logic. |
| Unread indicator dot | ✅ COMPLETE relative to user prompt | `Nav.tsx` renders a dot for unread activities. Note PRD11 text says number, but the user explicitly requested dot. |
| Reverse-chron | ✅ COMPLETE | `getActivitiesForUser()` orders by `createdAt desc`. |
| Marked read on tab open | ✅ COMPLETE | `MarkActivitiesRead` posts `/api/activities/read` on mount. |
| 90-day soft delete except games | 🟡 PARTIAL | Query applies 90-day cutoff to all returned items; it does not exempt Joshing Game activity types from cutoff. No background soft-delete job found. |
| `friend_mastery` activity | 🟡 PARTIAL | Type/rendering exists, but `writeTierCrossingActivityForFriends()` is a TODO stub. |

### 2.7 Biweekly Ceremony (PRD §8.8, §8.29)

Relevant files: `src/app/ceremony/[ceremonyId]/page.tsx`, `src/app/share/ceremony/[token]/page.tsx`, `src/app/api/ceremony/*`, `src/app/api/cron/biweekly-ceremony/route.ts`, `src/server/ceremony/*`, `src/lib/share-card.ts`, `src/components/ShareCard.tsx`.

| Requirement | Status | Evidence |
|---|---|---|
| Per-user every 14 days from account creation | ✅ COMPLETE | Cron runs daily; code checks `accountAgeDays % 14 === 0`. |
| 5 beats | ✅ COMPLETE | `computeBeat1` through `computeBeat5`. |
| Skip null beats silently | ✅ COMPLETE | Ceremony page builds views only for non-null beats. |
| Cinematic full-screen/tap advance | ✅ COMPLETE | Full-screen client page with active beat advance. |
| `viewedAt` set first view | ✅ COMPLETE | POST viewed route. |
| Feed banner when unviewed | ✅ COMPLETE | `/api/ceremony/banner` and feed/home integrations. |
| Activity item `ceremony_ready` | ✅ COMPLETE | `fireCeremony()` writes it. |
| SMS notification | ✅ COMPLETE | Sends unless `smsOptIn === 'opted_out'`, matching opt-out default. |
| Share card Copy Link + Save Image | ✅ COMPLETE | `ShareCard` supports copy/save; token route exists. |
| Public share page/API safe subset | ✅ COMPLETE | `/share/ceremony/[token]` and `/api/share/ceremony/[token]` return card data, not raw user IDs. |
| Domain merge before beats | ✅ COMPLETE | `runDomainMergesForUser()` precedes `computeBeats()`. |
| Closest alignment scoped to friends | ✅ COMPLETE | `computeBeat4()` calls `getFriends()` and filters candidates to `friendIds`. |

### 2.8 Question Bank (PRD §8.5, §8.13)

Relevant files: `src/app/questions/page.tsx`, `src/app/api/questions/*`, `src/app/api/bank/*`, `src/server/db/queries/questions.ts`, `src/server/db/queries/bank.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Lists own-authored + curated | ✅ COMPLETE | Questions page uses `/api/questions`; query delegates to `getBankedQuestions()`. |
| Tabs All/Mine/Saved | ✅ COMPLETE | `OwnershipFilter = 'all' | 'mine' | 'saved'`. |
| Edit only own + not-yet-used | ✅ COMPLETE | GET/PATCH forbid other creators and `updateQuestion()` rejects `usedInGamesCount > 0`. |
| Delete only own + not-yet-used | ✅ COMPLETE | Same ownership + used checks. |
| Add-to-Bank icon surfaces | ✅ COMPLETE | `AddToBankAction` used in feed, archive, summaries/domain surfaces. |
| LLM answer suggestion | ✅ COMPLETE | `QuestionForm` calls `/api/questions/suggest-answer`; suggest route exists. |

### 2.9 Account

Relevant files: `src/app/account/page.tsx`, `src/app/api/account/route.ts`, `src/app/api/account/logout/route.ts`, `src/app/api/account/adaptive-level/route.ts`, `src/server/db/queries/account.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Display name editable inline | ✅ COMPLETE | Account page PATCHes display name. |
| Stats tiles | ✅ COMPLETE | `StatTile` components from account profile stats. |
| Quick links to Knowledge, Questions, Activities, Archive | ✅ COMPLETE | Account UI includes links. |
| Logout | ✅ COMPLETE | Account logout route + auth logout route. |
| Phone masked | ✅ COMPLETE | Account query/page mask phone display. |
| Adaptive level surfaced optional | ✅ COMPLETE | `/api/account/adaptive-level` and setup page label; account route also exposes adaptive level. |

### 2.10 Personal Archive (PRD §8.7/§8.11)

Relevant files: `src/app/archive/page.tsx`, `src/app/api/archive/route.ts`, `src/server/db/queries/archive.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| Filter by source/domain/result | ✅ COMPLETE | Archive URL builder and query support source/domain/result. |
| Search | ✅ COMPLETE | Client page has search state and API query supports it. |
| Infinite scroll | 🟡 PARTIAL | API has pagination/limit; client loads more via cursor-like state, but exact infinite-scroll behavior is basic. |
| Per-item actions thumbs/send/bank | ✅ COMPLETE | Uses `QuestionRatingButtons`, `SendQuestionAction`, `AddToBankAction`. |

---

## SECTION 3 - Mechanics & Systems

| Area | Status | Notes |
|---|---|---|
| 3.1 Authentication | 🟡 PARTIAL | SMS OTP, US phone validation, JWT cookie session, expiration, logout exist. Critical divergence: `verifyOtp()` accepts hardcoded `000000`, bypassing real OTP. Invitation-only signup is partially enforced in verify route but not fully audited as complete. |
| 3.2 Onboarding | ⚠️ DIVERGENT | Welcome/review/confirmation/canonicalize/save exist. PRD requires 6 free-text questions with 5 required + 1 optional; implementation has 6 fields but `canGenerate = answeredCount >= 2`. Pre-seeded interests are TODO in page despite DB helper existing. Middleware redirects unonboarded users. |
| 3.3 Mastery & Tier System | 🟡 PARTIAL | `writeMasteryEvent()` is used by daily/feed/game/catchup. Points table in `awards.ts` matches 100/50/10 and 25% catch-up. Tier thresholds are 500/1500/3500 with 20% creator gate, not the user prompt's abbreviated "Establishing -> Familiar -> Solid -> Mastery" values. `friend_mastery` activity is stubbed. Curator credit type exists but no concrete award path confirmed. |
| 3.4 Adaptive Difficulty | ✅ COMPLETE | `User.adaptiveLevel`, rolling answer analysis, prompt mapping, setup display, adaptive default. |
| 3.5 Question Reactions | ✅ COMPLETE | Canned set + custom message, route blocks self-reactions, SMS/activity to recipient, reply route sets `repliedAt`. |
| 3.6 Thumbs Up/Down | ✅ COMPLETE | `QuestionRating` table, one rating per user/question, thumbs-up feed propagation, skips already-correct/blocking recipients, visible on daily/game/archive/feed surfaces. |
| 3.7 Domain Merge | ✅ COMPLETE | LLM merge suggestions, transaction updates `Question`, `DeclaredInterest`, mastery/events/visibility, ceremony pre-run, manual rate-limited trigger. |
| 3.8 Catch-up | ✅ COMPLETE | 7-day query, 0.25x weight, homepage card, skip/dismiss routes, daily play path. |
| 3.9 Breadcrumbs | 🟡 PARTIAL | LLM breadcrumbs cached by `questionId:isCorrect` and 3s timeout; rendered in daily/feed/catchup/game. Cache key omits submitted answer, so incorrect-answer breadcrumbs for the same question share one cache entry. |
| 3.10 Session Close Message | ✅ COMPLETE | `SessionCloseRow` and adaptive summary text before redirect/summary. |
| 3.11 Creator Notes | ✅ COMPLETE | Wrong-answer prompt, 3/day/author 24h SMS limit, deep link page, recipient activity/SMS, recap-card display, skips self-answers. |
| 3.12 Share Card | ✅ COMPLETE | Idempotent token route, public API/page, portrait/square component, copy link/save image/native-share style behavior. |

---

## SECTION 4 - Explicitly Killed Concepts

| Forbidden concept | Status in `src/` |
|---|---|
| Groups / GroupMember / GroupKnowledgeMap | 🟡 Leaked in comments/stubs: `src/server/sms.ts`, `src/lib/games/winner.ts`, `src/server/mastery/season-snapshot.ts`; game summary copy still says "Group Progress Recap". No active group schema table in Drizzle. |
| Game / GameQuestion v10.25 | ✅ Old `Game` absent; v11 `JoshingGameQuestion` exists as required. |
| DailyAssignment group-scoped | 🟡 Function name `getDailyAssignmentBounds()` remains in `src/lib/games/timezone.ts` and imports; appears naming-only, not group-scoped data. |
| Three setups (`know_me`, etc.) | ✅ Not found in active `src/`. |
| Star voting / `StarVote` | ✅ Not found. Replaced by `QuestionRating`. |
| Leaderboards | ✅ No route/table found in `src/`. |
| Public daily game / public infinite run | ✅ Not found. |
| Similarity sharing | ✅ Not found. |
| Author profiles `/authors/[slug]` | ✅ Not found. |
| Expert challenges / Challenge tables | ✅ Not found in `src/`. |
| Streaks surfaced prominently | ⚠️ Present on Knowledge page (`currentStreak` line and "On a streak" highlight). |
| Push notifications | ✅ Not found; SMS only. |
| Real-time / WebSocket | ✅ Not found. |
| User file uploads | ✅ Not found. |
| Killed tables (`InviteLink`, `CompatibilityScore`, `AppNotification`, `CeremonyProgress`, etc.) | ✅ Not in Drizzle schema. |

---

## SECTION 5 - Schema Audit

### Tables in `src/server/db/schema.ts`

| Table | Column count |
|---|---:|
| User | 20 |
| UserSession | 5 |
| OtpCode | 5 |
| Question | 42 |
| QuestionAudienceTag | 5 |
| UserQuestionBank | 6 |
| PLAYER_MASTERY | 9 |
| MASTERY_EVENTS | 14 |
| QuestionReaction | 10 |
| CreatorNote | 11 |
| GradeDispute | 9 |
| SmsLog | 5 |
| GeneratedQuestion | 12 |
| QuestionFeedback | 6 |
| QuestionRating | 5 |
| DailyQueue | 5 |
| DailyPreference | 9 |
| SkippedDailyQuestion | 7 |
| USER_DOMAIN_DIFFICULTY | 7 |
| USER_DOMAIN_EXCLUSIONS | 4 |
| PROFILE_DOMAIN_VISIBILITY | 7 |
| DeclaredInterest | 6 |
| Friendship | 10 |
| JoshingGame | 5 |
| FeedItem | 12 |
| JoshingGameRecipient | 4 |
| JoshingGameQuestion | 4 |
| JoshingGameResponse | 11 |
| BiweeklyCeremony | 8 |
| ActivityItem | 9 |
| FriendInvitation | 10 |

### Required Table Status

All required tables listed in the user prompt are PRESENT, including v11 `User` columns (`slug`, `authorProfilePublic`, `onboardingComplete`, `adaptiveLevel`) and Round additions `QuestionRating` and `CreatorNote`.

Extra tables not in the prompt list: none material beyond `QuestionFeedback`, which is included in PRD §20 naming but may not have been in the exact required-table paragraph.

---

## SECTION 6 - Route Inventory

### API Routes

57 API route files:

- `/api/account` GET, PATCH
- `/api/account/adaptive-level` GET
- `/api/account/logout` POST
- `/api/activities` GET
- `/api/activities/read` POST
- `/api/archive` GET
- `/api/auth/logout` POST
- `/api/auth/me` GET
- `/api/auth/request-otp` POST
- `/api/auth/verify-otp` POST
- `/api/bank` GET, POST, DELETE
- `/api/bank/check` POST
- `/api/ceremony/[ceremonyId]` GET
- `/api/ceremony/[ceremonyId]/share-token` POST
- `/api/ceremony/[ceremonyId]/viewed` POST
- `/api/ceremony/banner` GET
- `/api/creator-notes` POST
- `/api/creator-notes/[id]/delivered` POST
- `/api/cron/biweekly-ceremony` GET
- `/api/cron/daily-assignments` GET
- `/api/daily/answer` POST
- `/api/daily/catchup` GET
- `/api/daily/catchup/answer` POST
- `/api/daily/catchup/dismiss` POST
- `/api/daily/feedback` POST
- `/api/daily/preferences` GET, PATCH, PUT
- `/api/daily/queue` GET, POST
- `/api/daily/reset` POST
- `/api/daily/skip` POST
- `/api/daily/status` GET
- `/api/daily/summary` GET
- `/api/declared-interests` GET, PATCH
- `/api/feed` GET
- `/api/feed/[feedItemId]/answer` POST
- `/api/feed/[feedItemId]/state` PATCH
- `/api/feed/[feedItemId]/thumbsup` POST
- `/api/joshing-games` POST
- `/api/joshing-games/[id]` GET
- `/api/joshing-games/[id]/answer` POST
- `/api/knowledge` GET
- `/api/knowledge/[domain]` GET, PATCH
- `/api/knowledge/tidy` POST
- `/api/onboarding/canonicalize` POST
- `/api/onboarding/propose-interests` POST
- `/api/onboarding/save-interests` POST
- `/api/questions` GET, POST
- `/api/questions/[id]` GET, PATCH, DELETE
- `/api/questions/[id]/rating` GET, POST
- `/api/questions/send` POST
- `/api/questions/suggest` POST
- `/api/questions/suggest-answer` POST
- `/api/reactions` POST, GET
- `/api/reactions/[id]/reply` POST
- `/api/share/ceremony/[token]` GET
- `/api/users` GET

Expected API route status:

| Expected route | Status |
|---|---|
| `/api/auth/{request-otp, verify-otp, me, logout}` | ✅ PRESENT |
| `/api/onboarding/{propose-interests, save-interests, canonicalize}` | ✅ PRESENT |
| `/api/daily/{queue, answer, status, skip, preferences, summary, catchup, catchup/answer, catchup/dismiss}` | ✅ PRESENT |
| `/api/cron/{daily-assignments, biweekly-ceremony}` | ✅ PRESENT |
| `/api/feed` and `/api/feed/[feedItemId]/{answer,state,thumbsup}` | ✅ PRESENT |
| `/api/questions`, `/api/questions/[id]`, `/api/questions/[id]/rating`, `/api/questions/suggest`, `/api/questions/send` | ✅ PRESENT |
| `/api/joshing-games`, `/api/joshing-games/[id]`, `/api/joshing-games/[id]/answer` | ✅ PRESENT |
| `/api/users` | ✅ PRESENT |
| `/api/users/[id]/profile` | 🔴 MISSING |
| `/api/activities`, `/api/activities/read` | ✅ PRESENT |
| `/api/reactions`, `/api/reactions/[id]/reply` | ✅ PRESENT |
| `/api/bank`, `/api/bank/check` | ✅ PRESENT |
| `/api/knowledge`, `/api/knowledge/[domain]`, `/api/knowledge/tidy` | ✅ PRESENT |
| `/api/ceremony/[id]`, `/viewed`, `/share-token` | ✅ PRESENT under `[ceremonyId]` |
| `/api/share/ceremony/[token]` | ✅ PRESENT |
| `/api/archive` | ✅ PRESENT |
| `/api/account`, `/api/account/logout` | ✅ PRESENT |
| `/api/creator-notes` | ✅ PRESENT |
| `/api/declared-interests` | ✅ PRESENT |

### Page Routes

20 page routes:

- `/` - home with Today's Five, catch-up, new game, feed section
- `/account` - account/settings
- `/activities` - activity history
- `/archive` - personal archive
- `/ceremony/[ceremonyId]` - biweekly ceremony
- `/creator-notes/new` - creator note composer
- `/daily` - Daily Five play
- `/daily/catchup` - catch-up play
- `/daily/setup` - Daily Five configuration
- `/daily/summary` - Daily Five recap
- `/feed` - currently friends list, not full feed stream
- `/games/[id]` - Joshing Game play/status
- `/games/[id]/summary` - Joshing Game summary
- `/knowledge` - Knowledge page
- `/knowledge/[domain]` - domain detail
- `/login` - SMS login
- `/new-game` - Joshing Game creation
- `/onboarding` - onboarding flow
- `/questions` - question bank
- `/share/ceremony/[token]` - public ceremony share

Expected page route status:

| Expected page | Status |
|---|---|
| `/`, `/login`, `/onboarding` | ✅ PRESENT |
| `/daily`, `/daily/setup`, `/daily/summary`, `/daily/catchup` | ✅ PRESENT |
| `/feed` | ⚠️ PRESENT but wrong surface; renders friends list. |
| `/knowledge`, `/knowledge/[domain]` | ✅ PRESENT |
| `/activities`, `/account`, `/questions`, `/archive` | ✅ PRESENT |
| `/new-game`, `/games/[id]`, `/games/[id]/summary` | ✅ PRESENT |
| `/ceremony/[id]`, `/share/ceremony/[token]` | ✅ PRESENT |
| `/creator-notes/new` | ✅ PRESENT |

---

## SECTION 7 - Salvaged Files Status

Checked `src/components/` and `src/lib/`.

| Category | Files |
|---|---|
| Orphaned / no active import found by static name scan | `src/components/QuickAddQuestionModal.tsx`, `src/components/games/game-details-mode-sections.tsx`, `src/components/games/interpretive-sections.tsx`, `src/components/knowledge/KnowledgeOverviewClient.tsx`, `src/components/knowledge/__tests__/DomainCard.test.tsx` |
| Leftover Prisma references | `src/lib/games/winner.ts` (comment and parameter name only; no `@prisma/client`) |
| Unresolved TODO markers | See Section 8. |

Note: the orphan scan is conservative text matching; dynamic or indirect imports may not be detected. `game-details-mode-sections.tsx` and `interpretive-sections.tsx` are not currently imported by active summary page despite earlier salvage notes.

---

## SECTION 8 - TODO Markers

Search pattern: `TODO Phase`, `TODO R1/R2/R3`, `TODO v11`, `TODO v11.0`, `FIXME`, `XXX`, `HACK`.

### Friend System / Profiles

- `src/lib/knowledge-card.ts:9` - `TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/lib/knowledge-card.ts:15` - same
- `src/lib/knowledge-card.ts:21` - same
- `src/lib/knowledge-card.ts:27` - same
- `src/lib/knowledge-card.ts:33` - same
- `src/server/profile/portrait.ts:38` - same
- `src/server/profile/portrait.ts:44` - same
- `src/server/profile/portrait.ts:50` - same
- `src/server/profile/friend.ts:2` - same
- `src/server/profile/knowledge.ts:23` - same
- `src/server/profile/knowledge.ts:29` - same
- `src/server/profile/knowledge.ts:36` - same
- `src/server/profile/knowledge.ts:42` - same
- `src/server/db/queries/joshing-game.ts:502` - `TODO Phase 8: replace with getFriends() when friend system is built.`

### Mastery / Drizzle Rewrite

- `src/lib/games/winner.ts:10` - `PrismaClient removed - TODO R2: rewire to Drizzle db client`
- `src/server/daily/mastery.ts:52` - `TODO R2: complex mastery query - needs full Drizzle rewrite`
- `src/server/mastery/season-snapshot.ts:10` - `TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.`
- `src/server/mastery/awards.ts:14` - same
- `src/server/mastery/write-mastery-event.ts:57` - `TODO Phase 8: write friend_mastery activity for each friend when friend system is built.`

### v10.25 Group Carryover

- `src/server/sms.ts:155` - `TODO v11.0: group member lookup needs new data source`
- `src/lib/games/winner.ts:40` - `TODO v11.0: group member lookup needs new data source`
- `src/lib/games/winner.ts:41` - `TODO v11.0: group lookup needs new data source`
- `src/lib/games/winner.ts:42` - `TODO v11.0: answer.game_id winner scoping - needs new data source`
- `src/server/mastery/season-snapshot.ts:32` - `TODO v11.0: "GroupMember" raw SQL table - needs new data source`

### Invitation / Onboarding

- `src/app/onboarding/page.tsx:24` - `TODO Phase 11: load preSeededInterests from invitation token`

No `FIXME`, `XXX`, or `HACK` matches were found in `src/`.

---

## SECTION 9 - Production Readiness

| Item | Status | Notes |
|---|---|---|
| `vercel.json` exists | ✅ YES | Contains two crons. |
| Daily cron expected 6:00 AM UTC | ✅ MATCH | `/api/cron/daily-assignments` schedule `0 6 * * *`. |
| Biweekly ceremony expected 7-8 AM EST | ✅ MATCH | `/api/cron/biweekly-ceremony` schedule `0 8 * * *`; app filters per-user 14-day cadence. |
| `src/env-check.ts` exists | ✅ YES | Validates `DATABASE_URL`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, and JWT via `JWT_SECRET` or `AUTH_SECRET`. |
| Env check Twilio phone vs messaging service | 🟡 PARTIAL | Requires messaging service SID, not `TWILIO_PHONE_NUMBER`; acceptable if deployed that way. |
| `.env.example` exists | ✅ YES | But Twilio/cron entries are incomplete/outdated. |
| `src/proxy.ts` exists | ✅ YES | Next 16-style proxy present. |
| Proxy auth enforcement | ✅ COMPLETE | Redirects unauthenticated pages to `/login` and unonboarded users to `/onboarding`. |
| Build readiness | ⚠️ BLOCKED | `npm.cmd run build` fails with `spawn EPERM` after compile. |

Variables listed in `.env.example`: `DATABASE_URL`, `DIRECT_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`; commented examples for `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`. Missing `CRON_SECRET` and uncommented Twilio requirements.

---

## SECTION 10 - End-to-End Flow Verification

| Journey | Status | Files / breakpoints |
|---|---|---|
| 10.1 New user onboarding | 🟡 PARTIAL | `/login` -> OTP -> `/onboarding` works. Broken/divergent at warmup count (`>=2` instead of 5 required), hardcoded OTP bypass, pre-seeded invitation interests TODO. |
| 10.2 Daily ritual | ✅ COMPLETE | `/` -> `/daily/setup` -> `/daily` -> answer 5 -> `/daily/summary`; queue/status/answer/summary routes present. |
| 10.3 Sending a Joshing Game | 🟡 PARTIAL | `/new-game` -> POST -> FeedItem/SMS/ActivityItem exists. API does not enforce recipients are friends; SMS only sent to non-opted-out users. |
| 10.4 Receiving + playing Joshing Game | ✅ COMPLETE | SMS link or activity/feed card -> `/games/[id]` -> answers -> `/games/[id]/summary`. |
| 10.5 Feed engagement | ⚠️ BROKEN AT `/feed` PAGE | Home feed section works via `FeedList`; top-level `/feed` renders FriendsList instead of feed. API flow answer/thumbsup/propagation works. |
| 10.6 Biweekly ceremony | ✅ COMPLETE | Daily cron -> activity/SMS -> `/ceremony/[id]` -> share card -> `/share/ceremony/[token]`, with domain merge before beats. |
| 10.7 Knowledge exploration | 🟡 PARTIAL | `/knowledge` -> domain detail -> custom `/daily/setup` works; PRD-specific Personal Round not implemented as distinct non-Daily-consuming flow. |

---

## SECTION 11 - Top Risks

### Top 5 Missing Entirely

1. 🔴 `/api/users/[id]/profile` and friend profile pages (`/users/[slug]`) are absent, despite PRD launch scope.
2. 🔴 Invitation creation/acceptance surfaces are not implemented as first-class app routes; schema/helper exists but no complete invite flow.
3. 🔴 True Personal Rounds are absent; only daily setup deep-linking exists.
4. 🔴 `friend_mastery` activity writes are missing; tier-crossing social notification is a TODO stub.
5. 🔴 Full `/feed` page is missing as a feed surface; the route currently shows friends.

### Top 5 Partial/Divergent Requirements

1. ⚠️ OTP accepts `000000`, a production auth bypass.
2. ⚠️ Onboarding requires only 2 warmup answers, not 5 required + 1 optional.
3. ⚠️ `npm run build` fails with `spawn EPERM`; production build is not currently clean in this environment.
4. ⚠️ Spider graph and streaks are still surfaced despite PRD killed/non-goal language.
5. 🟡 Joshing Game POST can target any valid user ID, not only friends, if called directly.

### Top 5 Killed Concepts That Leaked Back

1. Group terminology in `src/app/games/[id]/summary/page.tsx` ("Group Progress Recap").
2. Group TODO stubs in `src/lib/games/winner.ts`.
3. Group member TODO in `src/server/sms.ts`.
4. `GroupMember` raw SQL TODO in `src/server/mastery/season-snapshot.ts`.
5. Surfaced streak metrics on `src/app/knowledge/page.tsx`.

### Weakest Implementation Areas

1. Friend profiles/invitation graph: many TODO Phase 8/11 markers and missing routes.
2. Onboarding: PRD count mismatch and pre-seeded invitation data not wired.
3. Production readiness: build failure plus incomplete `.env.example`.
4. Salvaged profile/knowledge-card modules: Drizzle port TODOs remain.
5. Feed surface routing: implementation exists as a component, but `/feed` points to friends.

---

## SECTION 12 - Verdict

Rough PRD conformance estimate: **72%**. The core daily ritual, feed backend, send-to-friend, Joshing Game, mastery events, reactions, archive, ceremony, schema, and most API routes are substantially implemented. The largest gaps are not table/file existence; they are product-flow mismatches: onboarding is too permissive, friend profile/invite features are incomplete, `/feed` is the wrong screen, and some killed v10.25 language/logic remains.

Production launch blockers right now: the hardcoded OTP bypass, failing production build (`spawn EPERM`), missing/incomplete invitation-only onboarding and friend profile surfaces, `/feed` not rendering the feed, incomplete `.env.example`/env readiness, and API-level recipient validation gaps for Joshing Games.

Smallest launchable fix set: remove `000000` OTP bypass, make `npm run build` pass in the deployment environment, wire `/feed` to `FeedList`, enforce friend-only recipients server-side for Joshing Games, require the PRD onboarding warmup threshold and load pre-seeded interests, complete or explicitly defer friend profiles/invites, remove spider/streak surfacing if PRD remains authoritative, and update `.env.example` to match `env-check.ts`.

---

## SECTION 13 - Surfaces & Copy Disposition (2026-05-18)

Resolutions for brief-referenced surfaces flagged as "missing in code." Group-game-adjacent items are withdrawn now that group games are out of Phase 1 (parallel to the declared-territory visual withdrawal in commit `629cedb`). See `PRD-11.1-MASTER-ALIGNMENT-AUDIT.md` §14 for the same disposition with additional context.

### Withdrawn (Phase 1)

- **Standout moments / "only you got this"** — no peer set without group games.
- **Game Summary "Group Story" section** — group-game artifact.
- **Friend Play** — group-game artifact.
- **Challenge Worlds** — group-game-adjacent feature; not on Phase 1 roadmap.
- **Share-card emoji grid (Wordle-style)** — numeric highlights in `ShareCard.tsx` stay on-brand.

### Resolved (already implemented)

- **"common ground +" sub-label rotation** — `src/components/play/GameplayChat.tsx:87-90`.
- **Accepted-variant near-miss** — handled by the consolation line for in-ballpark wrong answers (`src/lib/llm.ts:446-450`); accepted alternatives are silently correct.
- **Next-questions countdown** — time-to-next-round in `src/components/TodaysFiveCard.tsx:164`.

### Removed

- **"Now it's in yours too." wrong-reveal variant** — dropped from the `wrongHeadline` rotation in `src/components/play/GameplayChat.tsx` (4 → 3 variants).

### Author identity (Top 10 items 3, 7, 11, 14)

- **In-session question card** — ✅ author promoted; `0.86rem / weight 600` serif name with `0.55rem` mono "FROM" label (commit `70399ba`).
- **End-of-session review card** — ✅ author promoted to same in-session pattern when `creatorNote` exists (this PR). System questions retain "JOSHING BOT · DOMAIN".

