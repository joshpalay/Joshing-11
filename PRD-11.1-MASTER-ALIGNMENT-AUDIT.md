# Joshing Codebase Alignment Audit — PRD 11.1

Date: 2026-05-07  
Auditor: Codex  
Scope: product philosophy, routes, gameplay loop, mastery/progression, UI consistency, data model, feature flags/legacy drift, and implementation-plan alignment.

## 1. Executive Summary

### Overall alignment score: **62 / 100**

Joshing has made substantial progress toward PRD 11.1: the Daily Five uses a chat-thread interface, the Feed has shifted to friendship-triggered propagation rather than broadcast sharing, the Knowledge page includes tier-anchored portrait/circle work, onboarding captures birth year/geography, and Joshing Games exist as compact social sessions. However, the product still feels split between two product eras: a newer conversation-first personal Daily/Feed product and older group-game/dashboard/reporting patterns retained in schema, routes, and summaries.

### Biggest strengths

- **Daily Five core interaction is directionally aligned.** `/daily` is a sequential chat-like session with one active answer field, skip as a secondary action, no visible timer, and quiet completion routing.
- **Feed propagation is mostly philosophically correct.** The server creates Feed items from friends' answers, blocks propagation on thumbs-down, respects recipient domain dismissal, and does not use `authored_shared` as an application source.
- **Knowledge expansion is becoming legible.** The Knowledge page includes a “Grow your map” section and uses tier-aware domain rendering through portrait/circle components.
- **Onboarding now includes the cultural anchor required by v11.1.** User records include `birth_year`, `grew_up_country`, and `grew_up_region`, and onboarding routes exist for proposal/canonicalization/saving.
- **Ceremony infrastructure exists.** There are biweekly ceremony tables/routes/services, share tokens, banner APIs, and ceremony pages.

### Biggest product risks

1. **The app still over-explains performance with points, correct counts, tables, badges, and scorecards.** This repeatedly pulls the experience toward evaluation/competition rather than identity, discovery, and reflection.
2. **The Knowledge page is overloaded.** It is simultaneously portrait, progression chart, share card, daily setup entry, grow-map explainer, hidden-domain manager, map tidy tool, declared-interest manager, write/send launchpad, and toast host.
3. **Summaries are dashboard-like, not narrative-like.** Daily and Joshing Game summaries lead with `+points`, `X/Y correct`, “How You Did,” recap cards, and group tables instead of PRD-style reflection/story.
4. **Data truth is fragmented.** Prisma and Drizzle schemas diverge, Daily answers live inside JSON queue slots, generated questions are persisted into canonical questions after answering, and mastery writes use synthetic IDs.
5. **Old group-game machinery remains structurally central.** Prisma still models `Group`, `Game`, `DailySession`, `DailyAssignment`, `Answer`, `StarVote`, `CompatibilityScore`, and `GroupKnowledgeMap`; new Drizzle tables model Feed/Joshing Games separately.

### Biggest architecture risks

- **Dual schema drift:** `prisma/schema.prisma` and `src/server/db/schema.ts` describe different product worlds. Prisma lacks many v11.1 Drizzle additions, while Drizzle lacks old group/DailyAssignment structures.
- **JSON queue slots are a hidden state machine.** Daily answer, skip, catch-up, summary, archive, and propagation logic all depend on `DailyQueue.slots` shape rather than normalized answer rows.
- **Mastery idempotency relies on synthetic `answerId` strings and nullable `questionId`.** This is fragile for generated-question flows and future domain merge/split work.
- **Legacy fields and concepts remain callable.** Timers (`response_time_ms`, `question_presented_at`), star votes, compatibility scores, group games, archived games, and challenge tables remain in schema or code.
- **Ceremony is bolted on after mastery rather than being the emotional close of a gameplay arc.** It exists, but many beats are computed from derived data rather than explicit lifecycle events.

### Most urgent fixes

1. Replace points-first summaries with PRD-style narrative/reflection surfaces.
2. Split the Knowledge page into one primary “portrait/map” surface plus Account-managed interest settings and a separate maintenance/debug route.
3. Normalize Daily answers or introduce a durable `DailyAnswer`/`PlayAnswer` table; stop making JSON slots the source of truth.
4. Reconcile Prisma and Drizzle schemas; designate one canonical schema layer.
5. Remove or quarantine legacy group-game/star/compatibility/timer paths that are not part of PRD 11.1.

## 2. Product Philosophy Alignment

