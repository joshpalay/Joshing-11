# Joshing Codebase Alignment Audit — PRD 11.1 — Rerun

Date: 2026-05-08
Auditor: Codex
Status: **Rerun / supersedes the previous audit draft**
Scope: architectural, gameplay, UX, data-model, terminology, and product-philosophy alignment against PRD 11.1.

> This rerun is deliberately more skeptical than the prior audit. The previous version correctly identified many drift areas, but it underweighted several hard contradictions: mastery thresholds are not PRD-canonical, Daily answer state is not normalized, the Knowledge page violates the declared-interest placement requirement, and summary surfaces repeatedly convert reflection into scorekeeping.

---

## 1. Executive Summary

### Overall alignment score: **54 / 100**

The codebase contains many PRD 11.1-shaped systems, but the product is not yet behaviorally aligned with PRD 11.1. The strongest implementation work is around the chat-first Daily Five, friend-answer Feed propagation, onboarding cultural anchors, Knowledge-map visualization, and Joshing Game play. The weakest areas are the emotional/product layer around those systems: summaries, progression display, Knowledge page responsibility, and legacy data architecture still pull the app toward dashboards, scorekeeping, and older group-game mental models.

The app currently feels like two products stitched together:

1. **A newer PRD 11.1 product**: Daily Five, Feed, Knowledge portrait, friend-propagated questions, ceremony, direct send, Joshing Games.
2. **A legacy v10/v11.0 product shell**: group-game schema, score tables, point-forward summaries, star/compatibility remnants, archive dashboards, duplicate schema systems, and JSON-backed gameplay state.

### Biggest strengths

- **Daily Five play is directionally conversation-first.** `/daily` uses a narrow chat thread, one active question, one answer composer, no visible countdown, and quiet sequential reveal.
- **Feed propagation mostly follows v11.1.** `createFeedItemsForFriendsFromAnswer` propagates answered questions by friendship, blocks thumbs-down propagation, respects dismissed domains, and uses `friend_answered` rather than the killed `authored_shared` application source.
- **Joshing Games exist and use the chat mechanic.** `/games/[id]` plays as a compact sequential chat thread and game cards are pinned in the Feed.
- **The Knowledge map has the right ingredients.** It has domain tiers, portrait/circle components, dismissed-domain re-open, a Grow your map explainer, and share portrait scaffolding.
- **Onboarding now has the required cultural anchor data path.** Drizzle `users` includes `birth_year`, `grew_up_country`, and `grew_up_region`; onboarding proposal/canonicalization/save routes exist.
- **Ceremony infrastructure exists.** Biweekly ceremony tables, banner route, viewed route, share token route, share page, compute/fire services, and related tests exist.

### Biggest product risks

1. **Progression math is not canonical.** PRD11 states Establishing 0, Familiar 50, Solid 200, Mastery 500 + creator rule. Code uses 0 / 500 / 1500 / 3500. This is not a display preference; it changes player progression pacing by an order of magnitude.
2. **The product still teaches users to care about points.** Daily summary, Feed answers, Game summaries, Knowledge card signatures, catch-up copy, archive filters, and group-progress tables expose raw score/point language.
3. **The Knowledge page violates page responsibility.** It is trying to be identity portrait, progression visualization, share surface, Feed settings, map maintenance, Daily setup, declared-interest manager, send/write launcher, and modal host.
4. **The Daily and Joshing Game summaries contradict reflection-first UX.** They lead with “How You Did,” `+points`, `X/Y correct`, red wrong pills, and score tables instead of narrative discovery.
5. **The schema has two incompatible product histories.** Prisma retains group game / DailyAssignment / StarVote / CompatibilityScore / timer-era tables; Drizzle contains the active v11.1 layer. There is no single clean domain model.
6. **Core gameplay answer state is embedded in JSON.** `DailyQueue.slots` stores answer result, submitted text, reveal state, points, skip/dismiss state, breadcrumb, and quip. This makes lifecycle, ceremony, archive, and mastery difficult to reason about.
7. **Invitation-only intimacy is under-realized.** Friend invitation tables exist, but route structure does not make invitation acceptance and pre-seeded interest context obviously first-class.

### Biggest architecture risks

- **Dual schema drift:** `prisma/schema.prisma` and `src/server/db/schema.ts` disagree materially. Prisma still looks like a private-group MVP; Drizzle looks like the active v11.1 app.
- **Generated question identity split:** Daily questions begin as `GeneratedQuestion`, are answered from JSON slots, then may be persisted to canonical `Question` later for Feed propagation. This creates two IDs for one product moment.
- **Mastery writes are fragile:** `writeMasteryEvent` maps high-level source strings into enum source types, uses synthetic `answerId` strings, and often passes `eventQuestionId: null` for generated questions.
- **Old scoring artifacts remain executable or visible:** score percent, points, correct counts, `Y/N` table cells, timer fields, stars, compatibility, and group-season language remain in schema/UI.
- **Feature flags are implicit.** Legacy behavior is controlled by orphaned tables/components and route absence, not a typed feature-flag system.

### Most urgent fixes

1. **Fix mastery thresholds and progression copy** to match PRD11 before more data accumulates.
2. **Redesign Daily and Joshing Game summaries** around reflection/story, not scorecards.
3. **Split Knowledge responsibilities**: Knowledge = portrait/map + Grow your map; Account = manage interests; Feed settings = hidden/dismissed domains; admin/internal = tidy.
4. **Normalize play answers** or introduce a unified `PlayAnswer` / `DailyAnswer` model. Stop making `DailyQueue.slots` the durable answer source.
5. **Choose one schema source of truth** and quarantine/remove old Prisma group-game/star/timer/compatibility concepts.
6. **Add database constraints** for Feed idempotency and active dismissed-domain uniqueness.
7. **Reframe catch-up and Feed answer UI** so discovery, not discounted points, is the visible product story.

---

## 2. Product Philosophy Alignment

### Summary verdict

The app implements several PRD 11.1 mechanics, but the emotional product still too often feels like a score-tracking trivia app. PRD 11.1 is about identity, specificity, social connection, and quiet reflection. The current build often shows the user numeric correctness, points, tables, filters, and maintenance controls before it shows them what the moment means.

