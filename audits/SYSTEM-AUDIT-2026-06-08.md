# System Audit — 2026-06-08

Scope: live codebase audit only. I did not use the PRD/specs as a standard. I read code, route handlers, query modules, UI components, styling tokens, and ran read-only lint/typecheck diagnostics. I did not modify application code, schema, config, or content.

## Phase 1 — Architecture map

### Codebase shape

- This is a Next.js App Router application with React, TypeScript, Vitest, Drizzle ORM, and Postgres. The package scripts expose `dev`, `build`, `start`, `test`, LLM evals, lint, formatting, and several smoke scripts (`daily-catchup`, `question-vetting`, `invite-first-five`, `sms-message-types`, `house-authorship`, `lately-milestones`, `niche-match-dedup`, `gameplay`). Source: `package.json:6-24`, `package.json:26-67`.
- The app is organized under `src/app` for pages and route handlers, `src/components` for UI/feature components, `src/server` for auth/data/business logic, `src/lib` for shared utilities/LLM helpers/types, `src/server/db/queries` for Drizzle query modules, `drizzle/` for migrations, and `scripts/` for operational/smoke/backfill scripts.
- There is no Prisma schema in the repository inventory I inspected. The live data model is Drizzle/Postgres in `src/server/db/schema.ts`, with the Drizzle client exported from `src/server/db/index.ts`.

### Runtime shell and shared layout

- `RootLayout` loads Montserrat, Playfair Display, Cormorant Garamond, Caveat, and Inter, reads session claims, fetches onboarding profile, bell badge count, and contact-discovery status, then renders global navigation. Source: `src/app/layout.tsx:1-8`, `src/app/layout.tsx:10-56`, `src/app/layout.tsx:63-92`.
- Session state is JWT/cookie based and backed by `UserSession`. The session cookie is `joshing_session`; duration is 90 days. Source: `src/server/auth/session.ts:14-19`, `src/server/auth/session.ts:21-51`.
- Database access is centralized through a singleton `pg` pool and Drizzle client. The DB layer requires `DATABASE_URL`, caps the pool at five connections, exports `db = drizzle(pool, { schema })`, and logs pool contention. Source: `src/server/db/index.ts:6-28`, `src/server/db/index.ts:30-50`.

### Page routes found

- `/` — home: server component reading session, Daily Five queue/preferences/catch-up state, latest ceremony, activity stream, and feed payload, then rendering `TodaysFiveCard`, ceremony pin, recent activity, and `FeedList`. Source: `src/app/page.tsx:1-19`, `src/app/page.tsx:23-71`, `src/app/page.tsx:74-171`.
- `/login` — login panel.
- `/onboarding` — invite-gated onboarding; server page validates session, onboarding status, invitation/follow provenance, filters pre-seeded interests, and renders `OnboardingFlow`. Source: `src/app/onboarding/page.tsx:14-52`, `src/app/onboarding/page.tsx:53-97`.
- `/daily`, `/daily/setup`, `/daily/catchup`, `/daily/summary` — Daily Five play, setup/preferences, missed-question catch-up, and round summary. Source: `src/app/daily/page.tsx:1-15`, `src/app/daily/page.tsx:139-260`.
- `/questions`, `/new-game`, `/games/[id]`, `/games/[id]/summary`, `/replay` — authored question bank, game creation, direct game play, game summary, and missed/replay surfaces.
- `/friends`, `/friends/find`, `/invite/[token]`, `/u/[handle]/[token]` — friend/follow hub, discovery/search, SMS-style invite, and per-user invite-link entry points.
- `/users/me`, `/users/[id]`, `/users/[id]/knowledge`, `/knowledge`, `/knowledge/[domain]` — own profile/settings, other-user profile, user knowledge view, own knowledge overview, and domain detail. The profile page resolves owner/friend/stranger/preview visibility, then fetches mastery, knowledge, common ground, authored questions, editable profile/settings, discoverability, reminders, and invite token state. Source: `src/app/users/[id]/page.tsx:97-124`, `src/app/users/[id]/page.tsx:126-159`, `src/app/users/[id]/page.tsx:189-220`.
- `/activities`, `/archive`, `/ceremony/[ceremonyId]`, `/share/ceremony/[token]`, `/verify-email`.
- Development/debug pages exist at `/dev/flags`, `/dev/loading-preview`, `/dev/noon-reset`, `/dev/points-diagnostic`, `/dev/reset-session`, `/dev/test-game`, and `/feed/debug/friend-coverage`. Several of these are visible placeholder pages. Source: `src/app/dev/flags/page.tsx:4-27`, `src/app/dev/reset-session/page.tsx:4-28`, `src/app/dev/noon-reset/page.tsx:4-28`, `src/app/dev/test-game/page.tsx:4-28`.