| Principle | Alignment | Evidence | Contradictions / anti-patterns |
|---|---:|---|---|
| Shared knowledge creates connection | Partial | Feed item creation uses friends' answers and writes activity moments. Joshing Games create pinned Feed cards for recipients. | Game summaries show score tables (`Y/N`, `X/5`) rather than relational story. Knowledge “Grow your map” says send/write, but daily Home copy says “build your knowledge map” generically rather than naming people. |
| Wrong answers are discovery | Partial | Daily chat wrong copy is gentle (“The map grows anyway.”); wrong answers receive zero points but no explicit penalty. | Summary labels render “WRONG” in red, Feed says “Not quite,” summaries expose correct/wrong counts prominently, and group summaries render per-player `Y/N`. |
| Identity over competition | Weak/partial | Mastery tiers use identity-like labels (`establishing`, `familiar`, `solid`, `mastery`) and Knowledge portrait copy says “Your Mind.” | Raw point totals, `+points`, scoreboards, correct rates, group tables, and compatibility/score structures keep evaluation dominant. |
| Human-authored questions only | Misaligned with current PRD hierarchy as stated by prompt; aligned with v11.1 document nuance | The prompt says human-authored questions only, but PRD 11.1 explicitly relies on LLM-generated Daily Five questions calibrated to KB. Code follows PRD by generating Daily questions. | If “human-authored only” is now intended philosophy above PRD text, Daily generation is a major product mismatch. Current code generates questions via LLM and persists generated questions after play. |
| Invitation-only intimacy | Partial | Friend invitations and friendships exist in Drizzle schema, and nav/feed assumptions are friend-based. | Home, onboarding, and account flows do not enforce or foreground invitation context strongly; `FriendInvitation` exists but route coverage is not obvious from app routes. |
| Conversation-first UX | Partial/strong in play, weak elsewhere | Daily and Joshing Game play use `GameplayChatThread` and one answer input. | Summary, Knowledge, Archive, Account, and Game summary drift into dashboard/admin language. The Feed is card/action heavy rather than a continuous conversation. |
| Specificity over generic categories | Partial | Domains use `canonicalSubcategory`; onboarding proposes hyper-specific interests. | Prisma still contains broad enum `Category`; UI frequently displays broad categories, difficulty badges, and generic labels. Domain merge/split is maintenance tooling rather than coherent UX. |
| Discovery over domination | Partial | Catch-up is low-weight 0.25x and does not punish missing days; Feed is bounded. | Scoring remains prominent; game summary exposes winner-like “How Everyone Did”; archive filters by correct/incorrect. |
| Reflection over dashboards | Weak | Ceremony exists and Knowledge portrait attempts reflection. | Most post-play surfaces are dashboards: totals, points, recap cards, tables, progress bars, filters, and maintenance actions. |

### Hidden anti-patterns by route/component/service

- `src/app/daily/summary/page.tsx`: leads with **How You Did**, `+points`, `X/Y correct`, red “WRONG” pills, and action icons on every recap card.
- `src/app/games/[id]/summary/page.tsx`: includes **How Everyone Did** table with `Y/N` cells and per-recipient scores, the clearest competition leakage.
- `src/app/knowledge/page.tsx`: mixes reflective identity (“Your Mind”) with toggles, maintenance, hidden domains, share portrait, interest management, write/send modals, and tidy confirmation.
- `src/server/db/schema.ts`: keeps `surfacePriorityScore`, `pointsAwarded`, `score`-like concepts, friend invitations, feed dismissal, and Joshing Games; useful but still metric-heavy.
- `prisma/schema.prisma`: retains old group-game, star, compatibility, timer, challenge, and group knowledge concepts.

## 3. Route + UX Architecture Map

### Top-level page routes