### Principle-by-principle audit

| Principle | Status | Where it succeeds | Where it contradicts PRD / hidden anti-patterns | Offending / relevant files |
|---|---:|---|---|---|
| Shared knowledge creates connection | Partial | Feed propagation is friend-answer based; direct sends are pinned; reactions and creator notes exist; Joshing Games are sent by friends. | Game summaries turn shared play into scores and `Y/N` tables; Home copy says “build your knowledge map” more than “friends shaped your map”; invitation context is not prominent. | `src/server/feed/create-feed-items-for-answer.ts`; `src/components/FeedList.tsx`; `src/app/games/[id]/summary/page.tsx`; `src/app/page.tsx` |
| Wrong answers are discovery | Partial | Daily wrong copy is mostly gentle; wrong answers do not subtract points; creator notes after wrong answers can create conversation. | Summary labels say `WRONG` in red; Feed says “Not quite”; summaries expose correct/wrong counts; group table marks `Y/N`; archive filters by incorrect. | `src/app/daily/summary/page.tsx`; `src/app/games/[id]/summary/page.tsx`; `src/app/archive/page.tsx`; `src/components/FeedList.tsx` |
| Identity over competition | Weak | Knowledge portrait and tier labels exist; Ceremony exists; profiles/portrait work gesture toward identity. | Raw point totals, `+points`, `X/Y correct`, score tables, correct rates, and compatibility remnants dominate multiple surfaces. | `src/app/daily/summary/page.tsx`; `src/app/games/[id]/summary/page.tsx`; `src/app/knowledge/page.tsx`; `prisma/schema.prisma` |
| Human-authored questions only | Ambiguous / conflict | The prompt lists this as philosophy, but PRD11/v11.1 explicitly says LLM-generated Daily Five is core. Authored questions and creator notes exist. | If the prompt is a newer source than PRD11, Daily generation is a major contradiction. If PRD11 wins, LLM generation is intended but should be human-calibrated by interests/friends. | `_docs/PRD11.md`; `_docs/PRD-v11.1.md`; `src/server/daily/generate-questions.ts` |
| Invitation-only intimacy | Partial | `FriendInvitation` stores inviter, invitee phone, pre-seeded interests, personal message, token, expiry. | No obvious top-level invitation acceptance route in current route inventory; onboarding may behave like generic setup if invitation context is not carried. | `src/server/db/schema.ts`; `src/app/onboarding/*`; `src/app/api/onboarding/*` |
| Conversation-first UX | Partial | Daily and Joshing Game play use `GameplayChatThread`; answer flow is sequential. | Feed cards, Knowledge page, Archive, summaries, Account/settings, and game summary are dashboard/admin surfaces. | `src/components/play/GameplayChat.tsx`; `src/components/FeedList.tsx`; `src/app/knowledge/page.tsx`; `src/app/archive/page.tsx` |
| Specificity over generic categories | Partial | `canonicalSubcategory` is widely used; LLM prompt instructs work/artist/period-level specificity; onboarding proposes specific domains. | Prisma retains broad enum `Category`; UI frequently shows broad categories/difficulty badges; map tidy is exposed as maintenance instead of quiet correction. | `src/server/daily/generate-questions.ts`; `prisma/schema.prisma`; `src/app/knowledge/page.tsx` |
| Discovery over domination | Weak/partial | Feed is bounded; catch-up exists; no visible timer. | Score and points remain central; game summary “How Everyone Did” behaves like mini-leaderboard; catch-up advertises 0.25x points. | `src/app/page.tsx`; `src/app/games/[id]/summary/page.tsx`; `src/app/daily/summary/page.tsx` |
| Reflection over dashboards | Weak | Ceremony and Knowledge portrait exist. | Daily summary, Game summary, Archive, and Knowledge page all use dashboard patterns. Ceremony is not yet the singular reflective peak. | `src/server/ceremony/*`; `src/app/ceremony/[ceremonyId]/page.tsx`; summary/archive/knowledge pages |

### Philosophy blockers

1. **Point-first progression is the largest product contradiction.** The app can compute points internally, but users should not be taught that points are the product.
2. **The wrong-answer treatment is inconsistent.** Gameplay copy is gentle; summary/archive labels are punitive.
3. **The product says “conversation,” but post-play says “report card.”** This breaks the intended emotional arc.
4. **The Knowledge page says “identity” while exposing admin controls.** That weakens the “Your Mind” metaphor.

---

## 3. Route + UX Architecture Map

### Primary navigation

Current nav items are Home, Friends, Knowledge, Activities, Account. PRD v11.1 expects Home, Feed, Knowledge, Activities, Account. The route is `/feed`, but the nav label is **Friends**, which is product-language drift: the surface is conceptually Feed, not a generic Friends tab.

### Page routes and responsibility audit