### API route surface found

- Account/auth/session: `/api/auth/request-otp`, `/api/auth/verify-otp`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/refresh-session`, `/api/auth/refresh-onboarding-claim`, plus account/profile/handle/email/discoverability/reminder/visibility/invite-token routes.
- Onboarding/interests: `/api/onboarding/propose-interests`, `/api/onboarding/canonicalize`, `/api/onboarding/save-interests`, `/api/interests/check`, `/api/interests/expand`, `/api/declared-interests`.
- Daily play: `/api/daily/queue`, `/api/daily/status`, `/api/daily/answer`, `/api/daily/skip`, `/api/daily/recheck`, `/api/daily/reset`, `/api/daily/summary`, `/api/daily/feedback`, `/api/daily/refine`, `/api/daily/preferences`, `/api/daily/preferences/add-domain`, and catch-up routes.
- Questions/bank/send/grading: `/api/questions`, `/api/questions/[id]`, `/api/questions/[id]/answer`, `/api/questions/[id]/rating`, `/api/questions/answered`, `/api/questions/critique`, `/api/questions/send`, `/api/questions/suggest`, `/api/questions/suggest-answer`, `/api/bank`, `/api/bank/check`, `/api/replay/grade`, `/api/replay/missed`.
- Feed/activity/reactions: `/api/feed`, per-feed-item answer/recheck/state/thumb routes, dismissed-domain routes, feed debug/backfill/friend-coverage routes, `/api/activities`, `/api/activities/read`, `/api/activities/opened`, `/api/reactions`, `/api/reactions/[id]/reply`. The feed HTTP handler is a thin wrapper around `getFeedPagePayload`, and the homepage server component calls the same payload builder. Source: `src/app/api/feed/route.ts:35-43`, `src/server/feed/get-feed-page.ts:1-8`, `src/app/page.tsx:153-171`.
- Friends/follows/invitations/contact discovery: `/api/friends`, `/api/friends/search`, `/api/friends/has-new-discovery`, `/api/friends/invite-reflections`, `/api/friend-requests`, per-request accept/cancel/ignore/remove routes, `/api/friend-invitations`, `/api/contact-hashes`, `/api/contact-hashes/matches`.
- Knowledge/profile/domain controls: `/api/knowledge`, `/api/knowledge/[domain]`, `/api/knowledge/converge`, `/api/knowledge/tidy`, `/api/users`, `/api/users/me`, `/api/users/recent`, user domain exclusion routes.
- Games/ceremony/archive/lately/telemetry/admin/cron/dev: `/api/joshing-games`, `/api/joshing-games/[id]`, `/api/joshing-games/[id]/answer`, ceremony routes, `/api/archive`, `/api/lately/milestone/answer`, `/api/telemetry`, `/api/admin/backfill-domains`, cron routes, and dev diagnostics.

### Data model map

The schema is Drizzle/Postgres. Core entities visible in `src/server/db/schema.ts`:

- Enums cover category, question visibility, trust tier, question scope, follow state/privacy, public status, answer source/status/type, grade dispute status, difficulty estimate, reactions, SMS message type, answer state, opt-ins, theme/subscription, mastery tiers/source types, domain exclusion scope, feedback signal, territory type, and profile sections. Source: `src/server/db/schema.ts:28-183`.
- Identity/session/auth: `users`, `userSessions`, `otpCodes`, `smsLogs`, `emailVerificationTokens`. Source: `src/server/db/schema.ts:189-270`, `src/server/db/schema.ts:532-562`.
- Questions and quality/interaction: `questions`, `questionAudienceTags`, `userQuestionBank`, `questionReactions`, `gradeDisputes`, `generatedQuestions`, `questionFeedback`, `questionRatings`. Source: `src/server/db/schema.ts:272-397`, `src/server/db/schema.ts:480-530`, `src/server/db/schema.ts:565-667`.
- Daily play/preferences/refinement: `dailyQueues`, `dailyPreferences`, `skippedDailyQuestions`, `userDomainDifficulties`, `userDomainExclusions`, `dailyRefineDecisions`. Source: `src/server/db/schema.ts:669-801`.
- Profile/interest/social graph: `profileSectionVisibility`, `profileDomainVisibility`, `declaredInterests`, legacy `friendships`, directional `follows`, `contactHashes`, `friendInvitations`. The schema comments say `follows` is the relationship read/write target while `friendships` is frozen for rollback. Source: `src/server/db/schema.ts:804-932`, `src/server/db/schema.ts:889-893`, `src/server/db/schema.ts:1080-1100`.
- Games/feed/ceremony/activity: `joshingGames`, `feedItems`, `joshingGameRecipients`, `joshingGameQuestions`, `joshingGameResponses`, `biweeklyCeremonies`, `activityItems`, `feedDismissedDomains`. Source: `src/server/db/schema.ts:932-1078`.
- Mastery/progression: `playerMastery`, `critiqueUsageDaily`, `masteryEvents`. Source: `src/server/db/schema.ts:400-478`.

### Current data-flow map

- DB initialization: `DATABASE_URL` → singleton `Pool` → Drizzle `db` → schema exports. Source: `src/server/db/index.ts:6-28`.
- Authenticated server render: page/layout calls session helpers → reads Drizzle query modules → passes hydrated props into client components. Home is the clearest example. Source: `src/app/page.tsx:23-71`, `src/app/page.tsx:74-171`.
- API route path: route handler calls `getSession()` → validates query/body → delegates to query/business modules → returns JSON. Feed shows this pattern. Source: `src/app/api/feed/route.ts:35-43`.
- Daily client path: `/daily` fetches `/api/daily/queue`, creates a queue if absent, retries transient generation failures, redirects no-knowledge users to setup, redirects completed queues to summary, and posts answers/rechecks. Source: `src/app/daily/page.tsx:180-260`, `src/app/daily/page.tsx:289-314`, `src/app/daily/page.tsx:472-520`.
- Onboarding path: server validates invite/session state and pre-seeds interests; client saves display name, handle, validates custom topics, saves interests, starts daily queue generation in the background, then navigates to `/daily`. Source: `src/app/onboarding/page.tsx:14-97`, `src/app/onboarding/OnboardingFlow.tsx:424-500`, `src/app/onboarding/OnboardingFlow.tsx:520-644`.

## Phase 2 — Backend / API / data findings

### Dev / architecture findings

#### P0 — Production login has no real OTP delivery path

- Files: `src/app/api/auth/request-otp/route.ts`, `src/server/auth/otp-store.ts`, `src/server/sms.ts`.
- What is wrong: `/api/auth/request-otp` creates an OTP with `requestOtp()` and only returns `debugCode` outside production. `requestOtp()` itself only deletes/inserts DB rows and returns the code; it never calls `sendSms()`. `sendSms()` exists and logs/sends Twilio SMS, but no auth request path calls it for `messageType='otp'`. In production, the response omits the code and no SMS is sent, so a real user cannot receive the code needed to log in. Source: `src/app/api/auth/request-otp/route.ts:61-67`, `src/app/api/auth/request-otp/route.ts:108-114`, `src/server/auth/otp-store.ts:22-31`, `src/server/sms.ts:18-44`.
- Severity: P0 blocks launch.

#### P0 — Hard-coded OTP bypass accepts `000000` with no environment guard

- Files: `src/server/auth/otp-store.ts`, `src/app/api/auth/verify-otp/route.ts`.
- What is wrong: `verifyOtp()` returns the normalized phone number immediately when the submitted code is `000000`. There is no `NODE_ENV`, feature flag, allowlist, or test-only guard. `verify-otp` then provisions or finds a user and creates a session from that verified phone path. Existing invited/onboarded users are therefore reachable by a universal static code. Source: `src/server/auth/otp-store.ts:34-39`, `src/app/api/auth/verify-otp/route.ts:118-156`, `src/app/api/auth/verify-otp/route.ts:200-238`.
- Severity: P0 blocks launch.

#### P0 — Cron/admin mutating routes become public when the secret is missing

- Files: `src/app/api/cron/daily-assignments/route.ts`, `src/app/api/cron/pool-refill/route.ts`, `src/app/api/cron/vet-questions/route.ts`, `src/app/api/cron/weekly-ceremony/route.ts`, `src/app/api/admin/backfill-domains/route.ts`.
- What is wrong: each `isAuthorized()` helper returns `true` if `CRON_SECRET`/`VERCEL_CRON_SECRET` is unset. These endpoints mutate or trigger expensive system work: daily queue generation and SMS, retrieval pool refill, question vetting, ceremony firing, and domain backfills. A single missing environment variable flips them from protected to public. Source: `src/app/api/cron/daily-assignments/route.ts:40-45`, `src/app/api/cron/daily-assignments/route.ts:47-126`, `src/app/api/cron/pool-refill/route.ts:14-24`, `src/app/api/cron/pool-refill/route.ts:37-56`, `src/app/api/cron/vet-questions/route.ts:18-23`, `src/app/api/cron/vet-questions/route.ts:31-110`, `src/app/api/cron/weekly-ceremony/route.ts:17-23`, `src/app/api/cron/weekly-ceremony/route.ts:31-95`, `src/app/api/admin/backfill-domains/route.ts:9-17`, `src/app/api/admin/backfill-domains/route.ts:26-81`.
- Severity: P0 blocks launch.

#### P1 — Verification gates exist but serving enforcement is off by default

- Files: `src/server/daily/verification-gating.ts`, `src/server/db/queries/daily.ts`, `src/server/daily/generate-questions.ts`, `src/server/daily/ask-to-answer.ts`.
- What is wrong: the trust-tier gate is explicitly off by default (`VERIFICATION_TIER_GATING_ENABLED` fallback `false`) and `applyTierGate()` returns all rows while shadowing. That means self-practice bank rows below `machine_verified` and friend-facing authored/house rows below `human_validated`/`author_confirmed` still serve unless an operator flips an env var. The generated-question pipeline also fails open for quality/factual/ask-to-answer LLM outages, leaving rows unverified rather than blocking them. This is a coherent staged implementation, but it is not a clean production quality floor yet. Source: `src/server/daily/verification-gating.ts:20-23`, `src/server/daily/verification-gating.ts:56-83`, `src/server/db/queries/daily.ts:1012-1019`, `src/server/db/queries/daily.ts:1472-1480`, `src/server/daily/generate-questions.ts:622-628`, `src/server/daily/generate-questions.ts:715-722`, `src/server/daily/ask-to-answer.ts:164-180`, `src/server/daily/ask-to-answer.ts:223-229`.
- Severity: P1 hurts core experience.

#### P1 — Question creation treats optional enrichment failure as save failure

- Files: `src/app/api/questions/route.ts`.
- What is wrong: the create route runs difficulty assessment, inside-joke generation, and vetting in one `Promise.all`. Any rejection from that bundle returns a 500 “Something went wrong saving that question.” The comments call vet failure “non-fatal” and the product can tolerate missing inside jokes/difficulty, but the implementation makes any one enrichment outage block authoring entirely. Source: `src/app/api/questions/route.ts:150-181`, `src/app/api/questions/route.ts:182-191`.
- Severity: P1 hurts core experience.

#### P2 — Daily status logic is duplicated between home and API

- Files: `src/app/page.tsx`, `src/app/api/daily/status/route.ts`.
- What is wrong: home builds a `DailyStatus` snapshot locally while `/api/daily/status` builds the same completion/slot-outcome semantics independently. The home implementation even documents that it mirrors the API predicate. Any future change to “complete,” skipped slots, or slot outcome shape has to be made twice or home and API drift. Source: `src/app/page.tsx:109-171`, `src/app/api/daily/status/route.ts:17-29`, `src/app/api/daily/status/route.ts:61-89`.
- Severity: P2 quality.

#### P2 — Dev placeholder pages ship in the route tree

- Files: `src/app/dev/flags/page.tsx`, `src/app/dev/reset-session/page.tsx`, `src/app/dev/noon-reset/page.tsx`, `src/app/dev/test-game/page.tsx`.
- What is wrong: several `/dev/*` pages render unauthenticated-looking “Coming soon” placeholders with “Back” links to `/users/me`. They are not mutating, but they are live product routes that present unfinished tooling rather than being hidden, gated, or removed. Source: `src/app/dev/flags/page.tsx:4-27`, `src/app/dev/reset-session/page.tsx:4-28`, `src/app/dev/noon-reset/page.tsx:4-28`, `src/app/dev/test-game/page.tsx:4-28`.
- Severity: P2 quality.

### Backend positives observed

- Grading generally fails toward the player in live answer routes: `gradeAnswer()` returns `unscored` on LLM failure, and Daily/Feed answer routes return retryable 503s rather than persisting wrong verdicts. Source: `src/server/grading.ts:28-38`, `src/server/grading.ts:79-105`, `src/app/api/daily/answer/route.ts:224-254`, `src/app/api/feed/[feedItemId]/answer/route.ts:97-113`.
- The daily queue orchestrator has real top-up, dedup, and graceful shortfall logic rather than a single brittle generation pass. Source: `src/server/daily/queue-orchestrator.ts:42-75`, `src/server/daily/queue-orchestrator.ts:192-239`, `src/server/daily/queue-orchestrator.ts:239-380`.

## Phase 3 — UX flows & state findings

### UX findings

#### P1 — Incoming/outbound follow requests are fetched but never rendered in the Friends hub

- Files: `src/server/db/queries/friends.ts`, `src/app/api/friends/route.ts`, `src/components/FriendsList.tsx`.
- What is wrong: `getFriendsHub()` returns `following`, `followers`, `incomingRequests`, and `outboundRequests`. The client `FriendsList` stores only `following`, `followers`, and SMS `invites`; it never stores or renders `incomingRequests`/`outboundRequests`. It then renders only mutual people (`youFollow && followsYou`) as “Friends.” Result: follow requests can exist in the API with accept/cancel routes elsewhere, but this main hub gives users no obvious place to see or act on them. Source: `src/server/db/queries/friends.ts:233-278`, `src/server/db/queries/friends.ts:334-363`, `src/app/api/friends/route.ts:8-14`, `src/components/FriendsList.tsx:190-220`, `src/components/FriendsList.tsx:270-279`, `src/components/FriendsList.tsx:333-382`.
- Severity: P1 hurts core experience.

#### P1 — “Send to specific friends only” can save/send to nobody

- Files: `src/components/QuestionForm.tsx`.
- What is wrong: the composer lets users enable “Send to specific friends only,” clears selected friend IDs when toggled on, and validates only an upper bound of 20 selected friends. `finalSave()` sends `sendToFriendIds: []` when specific mode is enabled with no selections. The UI copy says “Sent directly to the friends you pick,” but there is no validation that the user picked anyone. This is a core send-a-question dead end: a user can think they are sending something directly and actually save it to no recipient. Source: `src/components/QuestionForm.tsx:170-188`, `src/components/QuestionForm.tsx:230-241`, `src/components/QuestionForm.tsx:445-465`, `src/components/QuestionForm.tsx:660-690`, `src/components/QuestionForm.tsx:753-759`.
- Severity: P1 hurts core experience.

#### P2 — Feed empty-state copy is computed but bypassed in the real empty render

- Files: `src/components/FeedList.tsx`.
- What is wrong: `emptyCopy` distinguishes loading, errors, sent-to-me empty state, no-friends state, domain-filtered state, all-caught-up state, and quiet state. In the actual non-loading/non-error empty render, the component ignores that copy and always renders “Questions from friends” + “You are all caught up!” with an optional add-friends link. This collapses materially different states — no one sent you a question, no friends, domain filters hid items, or genuinely caught up — into the same message. Source: `src/components/FeedList.tsx:824-846`, `src/components/FeedList.tsx:1308-1352`.
- Severity: P2 quality.

#### P2 — Main Friends page is invite-first but has no visible path to find existing users

- Files: `src/components/FriendsHubPage.tsx`, `src/app/friends/find/page.tsx`, `src/components/friends/FindFriendsSearch.tsx`.
- What is wrong: `/friends` renders an invite hero, `AddFriendInvite`, and `FriendsList`; it does not link to `/friends/find`. The search UI exists and supports exact handle/phone lookup, but it is stranded on a separate page unless another navigation path exposes it. The main “play with people you care about” hub pushes phone invites and hides existing-user discovery. Source: `src/components/FriendsHubPage.tsx:11-38`, `src/app/friends/find/page.tsx:1-120`, `src/components/friends/FindFriendsSearch.tsx:106-164`.
- Severity: P2 quality.

#### P2 — Friendless composer states say “No friends found” but do not route to inviting

- Files: `src/components/QuestionForm.tsx`.
- What is wrong: when direct-send mode is enabled and the friend list is empty, the composer shows only “No friends found.” It does not provide an inline invite CTA or a link to the friend/invite flow, so the user hits a dead end inside the exact moment they are trying to create a connection. Source: `src/components/QuestionForm.tsx:660-690`, `src/components/QuestionForm.tsx:713-748`.
- Severity: P2 quality.

### UX positives observed

- Onboarding has real error/loading states, invite pre-seeding, custom topic validation, and a background daily-queue kick before navigating into play. Source: `src/app/onboarding/page.tsx:53-97`, `src/app/onboarding/OnboardingFlow.tsx:424-500`, `src/app/onboarding/OnboardingFlow.tsx:587-644`, `src/app/onboarding/OnboardingFlow.tsx:652-665`.
- Daily play handles no-knowledge setup redirects, transient queue generation retry/backoff, completed-round redirects, grader unavailable messaging, and recheck states. Source: `src/app/daily/page.tsx:93-109`, `src/app/daily/page.tsx:180-260`, `src/app/daily/page.tsx:289-314`, `src/app/daily/page.tsx:472-520`.
- The authored question page has loading, error, empty, filtered-empty, and answered-tab states. Source: `src/app/questions/page.tsx:103-119`, `src/app/questions/page.tsx:332-342`, `src/app/questions/page.tsx:426-442`, `src/app/questions/page.tsx:466-480`.

## Phase 4 — Visual system coherence findings

### Visual findings

#### P1 — The lint-enforced visual token rule still reports 43 off-system color warnings

- Files: many; examples include `src/components/LoadingScreen.tsx`, `src/components/QuestionForm.tsx`, `src/components/TodaysFiveCard.tsx`, `src/components/replay/ReplaySummary.tsx`, `src/components/profile/InlineHandleField.tsx`.
- What is wrong: the repo has an ESLint rule specifically warning against off-system colors in className. `npm run lint` passes only because the configured ceiling is `--max-warnings 44`; current output reports 43 warnings. This is almost exactly at the warning budget and shows the visual system still has broad palette drift. Source: `package.json:13`, lint output from `npm run lint`, `src/app/globals.css:55-102`.
- Severity: P1 hurts core consistency.

#### P2 — Loading screen duplicates palette/colors/shadows outside the root token path

- Files: `src/components/LoadingScreen.tsx`, `src/app/globals.css`.
- What is wrong: root tokens define triangle and brand colors, but `LoadingScreen` keeps its own uppercase hex `PALETTE`, uses hard-coded background/card/divider colors, and uses an arbitrary shadow. Some values correspond to tokens, but the component re-declares them and introduces `#E8DCC0`, `#F5EBD3`, and `#1a1208` directly. Source: `src/app/globals.css:61-82`, `src/components/LoadingScreen.tsx:16-23`, `src/components/LoadingScreen.tsx:100-105`, `src/components/LoadingScreen.tsx:150-155`.
- Severity: P2 quality.

#### P2 — Warm/brand registers coexist across knowledge/setup surfaces without a clear component boundary

- Files: `src/app/globals.css`, `src/app/knowledge/page.tsx`, `src/app/daily/setup/TerritorySetupClient.tsx`.
- What is wrong: globals defines brand tokens and then a separate warm-brown ink/paper ramp. The knowledge page and Daily setup mix `--brand-ink`, `--ink`, `--text-muted-warm`, `--cream`, `--cream-accent`, `bg-white`, and raw `#111111`/rgba values in adjacent sections. The result is not a single coherent “brand” vs “warm portrait” boundary; the registers bleed within the same surfaces. Source: `src/app/globals.css:148-178`, `src/app/knowledge/page.tsx:540-555`, `src/app/knowledge/page.tsx:587-599`, `src/app/daily/setup/TerritorySetupClient.tsx:508-536`, `src/app/daily/setup/TerritorySetupClient.tsx:647-679`, `src/app/daily/setup/TerritorySetupClient.tsx:760-768`.
- Severity: P2 quality.

#### P2 — Bespoke visual primitives bypass reusable card/radius/shadow patterns

- Files: `src/components/OverlapMap.tsx`, `src/components/FriendsHubPage.tsx`, `src/app/daily/setup/TerritorySetupClient.tsx`.
- What is wrong: the design system exposes semantic card colors/radii/shadows, and many components use `bg-card rounded-* border shadow-sm`. But key surfaces still define one-off primitives: `OverlapMap` uses inline `2px` black border, `6px 6px 0` shadow, and `borderRadius: 0`; Friends hero uses `rounded-[2rem]`; Daily setup zones and dialogs use `rounded-[2rem]`, `rounded-[1.75rem]`, and custom large rgba shadows. These may be intentional individually, but collectively they fragment card tiers and shadow tiers. Source: `src/app/globals.css:179-182`, `src/components/OverlapMap.tsx:31-38`, `src/components/FriendsHubPage.tsx:17-34`, `src/app/daily/setup/TerritorySetupClient.tsx:647-655`, `src/app/daily/setup/TerritorySetupClient.tsx:760-768`.
- Severity: P2 quality.

#### P3 — Domain/icon visuals still use hard-coded token-equivalent hex values

- Files: `src/components/knowledge/DomainCircle.tsx`, `src/components/feed/visual.ts`, `src/components/lately/tokens.ts`.
- What is wrong: several files use hex values that duplicate tokens (`#0a1f3d`, `#8a8a8a`, `#1f3a5a`, `#d15e36`, etc.) rather than importing/using CSS variables. Some are commented as token-equivalent, but they still create second sources of truth. Source: `src/components/knowledge/DomainCircle.tsx:125-140`, `src/components/knowledge/DomainCircle.tsx:174-205`, `src/components/feed/visual.ts:3-20`, `src/components/lately/tokens.ts:1-10`.
- Severity: P3 nice-to-have.

## Phase 5 — Synthesis

### Honest stock-take

The product has a substantial, real system behind it: the App Router structure is coherent, the Drizzle schema is broad and current, daily play has serious retry/dedup/grading work, and the main data paths are not stubs. The fragile parts are launch-critical operational seams: OTP delivery/bypass, cron/admin authorization-by-misconfiguration, and verification gates that exist but are not enforced by default. The core social thesis is present in data and UI, but the Friends hub and send-to-specific flow have dead ends that can prevent connection from actually happening. Visually, the brand token foundation is documented and enforced by lint, but the codebase is still one warning away from the current lint ceiling and several high-traffic surfaces reintroduce bespoke palettes/shadows/radii.

### Prioritized prompt backlog

1. `B-AUTH-OTP-01 — Production OTP delivery and bypass removal` — resolves P0 “Production login has no real OTP delivery path” and P0 “Hard-coded OTP bypass accepts 000000.”
2. `B-OPS-GATES-01 — Fail-closed cron/admin authorization` — resolves P0 “Cron/admin mutating routes become public when the secret is missing.”
3. `B-QUESTION-CREATE-RESILIENCE-01 — Decouple optional enrichment from save-critical question creation` — resolves P1 “Question creation treats optional enrichment failure as save failure.”
4. `B-VERIFY-ENFORCEMENT-01 — Make verification tier enforcement launch-ready with explicit pool health gate` — resolves P1 “Verification gates exist but serving enforcement is off by default.”
5. `B-FRIENDS-HUB-REQUESTS-01 — Render incoming/outbound follow requests in Friends hub` — resolves P1 “Incoming/outbound follow requests are fetched but never rendered.”
6. `B-SEND-SPECIFIC-VALIDATION-01 — Require at least one recipient or route to invite in specific-send mode` — resolves P1 “Send to specific friends only can save/send to nobody” and P2 “Friendless composer states say No friends found but do not route to inviting.”
7. `B-FEED-EMPTY-STATES-01 — Wire feed empty states to actual feed surface/meta state` — resolves P2 “Feed empty-state copy is computed but bypassed.”
8. `B-FRIENDS-DISCOVERY-ENTRY-01 — Add existing-user search entry point to main Friends hub` — resolves P2 “Main Friends page is invite-first but has no visible path to find existing users.”
9. `B-DAILY-STATUS-SINGLE-SOURCE-01 — Extract shared Daily status snapshot builder` — resolves P2 “Daily status logic is duplicated between home and API.”
10. `B-DEV-ROUTES-GATE-01 — Hide or gate dev placeholder routes` — resolves P2 “Dev placeholder pages ship in the route tree.”
11. `B-VISUAL-TOKEN-BUDGET-01 — Burn down off-system color lint warnings below zero` — resolves P1 “lint-enforced visual token rule still reports 43 off-system color warnings,” P2 “Loading screen duplicates palette/colors/shadows,” and P3 “Domain/icon visuals use token-equivalent hex values.”
12. `B-VISUAL-CARD-TIERS-01 — Normalize card/radius/shadow tiers across Friends, setup, overlap, replay` — resolves P2 “Warm/brand registers coexist without a clear boundary” and P2 “Bespoke visual primitives bypass reusable card/radius/shadow patterns.”

## Read-only checks run

- `npm run lint` — passed with 43 warnings under the configured `--max-warnings 44` ceiling. The warnings are visual-token warnings and are captured above as a finding.
- `npx tsc --noEmit -p tsconfig.typecheck.json` — passed.