| Route | Current purpose | Intended PRD purpose | Alignment | UX problems | Suggested restructuring |
|---|---|---|---:|---|---|
| `/` | Home with Daily card, embedded mini Feed, catch-up card. | Quiet home: Daily Five entry + small Feed indicator. | Partial | Embedded `FeedList limit=3` makes Home act like a small dashboard; catch-up shows point multiplier. | Make Home one-primary-action: “Play today’s five.” Feed indicator should be a quiet count/link, not full card content. |
| `/feed` | Main Feed card stream with ceremony banner and Feed interactions. | Top-level bounded stream of friends' answered questions. | Mostly aligned | Card mechanics can feel admin-like: answer, skip, dismiss, not-my-focus, thumbs, reactions. | Preserve bounded Feed; convert actions into progressive disclosure and conversation-like answer flow. |
| `/daily` | Chat-thread Daily Five session. | Primary daily play surface. | Mostly aligned | Header still shows progress dots and difficulty badges; skip says “we’ll bring it back later” without clearly explaining catch-up. | Keep as is but soften evaluation badges and improve skip/catch-up transition copy. |
| `/daily/setup` | Daily preferences/setup. | Personal Daily setup/preferences. | Partial | Preferences can become a configuration dashboard. | Move infrequent settings to Account; only show setup when blocked or intentionally opened. |
| `/daily/catchup` | Catch-up play for previous unplayed generated questions. | Low-pressure recovery path. | Partial | “0.25x points” is exposed on Home; catch-up is point-framed. | Reframe as “questions you missed” / “keep the thread going”; hide multiplier unless necessary. |
| `/daily/summary` | Daily result dashboard. | Session close reflection with score line + delayed interpretive line. | Partial/weak | Leads with points and correct counts; has many recap/action cards. | Replace with PRD close copy first; move detailed recap behind “Review answers.” |
| `/knowledge` | Portrait/map/progression/share/grow/dismiss/manage/tidy/write/send all-in-one. | Reflective Knowledge portrait/map, with Grow your map explainer. | Partial | Severely overloaded; declared-interest management remains here despite PRD moving it to Account. | Split: `/knowledge` = portrait/map + grow card; `/account/interests` = interests; hidden domains under Account or Feed settings; tidy admin hidden. |
| `/knowledge/[domain]` | Domain detail route. | Domain-specific knowledge/reflection. | Unknown/partial | Needs audit against one-primary-action and raw point leakage. | Make domain pages narrative: “what this domain says about you,” recent moments, next gentle action. |
| `/questions` | Question bank/archive creation management. | Bank/write flow and authored questions. | Partial | Likely admin/database feel; must avoid generic question management. | Rename/position as “Your questions” with relational context, not a table. |
| `/archive` | Filterable answer/question archive. | Personal archive/review. | Partial/weak | Filters by source/result/domain/search; result chips include WRONG. Feels like a log. | Make Archive a quiet memory/review surface; keep filters secondary. |
| `/new-game` | Create Joshing Game. | Game creation flow: choose title/recipients/questions. | Partial | Needs one primary send action and emotional framing. | Add preview story and recipient-focused copy. |
| `/games/[id]` | Joshing Game chat play route. | Same chat mechanic as Daily, no timer/expiry. | Mostly aligned | No skip; current header says `N of M`, progress framed mechanically. | Keep chat; add sender/why-this-game framing. |
| `/games/[id]/summary` | Game summary with personal score, recaps, impact, group progress table. | Story / Your Game / Discovery / How Everyone Did. | Partial/weak | Current version is performance dashboard; lacks narrative “Story” hierarchy. | Rebuild in PRD order; group result should be card/story, not table-first. |
| `/ceremony/[ceremonyId]` | Ceremony presentation. | Biweekly reflective ceremony. | Partial | Needs visual/beat audit; infrastructure exists. | Ensure ceremony is the main reflective artifact, not just another report. |
| `/activities` | Activity feed and creator notes/reactions. | Reverse-chronological social moments around questions. | Mostly aligned | Risk of notification-center feel. | Keep quiet; prioritize human-language moments and replies. |
| `/account` | User/account/settings. | Account, SMS, manage interests. | Partial | Manage interests still also lives in Knowledge modal. | Account should own declared-interest management per PRD. |
| `/onboarding` | Onboarding flow. | Four-step v11.1 interest declaration. | Mostly aligned by routes/schema | Need full UX verification; invitation pre-seed may be under-integrated. | Ensure pre-seeded interests and invitation copy are first-class. |
| `/replay` | Replay missed questions. | Review/replay. | Partial | Risk of study-app drift. | Make replay conversational and discovery-oriented. |
| `/creator-notes/new` | Creator note writing. | Private relational notes. | Aligned in spirit | Could feel form-like. | Keep short, context-rich, prompted from real answer moments. |
| `/share/ceremony/[token]` | Public ceremony share. | Shareable reflection. | Partial | Needs privacy/expiry verification. | Ensure share card is identity/reflection, not scoreboard. |

### API route responsibilities

Major API surfaces are: auth/session; onboarding proposal/canonicalization/save; Daily queue/status/answer/skip/catch-up/summary/preferences/reset; Feed list/state/answer/thumbs/dismiss-domain; Knowledge map/domain/tidy; Question bank/send/suggest/rating; Joshing Games CRUD/answer; reactions; creator notes; activities; ceremony/banner/share/viewed; archive; replay; cron daily assignments and biweekly ceremony.

The route inventory confirms the product is no longer a simple Daily Five app. The architectural risk is not missing routes; it is route responsibility overlap and multiple surfaces owning the same user concepts.

## 4. Gameplay Lifecycle Audit

### Invitation → onboarding

- **Actual:** `FriendInvitation` schema exists with pre-seeded interests and expiry. Onboarding routes exist for canonicalization, interest proposals, and saving. User fields include birth year and geography.
- **Intended:** Invitation is a gift; pre-seeded interests appear before cultural anchor and warm-up questions.
- **Gaps:** Route inventory does not show an invitation acceptance page; invitation context may not be strongly carried into onboarding. Account/Knowledge later expose interest management, which can weaken onboarding’s “chosen five” ceremony.
- **Risk:** New users may experience onboarding as generic setup rather than “someone invited me because they know me.”