| Route | Current responsibility | Intended PRD 11.1 responsibility | Alignment | UX issues | Restructure recommendation |
|---|---|---|---:|---|---|
| `/` | Home with Daily card, embedded Feed preview, catch-up card. | Quiet home with Daily entry and small Feed indicator. | Partial | More than one primary action; embedded FeedList makes Home a mini-dashboard; catch-up copy foregrounds point discount. | Make Daily the primary CTA. Replace embedded Feed cards with quiet “N new in Feed.” Hide catch-up multiplier. |
| `/feed` | Feed stream with ceremony banner and Feed cards. | Top-level bounded stream of friends' answered questions. | Mostly | Too many simultaneous actions on cards; nav label says Friends. | Rename nav label to Feed. Use progressive disclosure: Answer primary, secondary actions behind menu. |
| `/daily` | Chat-thread Daily Five. | Primary daily gameplay. | Mostly | Difficulty badges and progress dots add evaluation tone; skip/catch-up relationship is not emotionally clear. | Keep chat. Soften badges; add “why this question” or “from your map” context. |
| `/daily/setup` | Daily preference configuration. | Setup/preferences only when needed. | Partial | Feels like settings for a game engine. | Move persistent preferences to Account; show setup only as guided unblocker. |
| `/daily/catchup` | Catch-up play for previous slots. | Low-pressure recovery. | Partial | Product copy exposes reduced points. | Reframe as “questions you missed”; make point discount invisible or tertiary. |
| `/daily/summary` | Points-first result report. | Score line + delayed interpretive line; quiet reflection. | Weak | “How You Did,” `+points`, `X/Y correct`, red wrong pills, action row on each card. | Make summary a reflective close. Move detailed review behind one CTA. |
| `/knowledge` | Identity portrait + progression + share + grow + hidden domains + tidy + manage interests + write/send modals. | Knowledge portrait/map + Grow your map. | Partial/weak | Severely overloaded; PRD explicitly moves declared-interest swap to Account. | Split page responsibilities. Knowledge should not host declared-interest manager or tidy admin. |
| `/knowledge/[domain]` | Domain detail. | Domain-specific reflection/detail. | Partial / needs deeper UX pass | Likely raw stats/detail risk. | Make it narrative: recent moments, source friends, what this domain means, next gentle action. |
| `/questions` | Question bank / authored question management. | Your authored/saved questions. | Partial | Risks database/table feel. | Reframe as “Questions you’ve kept/written,” with send/write as relational acts. |
| `/archive` | Filterable archive by source/domain/result/search. | Personal review archive. | Partial/weak | Admin log; correctness filters reinforce evaluation. | Rename/reframe as “Questions you’ve met.” Soften result filtering. |
| `/replay` | Replay missed questions. | Review/replay. | Partial | Can become study-drill product. | Make replay optional, conversation-like, and discovery-framed. |
| `/new-game` | Joshing Game composer. | Make a 1–5 question friend game. | Partial | Needs recipient/story framing. | Title + recipients + questions + one send CTA; reduce configuration feel. |
| `/games/[id]` | Joshing Game play. | Chat thread, no timer/expiry. | Mostly | Header `N of M` and no skip are mechanical but acceptable. | Add “From [friend]” and why this game exists. |
| `/games/[id]/summary` | Score summary + recap + impact + group table. | Story / Your Game / What You Discovered / How Everyone Did. | Weak | Table-first, score-forward, competition-adjacent. | Rebuild in PRD section order with story cards instead of matrix. |
| `/ceremony/[ceremonyId]` | Ceremony detail. | Biweekly reflective ceremony. | Partial | Needs visual/beat pass; risks another report if built from stats. | Make ceremony the only “big reflection” and reduce daily/game summaries. |
| `/share/ceremony/[token]` | Ceremony share page. | Shareable reflection. | Partial | Requires privacy/expiry review. | Ensure no raw rankings or private friend details leak. |
| `/activities` | Activity feed and social moments. | Reverse-chronological social moments. | Mostly | Risk of notification-center feel. | Prioritize human copy and reply affordances over status logs. |
| `/creator-notes/new` | Creator note form. | Short relational note after answer moments. | Partial | Standalone form may lack context. | Prefer inline/contextual note prompts. |
| `/account` | Account/settings. | Account, SMS, manage interests. | Partial | Manage interests still lives in Knowledge too. | Account should own Manage interests. |
| `/onboarding` | Interest declaration flow. | Four-step v11.1 onboarding. | Mostly by schema/routes | Pre-seeded invitation route/context unclear. | Ensure invitation context is the first emotional frame. |
| `/login` | Auth. | Phone/auth entry. | Not product-critical | None major from PRD audit. | Keep minimal. |

### API route map by responsibility

- **Auth/account**: `/api/auth/*`, `/api/account/*`, `/api/users`.
- **Onboarding/interests**: `/api/onboarding/canonicalize`, `/api/onboarding/propose-interests`, `/api/onboarding/save-interests`, `/api/declared-interests`.
- **Daily/catch-up**: `/api/daily/status`, `/api/daily/queue`, `/api/daily/answer`, `/api/daily/skip`, `/api/daily/summary`, `/api/daily/catchup/*`, `/api/daily/preferences`, `/api/daily/reset`, cron daily assignments.
- **Feed/social**: `/api/feed`, `/api/feed/[feedItemId]/answer`, `/state`, `/thumbsup`, `/thumbsdown`, `/dismiss-domain`, `/dismissed-domains`.
- **Questions/bank**: `/api/questions`, `/api/questions/send`, `/api/questions/suggest`, `/api/questions/suggest-answer`, `/api/questions/[id]`, `/api/questions/[id]/rating`, `/api/bank/*`.
- **Knowledge**: `/api/knowledge`, `/api/knowledge/[domain]`, `/api/knowledge/tidy`, `/api/admin/backfill-domains`.
- **Joshing Games**: `/api/joshing-games`, `/api/joshing-games/[id]`, `/api/joshing-games/[id]/answer`.
- **Ceremony**: `/api/ceremony/banner`, `/api/ceremony/[ceremonyId]`, `/viewed`, `/share-token`, `/api/share/ceremony/[token]`, cron biweekly ceremony.
- **Reactions/creator notes/activities/archive/replay**: `/api/reactions/*`, `/api/creator-notes/*`, `/api/activities/*`, `/api/archive`, `/api/replay/*`.

### Overloaded / duplicate responsibilities

- **Knowledge vs Account**: declared-interest management belongs in Account but is still in Knowledge.
- **Summary vs Ceremony**: both try to be reflective; summaries should be much quieter so ceremony can own reflection.
- **Archive vs Summary vs Replay**: all expose post-answer review; the distinction is unclear.
- **Feed vs Activities**: Feed is playable social stream; Activities is social record. This is conceptually sound, but activity copy must avoid log/dashboard tone.

---

## 4. Gameplay Lifecycle Audit

### A. Invitation → onboarding

**Actual behavior / implementation signals**

- `FriendInvitation` exists with inviter, invitee phone, invitee user, pre-seeded interests, personal message, token, sent/accepted/expiry fields.
- Onboarding has page and API routes for proposal, canonicalization, and saving interests.
- User schema contains birth year and grew-up geography fields.

**Intended behavior**