### Onboarding → first session

- **Actual:** Daily queue generation requires Knowledge Base entries; if none, Daily setup is shown. `fillDailyQueueForUser` generates five questions from the user KB.
- **Intended:** First Daily Five arrives after selecting up to five interests, ideally with SMS timing.
- **Gaps:** Daily generation failure falls back to operational messages. Emotional “tomorrow at noon” promise depends on notification/cron behavior not visibly tied to onboarding.

### First session

- **Actual:** `/daily` loads queue/status; if no queue, redirects to setup; if completed, redirects to summary. It shows one current question in a chat thread and a sticky answer input.
- **Intended:** Bounded Daily Five, conversation-first, per-answer quips, no timer.
- **Aligned:** No timer UI; sequential reveal; wrong answers are not punitive beyond 0 points; catch-up exists for misses.
- **Problems:** Difficulty badges and progress dots still create evaluation pressure. Session close immediately routes to summary, which is points-first.

### Repeat play

- **Actual:** DailyQueue keyed by date; used generated questions are flagged; preferences affect generation. Mastery events update the Knowledge map.
- **Intended:** Quiet daily ritual; KB grows over time via friends/authorship.
- **Problems:** Daily Five generated questions can only deepen existing KB; that is correct, but the user may not understand why. The app needs clearer “why these domains today” copy.

### Catch-up

- **Actual:** Catch-up looks back seven days; eligible slots are generated-question slots not answered/dismissed. Correct catch-up answers award `basePoints * 0.25`. Home exposes “0.25x points.”
- **Intended:** Low-pressure recovery without punishment.
- **Problems:** The multiplier is product-hostile when surfaced prominently. It frames catch-up as devalued work rather than a thread you can pick back up.
- **State risk:** `isCatchupQueueDate` uses `>` for the oldest date while `isCatchUpQueueDateEligible` uses `>=`; two helpers disagree at the boundary.

### Review / summary

- **Actual:** Daily summary and game summary list recaps, points, correct counts, action buttons, growth recap, and sometimes mastery moments.
- **Intended:** Session close score line + delayed interpretive line for Daily; Game summary structured as Story / Your Game / Discovery / Everyone.
- **Problems:** The current summaries are the strongest “dashboardification” evidence.

### Ceremony

- **Actual:** Biweekly ceremony tables/routes/services exist, with banner route and share tokens.
- **Intended:** Every two weeks, one reflective artifact about who the player is becoming.
- **Problems:** Ceremony competes with daily/game summaries for reflection rather than being the clear reflective peak. Beat source data may be incomplete because many events are derived from queue JSON rather than normalized lifecycle events.

### Post-game → next season

- **Actual:** Joshing Games persist in Feed; summary accessible. No explicit next-season setup appears for the PRD 11.1 product; legacy `Game` has `completed_at`, group game status, and ceremony progress.
- **Intended:** Daily seasons/biweekly reflection and next cycle should feel like continuity.
- **Problems:** “Season” language appears in game summary copy (`None of your questions were answered correctly this season`) even Joshing Game is a one-off, causing terminology drift.

## 5. Mastery + Progression Audit

### Canonical implemented tier names

Implemented canonical tiers are: `establishing`, `familiar`, `solid`, `mastery`. These exist in Prisma and Drizzle enum definitions and in `src/server/mastery/tiers.ts`.

### Implemented thresholds

`TIER_THRESHOLD_POINTS` sets:

- Establishing: 0
- Familiar: 500
- Solid: 1500
- Mastery: 3500

Mastery additionally requires at least 20% author-credit share and at least two distinct authored questions for effective Mastery.

### Point weights observed

- Daily correct: full base points, weight 1.
- Catch-up correct: 0.25x base points, weight 0.25.
- Feed/Joshing Game intended full weight; answer routes and `writeMasteryEvent` need consistent verification route-by-route.
- Author credit and curator credit exist in mastery source types; authorship itself should not award mastery points.

### Raw score leakage

Raw numeric leakage is widespread:

- Home catch-up: “0.25x points.”
- Daily summary: `+points`, `X/Y correct`, skipped counts.
- Game summary: `+points`, `X/Y`, recipient scores, and `Y/N` table.
- Knowledge card: “knowledge points across N territories.”
- Feed cards expose `+points` after answer.
- Archive exposes correct/incorrect/skipped filtering.

This is the central progression alignment problem: the backend can keep numeric scoring, but the UI should usually translate it into identity/reflection language.

### Domain merge/split logic

- `Knowledge tidy` route and `Map maintenance → Tidy up my map` exist.
- This is useful but feels like an admin tool. Domain merge/split should be rare and mostly invisible, not a primary Knowledge page affordance.