- Invitation is a gift from a known person.
- Pre-seeded interests, if present, are shown first.
- Birth year + geography generate culturally anchored candidate domains.
- Warm-up answers produce hyper-specific territory candidates.
- Player picks up to five.

**Alignment**: Partial / mostly built but emotional routing uncertain.

**Risks**

- No obvious `/invite/[token]` or similar page route in current route inventory.
- If invite context is only stored but not foregrounded, onboarding becomes generic setup.
- Pre-seeded interests must count toward the 5-interest cap and be editable; this needs explicit route-level verification.

### B. Onboarding → first Daily Five

**Actual**

- `fillDailyQueueForUser` requires Knowledge Base entries and generates a 5-question queue.
- Daily setup redirect occurs if no queue/status is available.

**Intended**

- After onboarding, the first Daily Five should feel promised and personal.

**Risks**

- Generation failure copy is operational (“taking longer than usual”) rather than ceremonial.
- Daily setup/preferences can interrupt first-run emotional momentum.

### C. Daily Five session

**Actual**

- `/daily` renders a chat thread and sticky answer composer.
- Questions are sequential; one current slot is shown.
- Answers call `/api/daily/answer`; skips call `/api/daily/skip`.
- Completion redirects to `/daily/summary`.

**Intended**

- Chat-thread Daily Five, no timer, per-answer quip, quiet close.

**Alignment**: Mostly on interaction, weaker on emotional finish.

**Hidden bugs / friction**

- Skip limit comment says capped at 3, but `DAILY_SKIP_LIMIT = 5`. That is a direct code/comment/behavior contradiction.
- Difficulty badges are visible; they can make the player feel evaluated before answering.
- Summary redirect moves from conversation into report-card mode.

### D. Feed play

**Actual**

- Feed answer route grades inline, writes Feed item state to `answered`, writes mastery for first corrects, updates question asked/correct counts, promotes author territory when a non-author answers correctly, propagates answer to the answerer’s friends, and can prompt creator notes after wrong answers.

**Intended**

- Living Feed cards; answer inline; friend comparison; reactions; full mastery credit for correct Feed answers.

**Alignment**: Mostly.

**Risks**

- Feed item uniqueness is app-enforced, not DB-enforced.
- The Feed action surface is crowded.
- Correctly answered Feed items are set to `answered`, but PRD says once correctly answered it should be gone; the UI must ensure it does not continue to surface as a score artifact.

### E. Catch-up

**Actual**

- Catch-up looks back seven days.
- Correct catch-up answers award 0.25x base points.
- Home displays “Catch up - 0.25x points.”
- Boundary helpers disagree (`>` vs `>=` oldest date behavior).

**Intended**

- Catch-up should preserve continuity without punishment.

**Alignment**: Mechanically partial, emotionally weak.

**Risk**

- Visible point discount makes catch-up feel like penalty/remediation.

### F. Joshing Game

**Actual**

- Game creation writes `JoshingGame`, recipients, questions, and pinned Feed items.
- `/games/[id]` plays sequentially via chat.
- Answers write `JoshingGameResponse`, mastery, author credit, territory promotion, propagation, SMS/activity on progress/complete, and stored quip.
- Summary route exists.

**Intended**

- Compact 1–5 question friend game; no timer, no expiry; result visibility rules; no ceremony; summary in narrative sections.

**Alignment**: Play is mostly aligned; summary is weak.

**Risks**

- Game summary says “How Everyone Did” and renders score/matrix tables.
- Copy says “season” in a one-off game context.

### G. Review / summary

**Actual**

- Daily summary leads with `+points` and correct/skipped counts.
- Game summary leads with `+points`, `X/Y correct`, recaps, impact count, and group result table.

**Intended**

- Daily: score line + delayed interpretive line; quiet review.
- Game: Story, Your Game, Discovery, Everyone.

**Alignment**: Weak.

### H. Ceremony

**Actual**

- Ceremony routes/services/tables exist.
- Ceremony banner appears in Feed.

**Intended**

- Biweekly reflection is the only major moment where Joshing speaks back about who the player is becoming.

**Alignment**: Partial.

**Risk**

- Ceremony has to compete with daily/game summaries that already over-report growth.
- If lifecycle events remain derived from JSON slots/mastery rows, ceremony beats can be incomplete or misleading.

### I. Post-game → next cycle

**Actual**

- Joshing Game cards persist/pin in Feed; summary accessible.
- Daily continues by queue date.
- Legacy group `GameStatus`, `GroupStatus`, and `CeremonyProgress` still exist in Prisma.

**Intended**

- Daily rhythm continues; biweekly ceremony provides closure; no old “season” group-game loop.

**Alignment**: Partial / drifted terminology.

---

## 5. Mastery + Progression Audit

### 5.1 Canonical PRD vs implemented thresholds

**PRD11 canonical threshold table**

- Establishing: 0 points
- Familiar: 50 points
- Solid: 200 points
- Mastery: 500 points + 20% creator points rule

**Implemented threshold table**

- Establishing: 0
- Familiar: 500
- Solid: 1500
- Mastery: 3500

**Status: Critical misalignment.**

This changes progression pacing by 7x–10x compared with PRD11. It also invalidates tier display, ceremony beat timing, Knowledge circle sizing, mastery moment timing, and any retention expectations based on early tier movement.

### 5.2 Tier names

Implemented tier enum names are canonical: `establishing`, `familiar`, `solid`, `mastery`. No old tier-name leak was found in core tier code.

### 5.3 Points and weights

Observed code behavior:

- Daily generated question base points: accessible 10, moderate 50, specialist 100.
- Feed/Joshing `getBasePoints`: first correct accessible 10, moderate 50, specialist 100; first correct after wrong accessible 3, moderate 13, specialist 25; repeat and incorrect 0.
- Catch-up: correct answers award 0.25x.
- Joshing Game: full weight for answers.
- Creator credit: implemented for Joshing Game authored-question correct answers.

Open risks:

- PRD11 creator-point examples mention 0.5 / 0.25 style creator credit, while current `awards.ts` uses empirical-rate windows and 25/50/100 base values. This may be a PRD-generation mismatch and needs product decision.
- Daily generated questions awarding up to 100 points makes the PRD11 50/200/500 threshold table plausible. With code thresholds at 500/1500/3500, early progression will feel slow and unrewarding.

### 5.4 Raw numeric leakage

Raw points/correctness are visible on:

- Home catch-up (`0.25x points`).
- Feed answer result (`Correct. +N`).
- Daily summary (`+points`, `X/Y correct`, skipped).
- Game summary (`+points`, score counts, group table).
- Knowledge card (`knowledge points across N territories`).
- Archive filters and result labels.

**Status: Product-philosophy contradiction.** The backend can use points; the UI should usually express tier movement, new territory, “shared ground,” or “what you discovered.”

### 5.5 Catch-up weighting

Mechanically implemented as 0.25x. The issue is not the weighting; the issue is exposing it as the primary catch-up description.

### 5.6 Creator points

- Author credit exists and is used in Joshing Game answer flow.
- `effectiveTier` requires author-credit share and distinct authored questions for Mastery.
- `writeMasteryEvent` reads author credit before writing the new event; if the new event is itself author credit, tier computation may not include that current write for the immediate tier update. This needs a targeted test.

### 5.7 Hidden raw score leakage and ranking

- No explicit leaderboard route is currently present.
- Game summary effectively acts as a leaderboard by showing recipient scores and per-question `Y/N` table.
- Compatibility/alignment score remains in Prisma; PRD says alignment scores should never be raw UI numbers.

### 5.8 Domain merge/split and Knowledge graph

- `Knowledge tidy` exists and is exposed as “Map maintenance.”
- This is operationally useful but product-hostile on the main identity page.
- Domain merge/split should feel like quiet correction, not user-admin maintenance.

### 5.9 Progress bar / circle consistency

- The app has multiple progress visual systems: geometric dots, tier bars, domain progress bars, category gains, portrait circles, knowledge cards.
- Tier-anchored circles are directionally aligned with v11.1, but raw point signatures and multiple visualization idioms create a fragmented product feel.

---

## 6. UI System Consistency Audit

### Product feel

The UI does not yet feel like one coherent product. It alternates between:

1. **Conversation UI** — Daily/Joshing play.
2. **Report-card UI** — Daily summary, Game summary, Archive.
3. **Admin/config UI** — Account, Daily setup, Knowledge tidy/manage interests.
4. **Portrait UI** — Knowledge card/circles and Ceremony.

PRD 11.1 wants the whole app to feel calm, personal, specific, and conversational. The play surfaces do; the surrounding surfaces often do not.

### Inconsistent visual systems

- Progress dots: `GeometricProgress`.
- Domain cards: `DomainCard`, `DomainRow`, `DomainProgressBar`.
- Circle systems: `CategoryCircles`, `PortraitCircles`, `ProgressionLandscape`.
- Review gains: `CategoryGainsDisplay`, `MasteryMoment`.
- Share surfaces: `KnowledgeCard`, `SharePortraitCard`, `SharePortraitModal`, `ShareCard`.

These may all be useful individually, but together they create an inconsistent hierarchy: dots, bars, cards, circles, and tables all compete to explain progression.

### Over-boxing and excessive labels

- Summary cards use result badges, difficulty badges, explanation blocks, creator-note blocks, and action rows.
- Knowledge page uses many sections, toggles, modals, maintenance strip, toasts, and buttons.
- Game summary includes table layout, cards, totals, impact recap, and growth recap.

### Mobile hierarchy

- Gameplay is good on mobile: one question and one composer.
- Knowledge and summaries are too dense for mobile and violate “one primary action.”

### CTA consistency

- Home has Daily, Feed, Catch-up.
- Knowledge has Personal Daily, Share portrait, Send a friend a question, Write a question, Re-open domain, Tidy, Manage interests, Swap/Add.
- Summary has Knowledge map, Back home, thumbs, send, bank, and sometimes mastery moment.

Recommendation: every primary page should have one obvious next action; secondary actions should be contextual or hidden.

---

## 7. Conversation-First UX Audit

### Strong points

- Daily and Joshing Game answer flows are chat-based.
- Per-answer quip selection is server-side and contextual for Daily, Feed, and Joshing Games.
- Reactions and creator notes support private follow-up conversation.
- No visible timer in active play.

### Break points

- The moment after answering often becomes mechanical: points, correct/wrong, explanation, breadcrumb, action buttons.
- The moment after a session becomes a report: “How You Did,” points, correct count, cards.
- Feed cards ask the user to manage, dismiss, rate, answer, react, and filter domains from a single surface.
- Knowledge makes the user administer their identity map.

### Emotional pacing failures

1. **Session close is not enough of a close.** It routes into summary/report instead of letting the final line breathe.
2. **Wrong answers are not consistently reframed.** Gameplay is gentle; summaries are evaluative.
3. **Catch-up copy implies penalty.** “0.25x points” is not conversation-first.
4. **Game summaries overexpose other people’s performance.** Shared play should create stories, not score matrices.

---

## 8. Data Model Audit

### 8.1 Prisma schema: legacy product model

`prisma/schema.prisma` still contains:

- Private group architecture: `Group`, `GroupMember`, `Game`, `GameQuestion`.
- Old daily group assignments: `DailySession`, `DailyAssignment`, `Answer`.
- Legacy social scoring: `StarVote`, `CompatibilityScore`, `GroupKnowledgeMap`.
- Timer fields: `response_time_ms`, `question_presented_at`.
- Challenge/expert-challenge models.
- Mastery tables that do not include all active Drizzle fields.

This schema is not a clean PRD 11.1 model.

### 8.2 Drizzle schema: active v11.1 model

`src/server/db/schema.ts` appears to be the active app schema and includes:

- User onboarding/profile fields.
- Questions with `generatedQuestionId`, `source`, `sharedToFriendsFeed`, `surfacePriorityScore`.
- `GeneratedQuestion`, `DailyQueue`, `DailyPreference`, `SkippedDailyQuestion`.
- `PLAYER_MASTERY`, `MASTERY_EVENTS`, `DeclaredInterest` with `territory_type`.
- Feed, dismissed domains, friendships, invitations.
- Joshing Games and responses.
- Biweekly ceremonies, activities, reactions, creator notes.