### Knowledge graph updates

- `writeMasteryEvent` upserts `PLAYER_MASTERY`, updates tier, and uses `effectiveTier`.
- Daily generated questions pass `eventQuestionId: null` and later persist generated questions for propagation. This means mastery can accrue before a canonical `Question` exists; later social propagation uses the persisted ID. That is a fragile two-step truth model.

### Share card / progress bars

- Knowledge page uses `KnowledgeCard`, `PortraitCircles`, `SharePortraitModal`, `DomainCard`, and `CategoryGainsDisplay` in summaries.
- Tier-anchored sizing is directionally aligned. The issue is UI proliferation: cards, circles, bars, recap bubbles, and raw totals compete.

### Canonical vs legacy

| System | Canonical PRD 11.1 | Implemented | Legacy/drift |
|---|---|---|---|
| Tiers | establishing/familiar/solid/mastery | Implemented | Display sometimes capitalizes but no old tier names found in core tier code. |
| Points | Backend mastery input, muted UI | Backend + prominent UI | Raw point-first summaries conflict with reflection. |
| Catch-up | Lower weight, non-punitive | 0.25x | UI advertises multiplier, creating punishment feel. |
| Creator points | Others answering authored questions | Source types exist; route consistency needs hard test | Old authorship/generation ambiguity remains. |
| Domain types | declared vs demonstrated | Drizzle `territoryType`; Prisma partly behind | Knowledge UI still manages declared interests in map. |
| Leaderboard | Not a core mechanic | No explicit leaderboard route | Game summaries function like mini leaderboards. |

## 6. UI System Consistency Audit

### Coherence

The app does not yet feel like one coherent product. It has three visual modes:

1. **Chat/gameplay mode:** Daily and Joshing Game play — narrow, sticky input, conversational thread.
2. **Dashboard/card mode:** summaries, Feed, Archive, Account, Question bank.
3. **Custom inline-style portrait mode:** Knowledge page with bespoke styles, toggles, circles, share cards, modals.

### Component duplication / drift

- Progress visuals: `GeometricProgress`, `TierProgressBar`, `DomainProgressBar`, `CategoryGainsDisplay`, `PortraitCircles`, `KnowledgeCard`, `DomainCard`.
- Result displays: Daily result bubbles, Feed result cards, Daily summary `QuestionCard`, Game summary recap articles, Archive result chips.
- Action systems: thumbs/rating buttons appear in Feed, Daily summary, QuestionRatingButtons, archive-like surfaces, and not always with the same explanatory copy.

### Over-boxing / dashboard surfaces

- Daily summary: card inside card, total card, recap cards, growth card, mastery card.
- Knowledge: multiple sections, card shells, modals, maintenance strip, share modal, hidden domains section.
- Game summary: card sections plus table.

### Mobile hierarchy

Gameplay mobile hierarchy is good: one current question + answer input. Non-gameplay pages are dense and action-heavy for mobile, especially Knowledge and summaries.

### CTA consistency

Primary CTAs are inconsistent:

- Home: Daily card + Feed + Catch-up.
- Knowledge: Personal Daily link, Share portrait, Send friend question, Write question, Tidy, Re-open domains, Manage interests, Swap/Add.
- Summary: See Knowledge map + Back home + per-card thumbs/send/bank actions.

Recommendation: one primary action per page; secondary actions behind menus or post-context drawers.

## 7. Conversation-First UX Audit

### Where it succeeds

- Daily and Joshing Game play use a single vertical message thread and sticky answer composer.
- Result copy is gentler than generic trivia.
- Per-answer quip concept exists and is selected server-side in Daily/catch-up routes.
- Reactions and creator notes support post-answer social conversation.

### Where it becomes mechanical

- “Correct / Wrong” badges and color coding are repeated in summaries/archive.
- Points are shown immediately and prominently.
- Group results are rendered as rows, columns, `Y/N`, and `X/5`.
- Knowledge map includes maintenance/settings tools in the identity surface.
- Archive has database-like filters.

### Emotional pacing failures

- Daily session close is too quickly followed by a score dashboard.
- Feed cards expose many choices before the player is emotionally invested.
- Catch-up is framed by reduced points rather than reconnection.
- Ceremony is not clearly the only big reflective moment because summaries already try to do growth recaps.

## 8. Data Model Audit

### Prisma schema

Prisma represents an older MVP private-groups architecture:

- `Group`, `GroupMember`, `Game`, `GameQuestion`, `DailySession`, `DailyAssignment`, `Answer`.
- `StarVote`, `CompatibilityScore`, `GroupKnowledgeMap`.
- Timer remnants: `response_time_ms`, `question_presented_at`.
- Challenge/expert-challenge tables.
- `MasteryTier` and `MasterySourceType` exist, but Prisma is missing or behind on several v11.1 Drizzle fields (`territoryType` on player mastery, feed items, JoshingGame tables, friend invitations).