This is closer to PRD 11.1 but still has drift and missing constraints.

### 8.3 Dangerous technical debt

| Area | Problem | Consequence |
|---|---|---|
| DailyQueue JSON slots | Stores durable answer state in JSON. | Hard to query, index, migrate, audit, or use for ceremony. |
| GeneratedQuestion identity | A generated question may become canonical only after answer. | Feed/mastery/archive can disagree about IDs. |
| Mastery events | Synthetic answer IDs and nullable question IDs. | Idempotency and dedupe are fragile. |
| Feed item uniqueness | Propagation checks for existing item in app code only. | Race conditions can duplicate Feed items. |
| Dismissed domains | No partial active unique constraint. | Duplicate active dismissals are possible. |
| Dual schemas | Prisma and Drizzle disagree. | Migration and type safety risk; developers may use wrong model. |
| Question quality signals | `questionFeedback`, `questionRatings`, `surfacePriorityScore`. | Multiple truth sources for quality/preference. |

### 8.4 Missing / unclear ownership of truth

- **Answer truth**: queue slots, Feed item state, JoshingGameResponse, MasteryEvent, Archive queries, and old Prisma Answer all represent answer-like facts.
- **Knowledge domain truth**: `DeclaredInterest` and `PLAYER_MASTERY` both represent domain membership; one should be canonical with declared/demonstrated metadata.
- **Question truth**: `GeneratedQuestion` and `Question` can represent the same played question.
- **Social truth**: Feed, Activity, Reactions, CreatorNotes, and SMS logs all track social moments but without an obvious event ledger.

---

## 9. Feature Flag + Legacy System Audit

### Active feature flags

No centralized typed feature-flag registry was found. Legacy behavior is controlled by dead tables, routes, comments, and absence of UI rather than explicit flags.

### Legacy drift inventory

| Legacy / drift item | Evidence | Risk |
|---|---|---|
| Group-game architecture | Prisma `Group`, `Game`, `GroupMember`, `DailyAssignment`, `DailySession`. | Reintroduces old group loop and confuses data ownership. |
| Star voting | Prisma `StarVote`, SMS `star_notification`. | Old popularity/competition mechanic. |
| Compatibility score | Prisma `CompatibilityScore.score_percent`. | Raw alignment score risk; PRD says no raw alignment numbers. |
| Timer remnants | Prisma `response_time_ms`, `question_presented_at`. | Can reintroduce speed pressure. |
| Scoreboards | Game summary table and scores. | Violates identity-over-competition. |
| Archive result filters | Archive source/result filters. | Makes review feel like analytics. |
| `sharedToFriendsFeed` | Drizzle question field remains. | Broadcast-share drift if reused. |
| `authored_shared` | Not active in audited app paths. | Good: killed source appears removed from app layer. |
| Salvaged components | Game details/interpretive components from earlier PRDs. | May preserve old summary mental model. |
| Challenge tables | Prisma challenge models. | Product scope creep / old PRD carryover. |

### Dead / zombie components and comments

- `awards.ts` is marked deprecated and says it should not be imported by active code, but active Feed/Joshing code imports `getBasePoints` / creator award helpers from it. That is a code-comment contradiction.
- Daily skip comments say capped at 3, but `DAILY_SKIP_LIMIT = 5`.
- Knowledge tidy is exposed to users even though it behaves like maintenance tooling.

---

## 10. Implementation Plan Alignment Matrix

`Master_App_Instructions-v2.md`, `Joshing_Implementation_Plan_v2.md`, `CLAUDE.md`, and `AGENTS.md` were not present in `/workspace`, so this matrix uses PRD11, PRD-v11.1, existing audits, route inventory, schema, and service code as the reference set.

| System | Built? | Built correctly according to PRD 11.1? | Status |
|---|---:|---:|---|
| Daily Five chat interface | Yes | Mostly | Mostly complete |
| Daily LLM generation from KB | Yes | Mostly, subject to “human-authored only” conflict | Mostly complete |
| Daily per-answer quips | Yes | Partially | Built, but Daily persistence is JSON-slot based |
| Daily close / summary | Yes | No | Built but drifted |
| Daily catch-up | Yes | Partially | Mechanically built; emotionally drifted |
| Onboarding cultural anchor | Yes | Mostly | Mostly complete, needs invitation UX verification |
| Invitation pre-seed flow | Schema yes | Unclear | Partial |
| Feed friend-answer propagation | Yes | Mostly | Mostly complete; DB constraints missing |
| Feed thumbs-up/down quality signals | Yes | Mostly | Mostly complete |
| Feed “Not my focus” | Yes | Partially | Built; uniqueness/reopen UX needs work |
| Feed reactions | Yes | Partial | Partial |
| Activities social record | Yes | Mostly | Mostly complete, copy needs quiet tone |
| Knowledge tier/circles | Yes | Partially | Built but visual system fragmented |
| Knowledge Grow your map | Yes | Mostly | Mostly complete |
| Declared interests moved to Account | No | No | Direct drift |
| Authorship opens territory | Yes | Partially | Built, needs tests around no mastery-on-write and promotion |
| Authored → demonstrated promotion | Yes | Partially | Built in answer paths, needs lifecycle tests |
| Mastery thresholds | Yes | No | Critical mismatch |
| Creator credit | Yes | Unclear | Built but may not match PRD point table |
| Joshing Game creation/play | Yes | Mostly | Mostly complete |
| Joshing Game summary | Yes | No | Built but drifted into scoreboard/report |
| Ceremony infrastructure | Yes | Partial | Partial; needs emotional/data validation |
| Archive | Yes | Partial | Built but admin/log-like |
| Replay | Yes | Partial | Needs conversation-first pass |
| Account/settings | Yes | Partial | Missing ownership of interest management |
| Schema consolidation | No | No | Not started / critical |
| Legacy cleanup | No | No | Not started |
| Feature flag registry | No | No | Not started |

---

## 11. Critical Product Risks

Ranked by severity:

1. **Mastery pacing is wrong.** If thresholds remain 500/1500/3500 instead of 50/200/500, early retention and ceremony beats will be starved.
2. **The app trains score-chasing.** Raw points and correct counts are visible in too many primary surfaces.
3. **Post-play UX breaks the conversation.** The player finishes a chat and lands in a report card.
4. **Knowledge page overload obscures identity.** The product’s most important identity surface feels like a control panel.
5. **Data truth fragmentation will create bugs.** JSON answers + generated/canonical question split + dual schemas will cause inconsistent archive, mastery, Feed, and ceremony behavior.
6. **Legacy group-game artifacts will keep leaking into UX.** Score tables, group progress, season copy, and old schemas preserve the wrong mental model.
7. **Invitation intimacy may fail.** If onboarding does not strongly carry inviter context, the product loses its invitation-only emotional hook.
8. **Wrong-answer discovery is inconsistent.** Gentle gameplay copy is undermined by red WRONG badges and incorrect filters.

---

## 12. Critical Recommendations

### Critical

1. **Correct mastery thresholds immediately** and backfill/recompute existing mastery if needed.
2. **Redesign `/daily/summary` and `/games/[id]/summary`** around PRD narrative hierarchy.
3. **Normalize answer storage** for Daily/Feed/generated-question play.
4. **Make Drizzle or Prisma canonical**; remove or quarantine the other schema from active development.
5. **Remove declared-interest management from Knowledge** and move it to Account.
6. **Add Feed idempotency and dismissed-domain uniqueness constraints.**
7. **Stop exposing raw points in primary UI.** Keep numbers internal or in secondary detail views.

### Important

1. Rename nav label **Friends** back to **Feed** or explicitly justify the language change.
2. Reframe catch-up copy around continuity.
3. Hide map tidy/maintenance from the main Knowledge page.
4. Add route-level tests for PRD-killed concepts: no timers, no leaderboards, no `authored_shared`, no broadcast-share UI.
5. Add lifecycle tests for authored territory: write opens declared; friend correct promotes demonstrated; writing does not award mastery points.
6. Add ceremony tests for new territory, authored territory, friend-shaped map, and tier crossing.
7. Add copy/terminology lint for `wrong`, `score`, `leaderboard`, `season`, and `0.25x points` in primary UX.

### Nice to Have

1. Add “why this question showed up” microcopy in Daily.
2. Add a friend-profile route/entry point for Feed attribution.
3. Consolidate progress visual components into one progression design system.
4. Create Storybook or screenshot states for Daily, Feed answer, Catch-up, Summary, Knowledge, Ceremony.
5. Create a product event ledger for social/ceremony moments.

---

## 13. Concrete Fix List

| # | Problem | Why it matters | Exact files/components/services involved | Suggested solution | Risk | Complexity |
|---:|---|---|---|---|---|---|
| 1 | Mastery thresholds are 10x too high vs PRD11. | Breaks progression pacing, Knowledge sizing, ceremony timing, retention. | `src/server/mastery/tiers.ts`, tests, `src/server/mastery/tier-progress.ts` | Change thresholds to 0/50/200/500 or confirm amended PRD; add migration/backfill plan. | Critical | M |
| 2 | Deprecated `awards.ts` is imported by active code. | Code-comment contradiction and legacy source of scoring truth. | `src/server/mastery/awards.ts`, Feed answer route, Joshing query service | Move active helpers to non-deprecated module or rewrite; delete unused legacy Prisma code. | High | M |
| 3 | Daily summary is points-first. | Violates reflection-over-dashboard. | `src/app/daily/summary/page.tsx`, `src/components/review/*` | Put PRD score line + interpretive line first; move points/detail behind Review. | High | M |
| 4 | Game summary is a scoreboard. | Violates identity over competition. | `src/app/games/[id]/summary/page.tsx` | Rebuild as Story / Your Game / Discovery / Everyone with no table-first view. | High | L |
| 5 | Knowledge page is overloaded. | Weakens identity surface and one-primary-action rule. | `src/app/knowledge/page.tsx` | Split Knowledge, Account interests, Feed settings, admin tidy. | High | L |
| 6 | Declared interests are still managed in Knowledge. | Direct PRD contradiction. | `src/app/knowledge/page.tsx`, `src/app/account/page.tsx`, `/api/declared-interests` | Move Manage interests to Account and remove Knowledge modal entry. | High | M |
| 7 | Daily answer state lives in JSON. | Fragile lifecycle, archive, ceremony, replay, analytics. | `src/server/db/schema.ts`, Daily answer/skip/catch-up/summary/archive code | Add normalized answer table or unified PlayAnswer. | Critical | XL |
| 8 | GeneratedQuestion and Question split identity. | Two IDs for one question moment. | `src/server/questions/persist-generated-question.ts`, Daily answer routes, Feed propagation | Persist canonical Question before play or store stable mapping at generation. | High | L |
| 9 | Prisma and Drizzle schemas diverge. | Developers and migrations can use wrong truth. | `prisma/schema.prisma`, `src/server/db/schema.ts` | Choose canonical schema; update/remove/quarantine other. | Critical | XL |
| 10 | Feed idempotency is not DB-enforced. | Duplicate Feed items under race. | `src/server/feed/create-feed-items-for-answer.ts`, `src/server/db/schema.ts` | Add unique/partial unique index for recipient/question/source. | High | M |
| 11 | Dismissed domains lack active unique constraint. | Duplicate active dismissals and confusing re-open state. | `src/server/db/schema.ts`, `/api/feed/dismiss-domain` | Add partial unique active dismissal index. | Medium | M |
| 12 | Catch-up date helper boundary mismatch. | Eligibility inconsistency. | `src/server/daily/catchup.ts`, `src/server/play/catch-up-eligibility.ts` | Consolidate helper and test exact seven-day boundary. | Medium | S |
| 13 | Catch-up shows `0.25x points`. | Makes catch-up punitive. | `src/app/page.tsx`, catch-up UI | Reframe as continuity; move multiplier to hidden details. | Medium | S |
| 14 | Skip limit comment says 3 but constant is 5. | Hidden rules drift. | `src/server/daily/types.ts`, skip route/tests | Decide canonical skip cap and align code/comment/tests/copy. | Medium | S |
| 15 | Feed card has too many actions. | Breaks conversation rhythm. | `src/components/FeedList.tsx` | Primary Answer; overflow menu for skip/dismiss/not-my-focus. | Medium | M |
| 16 | Raw points leak in Knowledge/Feed/summary. | Encourages score chasing. | `src/app/knowledge/page.tsx`, `src/components/FeedList.tsx`, summaries | Convert to tier/new-ground/shared-ground copy. | High | M |
| 17 | Timer fields remain in Prisma. | Risk of speed-pressure reintroduction. | `prisma/schema.prisma` | Remove or document as deprecated DB-only; add no-timer tests. | Medium | M |
| 18 | Star/compatibility/group legacy remains. | Old competition/group mental models persist. | `prisma/schema.prisma`, salvaged game components | Remove/quarantine after schema decision. | Medium | L |
| 19 | “Season” copy appears in one-off game. | Terminology drift. | `src/app/games/[id]/summary/page.tsx` | Replace with game/round-specific copy. | Low | S |
| 20 | No central feature flags. | Hard to kill legacy behavior safely. | App-wide | Add typed feature flags for migration-only legacy gates. | Medium | M |
| 21 | Invitation acceptance route is unclear. | Invitation-only intimacy may fail. | `FriendInvitation` schema, onboarding routes/pages | Add/verify `/invite/[token]` or equivalent and carry context into onboarding. | High | M |
| 22 | Ceremony competes with summary surfaces. | Reflection loses hierarchy. | Ceremony services/pages; daily/game summaries | Reduce daily/game reflection scope; make ceremony the major reflective artifact. | Medium | L |
| 23 | Archive is an admin log. | Review becomes evaluative. | `src/app/archive/page.tsx`, `/api/archive` | Reframe as memory/review; soften filters and labels. | Medium | M |
| 24 | Question quality has multiple truth sources. | Thumbs/rating behavior can diverge. | `questionFeedback`, `questionRatings`, `surfacePriorityScore`, rating routes | Consolidate quality signal ownership and backfill. | Medium | L |
| 25 | Author credit tier update may not include current event. | Mastery crossing can be delayed/missed. | `src/server/mastery/write-mastery-event.ts` | Add tests; include pending author-credit event in effective tier calculation. | Medium | M |