### Drizzle schema

Drizzle appears to be the active v11.1 application schema:

- `users` includes onboarding and profile fields.
- `questions` includes generated question source, `sharedToFriendsFeed`, `surfacePriorityScore`.
- `playerMastery`, `masteryEvents`, `declaredInterests`, `dailyQueues`, `generatedQuestions`, `feedItems`, `feedDismissedDomains`, `friendships`, `friendInvitations`, `joshingGames`, `joshingGameRecipients`, `joshingGameQuestions`, `joshingGameResponses`, `biweeklyCeremonies`, `activityItems`.

### Dangerous coupling

- **DailyQueue JSON slots:** answer state, submitted answer, reveal answer, reveal explainer, breadcrumb, quip, points, skip/dismiss flags are stored in one JSON array. This couples UI state, grading, reveal state, summary, archive, catch-up, and propagation.
- **GeneratedQuestion → Question persistence:** Daily answers first reference generated IDs; feed propagation later persists the generated question to a canonical `Question`. This creates two identifiers for one played item.
- **Mastery event uniqueness:** unique constraints with nullable question IDs and synthetic answer IDs need database-specific scrutiny; nullable unique composites can allow unexpected duplicates.
- **Dual ORMs:** Prisma and Drizzle both exist; code predominantly imports Drizzle, but Prisma schema remains. Migration/source-of-truth confusion is high.

### Missing or weak indexes / constraints

- `FeedDismissedDomain` uses indexes but not the PRD-specified partial unique active dismissal constraint. Multiple active dismissals are possible unless app code prevents them.
- `feedItems` lacks an explicit uniqueness constraint for `(recipientUserId, questionId, sourceUserId)` even though propagation checks for it manually. Race conditions could duplicate items.
- `DailyQueue.slots` JSON cannot be indexed for answer state/dismissal/slot-level question ID.

### Ownership of truth concerns

- Answer history is split across queue JSON, `joshingGameResponses`, mastery events, archive queries, Feed item state, and potentially old Prisma `Answer`.
- Domain membership is split across declared interests and player mastery; v11.1 wants a coherent KB domain model with declared/demonstrated metadata.
- Question quality signals are split between `questionFeedback`, `questionRatings`, and question surface priority.

## 9. Legacy Drift Report

### Legacy systems still present

- Old group game models and routes/components: `Group`, `Game`, `GameQuestion`, `GroupKnowledgeMap`, game details mode sections.
- Star voting: `StarVote`, SMS `star_notification`.
- Compatibility/alignment scoring: `CompatibilityScore` and PRD alignment structures.
- Timer remnants: `response_time_ms`, `question_presented_at`; old expiry reminder SMS types.
- Challenge/expert challenge tables, likely from earlier PRD phases.
- Archive/dashboard filters and correct/incorrect result chips.
- Game summary table functioning as leaderboard/social scorecard.
- `sharedToFriendsFeed` field retained in Drizzle `questions`; PRD says broadcast share is killed at application layer. It may be migration-safe but should be quarantined.
- `authored_shared` was not found as an active app source in the audited files, which is good.

### Dead/hidden feature flags

No centralized feature-flag module was found. Feature behavior is currently controlled by routes, schema fields, and dormant tables rather than explicit flags. This makes legacy systems harder to kill safely.

### Zombie components / patterns

- `src/components/games/game-details-mode-sections.tsx` and `interpretive-sections.tsx` suggest v10.25 game summary salvage.
- Multiple knowledge visualization components coexist without a single display system owner.
- Old PRD audits (`PRD-AUDIT.md`, `PRD-V11.1-AUDIT.md`, `PRD-V11.1-AUDIT-2.md`) document prior conformance but not this holistic UX/product audit.

## 10. Implementation Plan Alignment Matrix

The requested `Master_App_Instructions-v2.md`, `Joshing_Implementation_Plan_v2.md`, `CLAUDE.md`, and `AGENTS.md` were not present in `/workspace` during this audit. Alignment below is therefore based on PRD 11.1, `_docs/PRD11.md`, `_docs/PRD-v11.1.md`, existing audits, and code.