---

## 14. Source-of-Truth Review Status

Requested source documents:

| Requested document | Status in workspace |
|---|---|
| `Master_App_Instructions-v2.md` | Not found |
| Latest PRD / PRD 11.1 | Found: `_docs/PRD11.md`, `_docs/PRD-v11.1.md` |
| `Joshing_Implementation_Plan_v2.md` | Not found |
| `CLAUDE.md` | Not found |
| `AGENTS.md` | Not found |
| Active feature flags | No central flag registry found |
| Current route structure | Reviewed via `src/app` route files |
| Prisma schema | Reviewed: `prisma/schema.prisma` |
| Core gameplay services | Reviewed Daily, Feed, Joshing Game, mastery, ceremony paths |
| Existing audit documents | Reviewed: `PRD-AUDIT.md`, `PRD-V11.1-AUDIT.md`, `PRD-V11.1-AUDIT-2.md` |

---

## 15. Evidence Map

Primary files inspected for this rerun:

- PRD/source docs: `_docs/PRD11.md`, `_docs/PRD-v11.1.md`, `_docs/ARCHITECTURAL-DECISIONS.md`, `_docs/PHASE-STATUS.md`, existing PRD audit docs.
- Route inventory: `src/app/**/page.tsx`, `src/app/**/route.ts`.
- Schemas: `prisma/schema.prisma`, `src/server/db/schema.ts`.
- Daily/catch-up: `src/app/daily/page.tsx`, `src/app/api/daily/answer/route.ts`, `src/app/api/daily/catchup/answer/route.ts`, `src/server/db/queries/daily.ts`, `src/server/daily/types.ts`, `src/server/daily/generate-questions.ts`, `src/server/play/catch-up-eligibility.ts`.
- Feed: `src/components/FeedList.tsx`, `src/app/api/feed/[feedItemId]/answer/route.ts`, `src/server/feed/create-feed-items-for-answer.ts`, `src/server/db/queries/feed.ts`.
- Mastery/progression: `src/server/mastery/tiers.ts`, `src/server/mastery/tier-progress.ts`, `src/server/mastery/write-mastery-event.ts`, `src/server/mastery/awards.ts`.
- Knowledge: `src/app/knowledge/page.tsx`, `src/app/knowledge/[domain]/page.tsx`, `src/components/knowledge/*`, `src/server/profile/*`, `src/server/knowledge/open-domain.ts`.
- Joshing Games: `src/app/games/[id]/page.tsx`, `src/app/games/[id]/play-client.tsx`, `src/app/games/[id]/summary/page.tsx`, `src/server/db/queries/joshing-game.ts`, `src/app/api/joshing-games/[id]/answer/route.ts`.
- Ceremony/activity/social: `src/server/ceremony/*`, `src/server/mastery/ceremony.ts`, `src/app/ceremony/[ceremonyId]/page.tsx`, `src/app/activities/page.tsx`, creator notes and reactions APIs.

---

## 16. Final Verdict

The codebase is **mechanically partway to PRD 11.1 but emotionally and architecturally not yet aligned**.

The biggest issue is not that features are missing. Many features exist. The problem is that the app still presents those features through older trivia/product patterns: points, correctness reports, score matrices, setup dashboards, maintenance tools, and legacy group-game data. PRD 11.1 requires the same mechanics to be framed as conversation, identity, discovery, and reflection.

The next implementation phase should not add more product surface area. It should **subtract, consolidate, and reframe**:

1. Fix mastery math.
2. Normalize gameplay data.
3. Collapse summary dashboards into reflective closures.
4. Split overloaded pages.
5. Kill or quarantine legacy systems.
6. Make Feed/Daily/Knowledge/Ceremony feel like one calm product.