| System | Built? | Built correctly according to PRD? | Status |
|---|---:|---:|---|
| Daily Five chat thread | Yes | Mostly | Mostly complete |
| Daily question generation from KB | Yes | Mostly | Mostly complete |
| Daily summary close copy | Yes | Partially | Complete but drifted |
| Per-answer quips | Yes | Partially | Partial; server-side in Daily/catch-up, persistence is JSON-slot not durable answer table |
| Onboarding cultural anchor | Yes | Needs UX verification | Mostly complete |
| Pre-seeded invitation onboarding | Schema yes | Unclear | Partial |
| Feed friend-answer propagation | Yes | Mostly | Mostly complete; race constraints missing |
| Feed thumbs-up/down semantics | Yes | Mostly | Mostly complete |
| Feed domain dismissal/reopen | Yes | Mostly | Partial; uniqueness/toast/UX concerns |
| Feed reactions | Yes | Partial | Partial |
| Knowledge tier-anchored circles | Yes | Mostly | Mostly complete |
| Knowledge Grow your map | Yes | Mostly | Mostly complete |
| Declared interests moved to Account | No | No | Drifted; still managed in Knowledge |
| Authorship opens declared territory | Yes | Needs deeper route verification | Partial/mostly |
| Authored → demonstrated promotion | Yes | Partial | Partial |
| Joshing Game creation/play | Yes | Mostly | Mostly complete |
| Joshing Game summary | Yes | No | Built but drifted |
| Ceremony | Yes | Partial | Partial |
| Archive | Yes | Partially | Built but dashboard-ish |
| Account/settings | Yes | Partial | Partial |
| Domain merge/split | Some tidy tooling | UX questionable | Partial |
| Friend invitations/friend graph | Schema/services | UX route unclear | Partial |
| SMS notifications | Some infrastructure | Unknown | Partial |
| Schema canonicalization | No | No | Dangerous drift |
| Legacy cleanup | No | No | Not started |

## 11. Critical Recommendations

### Critical

1. **Rebuild summary surfaces around reflection, not scoring.** Daily summary and Game summary are the most visible contradictions of PRD 11.1.
2. **Declare a single schema source of truth.** Either remove Prisma from active development or update it to match Drizzle and v11.1; do not keep two divergent schemas.
3. **Normalize answer state.** Introduce durable answer rows for Daily/Feed/Generated questions or a unified `PlayAnswer` table.
4. **Move declared-interest management out of Knowledge.** PRD explicitly moves swap flow to Account.
5. **Quarantine legacy group/star/timer/compatibility systems.** Remove from UI and app code or mark database-only with tests preventing use.

### Important

1. Replace raw points in UI with tier/identity language except in detailed/secondary views.
2. Add DB constraints for Feed idempotency and active domain dismissal uniqueness.
3. Convert Knowledge page maintenance into an internal/admin route or Account setting.
4. Strengthen invitation acceptance/onboarding emotional copy.
5. Make catch-up feel like continuity, not devalued scoring.
6. Add route-level UX tests for one-primary-action pages.
7. Create a product terminology glossary and lint copy for `score`, `leaderboard`, `wrong`, `points`, `season` misuse.

### Nice to have

1. Add a “why this question?” conversational line in Daily.
2. Add friend-profile entry points promised by PRD.
3. Improve share cards with privacy/expiry clarity.
4. Consolidate knowledge visual components.
5. Add screenshots/storybook snapshots for all primary gameplay states.

## 12. Concrete Fix List

| # | Problem | Why it matters | Exact files/components/services involved | Suggested solution | Risk | Complexity |
|---:|---|---|---|---|---|---|
| 1 | Daily summary leads with points and “How You Did.” | Contradicts reflection-over-dashboard philosophy. | `src/app/daily/summary/page.tsx`, `src/components/review/*` | Make first screen PRD score line + delayed interpretive line; put points in secondary details. | High | M |
| 2 | Game summary includes score table and `Y/N` matrix. | Turns social game into competition. | `src/app/games/[id]/summary/page.tsx` | Rebuild sections as Story / Your Game / Discovery / Everyone with narrative cards. | High | L |
| 3 | Knowledge page owns too many jobs. | Creates dashboard/admin feel and weak hierarchy. | `src/app/knowledge/page.tsx` | Keep portrait/map/grow card only; move interests to Account; move tidy/hidden domains to settings. | High | L |
| 4 | Declared interests still managed from Knowledge. | Direct PRD 11.1 contradiction. | `src/app/knowledge/page.tsx`, `src/app/account/page.tsx`, interest APIs | Add Account Manage interests route/modal; remove Knowledge modal entry. | High | M |
| 5 | Daily answer state stored in JSON slots. | Hard to query, audit, dedupe, and trigger ceremonies from. | `src/server/db/schema.ts`, `src/server/db/queries/daily.ts`, `src/app/api/daily/answer/route.ts`, catch-up/summary/archive routes | Add normalized DailyAnswer/PlayAnswer table; migrate summary/archive/ceremony to it. | High | XL |
| 6 | Prisma and Drizzle schemas diverge. | Migration and type truth risk. | `prisma/schema.prisma`, `src/server/db/schema.ts` | Pick canonical ORM/schema; update or retire the other. | High | XL |
| 7 | Feed idempotency enforced only in app code. | Race can create duplicate Feed cards. | `src/server/feed/create-feed-items-for-answer.ts`, `src/server/db/schema.ts` | Add unique index for active `(recipientUserId, questionId, sourceUserId)` or source event key. | High | M |
| 8 | Dismissed domains lack active unique constraint. | Reopen/dismiss cycles can duplicate rows. | `src/server/db/schema.ts`, `/api/feed/dismiss-domain` | Add partial unique index `(userId, canonicalSubcategory) WHERE reinstatedAt IS NULL`. | Medium | M |
| 9 | Catch-up boundary helpers disagree. | Seven-day eligibility can differ by route/service. | `src/server/daily/catchup.ts`, `src/server/play/catch-up-eligibility.ts` | Delete duplicate helper or align inclusive/exclusive boundary with tests. | Medium | S |
| 10 | Catch-up UI exposes `0.25x points`. | Makes missed days feel punished. | `src/app/page.tsx`, catch-up page | Rephrase as “questions you missed” and hide multiplier in details. | Medium | S |
| 11 | Feed cards expose too many simultaneous actions. | Breaks conversation-first rhythm. | `src/components/FeedList.tsx` | Progressive disclose: primary Answer; secondary menu for skip/dismiss/not-my-focus. | Medium | M |
| 12 | Raw point leakage in Knowledge card and Feed. | Reinforces score-chasing. | `src/app/knowledge/page.tsx`, `src/components/knowledge/*`, `src/components/FeedList.tsx` | Use tier/progress language; move raw totals to expandable details. | Medium | M |
| 13 | Timer remnants remain in schema. | Risk of reintroducing speed pressure. | `prisma/schema.prisma` `Answer.response_time_ms`, `question_presented_at`; searches for timer logic | Remove or mark database-only; add tests that no UI uses timers. | Medium | M |
| 14 | Star/compatibility/group legacy remains. | Confuses product model and future implementation. | `prisma/schema.prisma`, old game components | Archive or delete unused models/components after migration confirmation. | Medium | L |
| 15 | Ceremony data depends on derived mastery events. | Ceremony may miss emotional beats. | `src/server/ceremony/*`, `src/server/mastery/*`, Daily/Joshing answer routes | Emit explicit lifecycle events for new territory, authored promotion, friend shaped map. | Medium | L |
| 16 | GeneratedQuestion → Question persistence is late. | Two IDs for one played question complicate Feed/archive/mastery. | `src/server/questions/persist-generated-question.ts`, Daily answer routes, mastery write | Persist canonical Question before queue/play or store stable mapping at generation. | High | L |
| 17 | “Season” copy appears in one-off game summary. | Terminology drift confuses lifecycle. | `src/app/games/[id]/summary/page.tsx` | Replace with “this game” or “this round.” | Low | S |
| 18 | Feature flags are implicit. | Legacy behavior cannot be safely switched off. | Whole app; no central flag file found | Add typed feature flag registry for migration-only/legacy gates. | Medium | M |
| 19 | Question archive feels like admin log. | Review should feel reflective, not evaluative. | `src/app/archive/page.tsx`, `/api/archive` | Reframe as “questions you’ve met”; soften filters and result labels. | Medium | M |
| 20 | Home embeds mini Feed. | Home violates one-primary-action rule. | `src/app/page.tsx`, `src/components/TodaysFiveCard.tsx`, `src/components/FeedList.tsx` | Replace embedded cards with quiet Feed count/link. | Medium | S |

## 13. Evidence Checklist

Reviewed / inspected during audit:

- PRD documents: `_docs/PRD11.md`, `_docs/PRD-v11.1.md`.
- Existing audits: `PRD-AUDIT.md`, `PRD-V11.1-AUDIT.md`, `PRD-V11.1-AUDIT-2.md`.
- Route inventory under `src/app`.
- Prisma schema: `prisma/schema.prisma`.
- Drizzle schema: `src/server/db/schema.ts`.
- Core gameplay: `src/app/daily/page.tsx`, Daily/catch-up answer APIs, `src/components/play/GameplayChat.tsx`, `src/app/games/[id]/play-client.tsx`.
- Feed services/components: `src/components/FeedList.tsx`, `src/server/feed/create-feed-items-for-answer.ts`, Feed API routes.
- Mastery services: `src/server/mastery/tiers.ts`, `tier-progress.ts`, `write-mastery-event.ts`, ceremony services.
- Knowledge page/components: `src/app/knowledge/page.tsx`, `src/components/knowledge/*`.
- Joshing Game query/service/page/summary files.

Files requested by the prompt but not found in `/workspace`:

- `Master_App_Instructions-v2.md`
- `Joshing_Implementation_Plan_v2.md`
- `CLAUDE.md`
- `AGENTS.md`

