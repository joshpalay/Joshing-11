# PRD v11.1 Audit — Joshing v11.1 Codebase vs PRD + Prompt 9.0–10.4 Expectations

Audit date: 2026-05-11  
Repository: `/workspace/Joshing-11`  
Methodology: read implementation bodies and route/component wiring, then marked each requirement as:

- ✅ COMPLETE — matches PRD behavior, code is real and wired in
- 🟡 PARTIAL — implemented but missing pieces
- 🔴 MISSING — no implementation found
- ⚠️ DIVERGENT — implemented differently than PRD
- ❓ UNCLEAR — cannot verify by reading/local environment

## Section 1 — Build Health

### Commands run

- `npx tsc --noEmit`
  - ✅ Success, exit code 0.
  - npm warning only: `npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.`
  - Total TypeScript errors: 0.
- `npm run build`
  - ⚠️ Failed due to environment/network font fetch, not application TypeScript.
  - Error excerpt:
    ```text
    Turbopack build encountered 1 warnings:
    [next]/internal/font/google/montserrat_a93acac.module.css
    Error while requesting resource
    There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=swap

    > Build error occurred
    Error: Turbopack build failed with 1 errors:
    [next]/internal/font/google/montserrat_a93acac.module.css
    next/font: error:
    Failed to fetch `Montserrat` from Google Fonts.
    ```
- `npm run dev`
  - 🟡 Starts cleanly enough to reach `✓ Ready in 2.9s`, but emits a startup warning/error from instrumentation migration because the local database connection is refused.
  - Warning excerpt:
    ```text
    [instrumentation] DB migration failed — server will start but schema may be out of date: Error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
    [cause]: AggregateError ... code: 'ECONNREFUSED'
    ✓ Ready in 2.9s
    ```
- Search `src/` for `@prisma/client` imports:
  - ✅ None found.
- Confirm `src/lib/prisma.ts` does not exist:
  - ✅ It does not exist.
- Total file count under `src/`:
  - 246 files.

## Section 2 — Prompt 9.0: Broadcast Share Rollback

### 2.1 `QuestionForm` destinations panel (`src/components/QuestionForm.tsx`)

- ✅ `"Share with friends"` broadcast toggle absent.
- ✅ `"Save to bank"` remains as locked-on default: rendered as checked, read-only, disabled.
- ✅ `"Send to specific friends"` remains toggleable via `state.specificMode`.
- ✅ Helper text does not reference broadcast share; it says either `Sent directly to the friends you pick.` or `Saved to your bank.`
- ✅ Toast copy `Saved and shared with your friends.` is absent.

### 2.2 Question creation API (`src/app/api/questions/route.ts` POST)

- ✅ `shareToFeed` branch removed; no `shareToFeed` references in route.
- ✅ `authored_shared` `FeedItem` creation loop removed from route.
- ✅ Specific-friend send branch intact and validates against actual friends before inserting `direct_sent` feed items.
- ✅ `shareToFeed` removed from request-body parsing/schema.

### 2.3 `FeedList` (`src/components/FeedList.tsx`)

- ✅ `authored_shared` visual variant removed: no `✎`, no `wrote this` attribution, and card rendering only special-cases `direct_sent`, `friend_answered`, `joshing_game`, and legacy fallback attribution.

### 2.4 Feed query (`src/server/db/queries/feed.ts` / `src/app/api/feed/route.ts`)

- ✅ `authored_shared` rows are handled inertly at API response level: `/api/feed` filters them out after `getFeedForUser` returns raw/collapsed rows.
- 🟡 `getFeedForUser` itself does not filter `authored_shared`; filtering is done in the API route. This is likely acceptable for the current feed surface, but any direct server-side caller of `getFeedForUser` would still receive legacy rows.

### 2.5 Thumbs-down inline confirmation

- ✅ `Removed from your feed. Won’t pass to your friends.` copy present. Note: uses curly apostrophe `Won’t`, not ASCII `Won't`.
- ✅ `Restored. This may pass to your friends.` copy present.
- ✅ 4-second display/removal behavior implemented via `setTimeout(..., 4000)` for both removed and restored states.

### 2.6 Cleanup script

- ✅ `scripts/cleanup-authored-shared-feed-items.ts` exists.
- ✅ Has both apply and non-apply behavior; `--apply` mutates, absence of `--apply` does dry-run behavior.
- 🟡 The script does not expose an explicit `--dry-run` flag in code; it defaults to dry-run by virtue of `const APPLY = args.includes('--apply')`.

## Section 3 — Prompt 9.1: Categorizer Fix

### 3.1 Granularity prompt

- ✅ Daily generation categorization prompt contains explicit `GRANULARITY RULES` section.
- ✅ Prompt lists GOOD vs BAD label examples.
- ✅ Prompt forbids facet-level qualifiers including themes, characters, structure, technique, form, and style.
- 🟡 The strongest granularity prompt is in `src/server/daily/generate-questions.ts`. Question authoring currently appears to use user-selected broad domains from `QuestionForm`, not a full LLM categorization prompt with reconciliation after creation.

### 3.2 Reconciliation function

- ✅ `reconcileProposedDomain` exists in `src/lib/questions/categorization.ts`.
- ✅ Fetches existing user domains before the LLM call via `getKnowledgeBase(userId)`.
- ✅ Uses a Haiku-style fast model constant: `claude-haiku-4-5`.
- ✅ Has a 3-second timeout with graceful fallback.
- ✅ Returns `{ canonicalDomain, reconciled }`.

### 3.3 Wiring

- 🔴 Question creation flow does not call `reconcileProposedDomain`; it calls `openKBDomain` with the submitted `domain` value after creating the question.
- ✅ Daily Five generation calls `reconcileProposedDomain` before inserting generated questions.
- ✅ `[reconcile]` log lines emitted for reconciled, non-reconciled, and fallback/error cases.

### 3.4 Daily Five generator

- 🟡 Prompt strongly instructs no facet-narrowing and reconciles proposed domains, but this cannot be fully verified without LLM output/runtime data. The code does not include a deterministic post-generation validator that rejects facet-y domains.

## Section 4 — Prompt 9.2: Domain Backfill

### 4.1 `runAggressiveDomainBackfillForUser`

- ✅ Function exists in `src/server/mastery/ceremony.ts`.
- ✅ Contains an aggressive merge prompt explicitly enforcing facet-into-parent merges.
- ✅ Reuses transactional merge machinery for applying merges.

### 4.2 Manual trigger endpoint

- ✅ `src/app/api/admin/backfill-domains/route.ts` exists.
- 🟡 Requires CRON secret only if a secret exists. If neither `CRON_SECRET` nor `VERCEL_CRON_SECRET` is configured, `isAuthorized` returns `true`. That is operationally convenient but not a strict PRD “requires secret” implementation.
- ✅ Supports `userId` in POST body for single-user mode.
- ✅ Supports `dryRun` in POST body.

### 4.3 CLI script

- ✅ `scripts/backfill-domains.ts` exists.
- ✅ Supports `--apply` and defaults to dry-run.
- ✅ Supports `--user-id=...`.
- 🟡 Does not explicitly parse `--dry-run`; dry-run is default unless `--apply` is present.
- ✅ Has run-sequence comment block at top.

### 4.4 Production state

- ❓ UNCLEAR. There is no database access in this audit. Recommended manual check:
  ```sql
  select user_id, count(distinct canonical_subcategory)
  from "PLAYER_MASTERY"
  group by user_id
  order by count desc;

  select canonical_subcategory
  from "PLAYER_MASTERY"
  where canonical_subcategory ilike '%themes%'
     or canonical_subcategory ilike '%characters%'
     or canonical_subcategory ilike '%structure%'
     or canonical_subcategory ilike '%symbolism%'
     or canonical_subcategory ilike '% – %'
     or canonical_subcategory ilike '% & %'
  limit 100;
  ```

## Section 5 — Prompt 10.1: Feed Redesign (Friend-Answered Propagation)

### 5.1 Schema additions

- 🟡 `feed_items.sourceResult` column exists as text and nullable, but not as a database enum constrained to `correct | incorrect`.
- ✅ `feed_items.sourceUserId` exists and references `User.id`.
- 🟡 `FeedDismissedDomain` table exists with `id`, `userId`, `canonicalSubcategory`, `dismissedAt`, and `reinstatedAt`; PRD asked for a `domain` field name, but canonical subcategory is semantically equivalent.
- 🔴 No partial unique constraint on `(userId, domain)` where `reinstatedAt IS NULL`; only indexes exist. Duplicate active dismissals are prevented by application check, not schema.
- ✅ `questions.surfacePriorityScore` exists as double precision, not null, default 0.

### 5.2 Propagation function

- ⚠️ DIVERGENT: expected file/function `src/server/feed/propagate-friend-answer.ts` / `propagateFriendAnswerToFeeds` is absent.
- ✅ Equivalent-ish function `createFeedItemsForFriendsFromAnswer` exists in `src/server/feed/create-feed-items-for-answer.ts`.
- ✅ Skips friends who have correctly answered the question via `userAnsweredQuestionCorrectly`.
- ✅ Skips friends who dismissed the domain.
- ✅ Skips idempotent duplicates for same recipient/question/source user.
- ✅ Checks answering user's thumbs-down via both `QuestionFeedback` and `QuestionRating` before propagating.
- ✅ Wraps in try/catch and suppresses propagation errors.
- 🟡 Writes `ActivityItem` for previous answerers, not specifically “question author when applicable.” It selects previous answerers from `masteryEvents`, so an author who did not answer their own question may not be notified.

### 5.3 Wiring into answer endpoints

- ⚠️ All four answer endpoints call `createFeedItemsForFriendsFromAnswer`, not the expected `propagateFriendAnswerToFeeds` symbol.
- ✅ `src/app/api/daily/answer/route.ts` calls propagation-equivalent function.
- ✅ `src/app/api/feed/[feedItemId]/answer/route.ts` calls propagation-equivalent function.
- ✅ `src/app/api/joshing-games/[id]/answer/route.ts` calls propagation-equivalent function.
- ✅ `src/app/api/daily/catchup/answer/route.ts` calls propagation-equivalent function.

### 5.4 Thumbs-down updates

- ✅ On thumbs-down via question rating, soft-deletes feed items where `sourceUserId = currentUser` and `questionId = this question`.
- ✅ Also soft-deletes current user's own feed items for the question.
- ✅ Inline confirmation copy still present in `FeedList`.
- 🟡 Feed item `/thumbsdown` route was not deeply audited in this pass, but question-rating path implements the PRD behavior.

### 5.5 Thumbs-up updates

- ✅ Increments `questions.surfacePriorityScore` on thumbs-up.
- ✅ Decrements on un-thumbs-up or switching away from up.
- ✅ Does not create friend FeedItems in `setRating`.

### 5.6 Feed query updates

- 🟡 Orders pinned separately from non-pinned, and non-pinned by `surfacePriorityScore DESC`, then `sourceEventAt DESC`. Pinned are ordered by `sourceEventAt DESC`, not `surface_priority_score DESC` inside pinned.
- ✅ Filters out items where question domain is dismissed for current user.
- 🟡 Hydrates source result/source user/answer-ish state/reaction-ish state partially. API returns `source_result`, `source_friend_display_name`, `friend_results`, `is_in_bank`, but does not visibly hydrate current user's prior answer result for already answered feed items beyond local `state` and answer submission response.
- ✅ Multi-friend collapse logic present, returning primary source and `friendResults`/additional endorsers.
- ✅ Limits to all pinned + 25 non-pinned after filtering.

### 5.7 Dismiss-domain endpoints

- ⚠️ DIVERGENT route split:
  - `POST /api/feed/dismiss-domain` exists.
  - `DELETE /api/feed/dismiss-domain` exists.
  - `GET` does **not** exist on that route; instead `GET /api/feed/dismissed-domains` lists dismissed domains.
- ✅ POST soft-deletes existing feed items in that domain.
- ✅ DELETE reopens a domain by setting `reinstatedAt`.

### 5.8 `FeedList` component

- ✅ Direct-send and friend-answered variants exist; no authored-shared variant.
- 🟡 Three card variants include `direct_sent`, `friend_answered`, and `joshing_game`, not strictly three question card variants.
- ✅ Friend-answered attribution copy renders as `[Friend] got this right — [Domain]` / `[Friend] couldn't get this — [Domain]` from API.
- ✅ Multi-friend collapsed copy renders with ` · ` between friends.
- 🟡 Pre-answer actions are present but labels differ from PRD: primary button says `Send` rather than `Answer`; skip/dismiss are icon-only buttons; `Not my focus` is labeled.
- ✅ Post-answer state shows user result plus friend comparison for friend-answered items.
- 🟡 `Not my focus` calls dismiss-domain endpoint and creates toast string `Got it. No more [Domain] questions.`, but because the local item is immediately removed from `items`, the toast may not be visible on that removed card.

### 5.9 Knowledge page Hidden Domains section

- ✅ `src/app/knowledge/page.tsx` contains a Hidden Domains section.
- ✅ Lists dismissed domains with Re-open buttons.
- ✅ Re-open calls DELETE endpoint and removes optimistically.

### 5.10 Empty Feed states

- ✅ No friends: `When your friends play, their best questions will show up here.`
- ✅ Friends but no items: `Quiet today. Check back when your friends have played.`
- ✅ All handled: `You're caught up.`
- ✅ All dismissed/focused: `You've focused your Feed. You can re-open domains from your Knowledge page.`

### 5.11 ActivityItem rendering

- ✅ `friend_answered_your_question` added to `ActivityItemType` union.
- ✅ Renders in `/activities` with right/couldn't-get-it copy.
- 🟡 Hydrates result by looking for a positive `masteryEvents` row for the actor/question; it does not read metadata from `ActivityItem` because `ActivityItem` schema has no metadata column.

## Section 6 — Prompt 10.2: Authorship Opens Territory

### 6.1 Schema

- ✅ `PLAYER_MASTERY.territoryType` exists.
- ✅ Values are typed in TS as `declared | demonstrated`, not null, default `demonstrated`.
- 🟡 Existing-row backfill cannot be verified from schema alone. Default applies to future inserts; migration history not fully audited here.

### 6.2 Centralized `openKBDomain`

- ✅ `src/server/knowledge/open-domain.ts` exists.
- ✅ `openKBDomain` exists with signature accepting `userId`, `domain`, `via`, optional `broadCategory`, optional `questionId`.
- ✅ Idempotent: returns `alreadyExisted: true` when a PlayerMastery row exists.
- ✅ Sets territory type as `declared` for `via='authorship'`, `demonstrated` otherwise.

### 6.3 `promoteDeclaredToDemonstrated`

- ✅ Exists in same file.
- ✅ Updates `territoryType` to `demonstrated`.
- ✅ Writes `MasteryEvent` with `sourceType='declared_promoted'`.
- ✅ Writes `ActivityItem` with `type='declared_promoted'`.

### 6.4 Authorship wiring

- ✅ Question POST calls `openKBDomain` after question creation.
- ✅ Passes `via='authorship'`.
- 🟡 Toast/helper text in `QuestionForm` does not visibly mention “declared territory.” API returns `declaredTerritoryOpened`, but UI copy was not found using that language.

### 6.5 Promotion wiring

- ✅ Feed answer route calls `promoteDeclaredToDemonstrated` when correct and author differs from answerer.
- ✅ Joshing game answer route calls it when correct and author differs from answerer.
- ✅ Daily/catchup answer routes call it when correct and author differs from answerer; for generated dailies this usually no-ops because creator/source creator is null or not a human author.

### 6.6 Daily Five weighting

- 🟡 Daily generator includes declared at 50% probability and demonstrated at full eligibility, but as hardcoded `DECLARED_DOMAIN_WEIGHT = 0.5`.
- 🔴 Env vars `DAILY_FIVE_DECLARED_WEIGHT` and `DAILY_FIVE_DEMONSTRATED_WEIGHT` were not found.

### 6.7 Visual treatment

- ✅ `DomainCircle` renders declared territory differently with muted/transparent fill.
- 🟡 Domain detail page appears to carry territory type data, but explicit explanatory copy for declared status was not fully verified in this pass.

### 6.8 Ceremony Beat 2 update

- 🟡 `src/server/ceremony/compute-beats.ts` contains logic for declared, promoted, and friend-mediated concepts, but it still references `DeclaredInterest` heavily as well as PlayerMastery-like events. Needs product review to confirm three exact PRD copy cases.

### 6.9 ActivityItem type

- ✅ `declared_promoted` added to `ActivityItemType` union.
- ✅ Renders in `/activities` with “proven territory” copy and a map link.

## Section 7 — Prompt 10.3: Onboarding Cultural Anchor

### 7.1 Schema

- ✅ `User.birthYear` exists.
- ✅ `User.grewUpCountry` exists.
- ✅ `User.grewUpRegion` exists.

### 7.2 LLM proposal update

- ✅ `proposeInterests` accepts `culturalAnchor`.
- ✅ LLM prompt includes culturally anchored instructions and examples.
- ✅ Prompt asks for exactly 10 to 14 candidate interests; fallback/padding slices to max 14 and pads when fewer than 10.

### 7.3 propose-interests API

- ✅ Accepts `culturalAnchor` in request body.
- ✅ Validates birth year between 1920 and current year minus 13.
- ✅ Validates grew-up country against ISO codes (also allows `OTHER`, which is divergent from strict ISO-only wording).
- ✅ Saves anchor to `User` table before calling LLM.

### 7.4 OnboardingFlow component

- ✅ Cultural-anchor step exists between welcome and warmup.
- ✅ Year picker/input exists for birth year.
- 🟡 Country selector exists, but is a native select rather than a clearly searchable list.
- ✅ US region selector appears when country is US.
- ✅ Required validation blocks continue until birth year/country/US region are valid.

### 7.5 Warmup step revision

- ✅ Warmup fields trimmed to `deepDive`, `hourLongTopic`, and `anythingElse`.
- ✅ First two are required; third optional.
- ✅ Validation requires both required fields before proposal.

### 7.6 Country/region data

- ✅ `src/lib/onboarding/countries.ts` exists with country/ISO data.
- ✅ `src/lib/onboarding/us-regions.ts` exists with US state/region codes.

### 7.7 Existing users not affected

- ✅ Onboarding page/server logic still keys off `onboardingComplete`; existing onboarded users skip onboarding/cultural anchor.

## Section 8 — Prompt 10.4: Joshing Commentary

### 8.1 Schema

- 🟡 No separate `daily_answers` table found in `src/server/db/schema.ts`. Daily answer data appears to be recorded through queue/mastery paths; schema requirement cannot map 1:1.
- ✅ `joshing_game_responses.quip` exists.
- ✅ `feed_items.quip` exists for feed answer storage.

### 8.2 `selectQuip`

- ✅ `src/server/grading/select-quip.ts` exists.
- ✅ All 6 quip banks present.
- 🟡 ≤8 words is enforced by tests, not runtime assertions.
- ✅ `{name}` substitution works.
- 🟡 Edge cases: friendResult null is handled, joshing_game is treated like feed, partial/correct branch covered by tests. Multi-recipient joshing uses most recent other response, not a richer multi-recipient selection model.

### 8.3 Wiring into answer endpoints

- ✅ Daily answer calls `selectQuip` and returns `quip`; persistence is not clearly tied to a `daily_answers.quip` row because no such table exists.
- ✅ Feed answer calls `selectQuip`, persists `feedItems.quip`, returns `quip`.
- ✅ Joshing answer calls `selectQuip`, persists `joshingGameResponses.quip`, returns `quip`.
- ✅ Catchup answer calls `selectQuip` and returns `quip`; persistence mapping is same caveat as daily.

### 8.4 Chat thread rendering

- ✅ `GameplayChat.tsx` renders quip below result bubble.
- ✅ Style uses muted, italic, small text and 150ms delay.
- ✅ Order appears result → breadcrumb/context → quip in the message body.

### 8.5 Interpretive line

- ⚠️ DIVERGENT: expected `src/server/daily/select-interpretive-line.ts` does not exist.
- 🟡 Equivalent logic is implemented client-side inside `/daily/summary/page.tsx`, with priority cases for tier crossing, new domain, 5/5, 0/5, 3+ in a row, all wrong in domain, fallback null.

### 8.6 Session close render

- ✅ `/daily/summary` renders interpretive line below score/growth recap area.
- ✅ Uses 300ms delay.
- ✅ Returns null gracefully when no match.
- ⚠️ Logic lives client-side, not server-side as requested.

### 8.7 Tests

- ✅ `src/server/grading/select-quip.test.ts` exists.
- ✅ Tests verify ≤8 word constraint.
- ✅ Tests cover daily/feed/joshing/null-friend/name-substitution/partial-like contexts.

## Section 9 — PRD v11.1 Cross-Cutting Conformance

### 9.1 Killed concepts

- ✅ `Share with friends` broadcast toggle absent from `QuestionForm`.
- ✅ `authored_shared` visual variant absent from `FeedList`.
- ⚠️ `SpiderGraph` component still exists in `src/components/knowledge/SpiderGraph.tsx`; no evidence it is active as a Knowledge page view option in current page, but the killed concept is not fully removed from codebase.
- ✅ Streak surfacing (`🔥 N day streak`) was not found on Knowledge page.
- 🟡 A `DeclaredInterest` model and interest-management UI still exist. A dedicated `Your Declared Interests` page section was not clearly found on `/knowledge`, but the older concept remains in schema/code.

### 9.2 Required new surfaces

- ✅ `Grow your map` section exists on Knowledge page with add/swap/tidy-style controls.
- 🔴 `Manage interests` link in Account was not found in `src/app/account/page.tsx`.
- ✅ Hidden Domains section exists on Knowledge page.

### 9.3 Circle sizing

- 🟡 Domain circles use tier-based sizing through landscape/overview code and visibly distinguish tiers, but sizing logic is not fully centralized in `DomainCircle` (it receives a `diameter` prop). Need product/code cleanup if strict centralization is required.

### 9.4 Friend graph enforcement

- ✅ `/api/joshing-games` POST validates recipients are friends.
- ✅ `/api/users` returns friends only.
- ✅ `/api/questions/send` validates recipient is a friend.

### 9.5 SMS triggers per §8.11

- 🟡 `SmsMessageType` enum includes `friend_answered_question`, but no concrete sender for friend-answered propagation was verified.
- 🟡 Default opt-in model is user-level `smsOptIn` default `not_asked`; per-trigger opt-in/default-off preference was not found.

### 9.6 Production blockers from prior audit

- ⚠️ OTP still accepts hardcoded `000000` in `verifyOtp` without an environment guard.
- ✅ `/feed` renders `FeedList`, not `FriendsList`.
- 🟡 Vercel cron schedules exist for daily assignments at `0 6 * * *` and biweekly ceremony at `0 8 * * *`; correctness vs PRD schedule needs spec confirmation.
- ✅ `env-check.ts` requires `TWILIO_MESSAGING_SERVICE_SID` along with other Twilio vars.

## Section 10 — Schema Snapshot

### Tables in `src/server/db/schema.ts`

- `users` (`User`): 23 columns
- `userSessions` (`UserSession`): 5 columns
- `otpCodes` (`OtpCode`): 5 columns
- `questions` (`Question`): 48 columns
- `questionAudienceTags` (`QuestionAudienceTag`): 5 columns
- `userQuestionBank` (`UserQuestionBank`): 6 columns
- `playerMastery` (`PLAYER_MASTERY`): 10 columns
- `critiqueUsageDaily` (`CritiqueUsageDaily`): 5 columns
- `masteryEvents` (`MASTERY_EVENTS`): 14 columns
- `questionReactions` (`QuestionReaction`): 10 columns
- `creatorNotes` (`CreatorNote`): 11 columns
- `gradeDisputes` (`GradeDispute`): 9 columns
- `smsLogs` (`SmsLog`): 5 columns
- `generatedQuestions` (`GeneratedQuestion`): 12 columns
- `questionFeedback` (`QuestionFeedback`): 6 columns
- `questionRatings` (`QuestionRating`): 5 columns
- `dailyQueues` (`DailyQueue`): 5 columns
- `dailyPreferences` (`DailyPreference`): 9 columns
- `skippedDailyQuestions` (`SkippedDailyQuestion`): 7 columns
- `userDomainDifficulties` (`USER_DOMAIN_DIFFICULTY`): 7 columns
- `userDomainExclusions` (`USER_DOMAIN_EXCLUSIONS`): 4 columns
- `profileDomainVisibility` (`PROFILE_DOMAIN_VISIBILITY`): 7 columns
- `declaredInterests` (`DeclaredInterest`): 7 columns
- `friendships` (`Friendship`): 10 columns
- `joshingGames` (`JoshingGame`): 5 columns
- `feedItems` (`FeedItem`): 14 columns
- `joshingGameRecipients` (`JoshingGameRecipient`): 4 columns
- `joshingGameQuestions` (`JoshingGameQuestion`): 4 columns
- `joshingGameResponses` (`JoshingGameResponse`): 12 columns
- `biweeklyCeremonies` (`BiweeklyCeremony`): 8 columns
- `activityItems` (`ActivityItem`): 9 columns
- `feedDismissedDomains` (`FeedDismissedDomain`): 5 columns
- `friendInvitations` (`FriendInvitation`): 10 columns

### Required v11.1 schema additions

- ✅ `User.birthYear`, `grewUpCountry`, `grewUpRegion`: PRESENT.
- 🟡 `feed_items.source_result`, `source_user_id`: PRESENT as camelCase schema fields/DB columns `sourceResult`, `sourceUserId`; `sourceResult` is unconstrained text.
- ✅ `questions.surface_priority_score`: PRESENT.
- 🟡 `dismissed_domains`: PRESENT as `FeedDismissedDomain`; no partial unique active-dismissal constraint.
- ✅ `PlayerMastery.territoryType`: PRESENT.
- 🟡 `daily_answers.quip` and equivalents: no daily answers table; `FeedItem.quip` and `JoshingGameResponse.quip` are PRESENT.

### Required v11.0 schema already in place

- ✅ `DeclaredInterest`: PRESENT.
- ✅ `Friendship`: PRESENT.
- ✅ `FeedItem`: PRESENT.
- ✅ `JoshingGame*`: PRESENT (`JoshingGame`, recipients, questions, responses).
- ✅ `BiweeklyCeremony`: PRESENT.
- ✅ `ActivityItem`: PRESENT.
- ✅ `FriendInvitation`: PRESENT.
- ✅ `QuestionRating`: PRESENT.
- ✅ `CreatorNote`: PRESENT.

### Extra tables not clearly in v11.0/v11.1 list

- `UserSession`, `OtpCode`, `QuestionAudienceTag`, `UserQuestionBank`, `CritiqueUsageDaily`, `MASTERY_EVENTS`, `QuestionReaction`, `GradeDispute`, `SmsLog`, `GeneratedQuestion`, `QuestionFeedback`, `DailyQueue`, `DailyPreference`, `SkippedDailyQuestion`, `USER_DOMAIN_DIFFICULTY`, `USER_DOMAIN_EXCLUSIONS`, `PROFILE_DOMAIN_VISIBILITY`.

## Section 11 — Route Inventory

### API routes and HTTP methods

- `src/app/api/account/adaptive-level/route.ts`: GET
- `src/app/api/account/logout/route.ts`: POST
- `src/app/api/account/route.ts`: GET, PATCH
- `src/app/api/activities/read/route.ts`: POST
- `src/app/api/activities/route.ts`: GET
- `src/app/api/admin/backfill-domains/route.ts`: POST
- `src/app/api/archive/route.ts`: GET
- `src/app/api/auth/logout/route.ts`: POST
- `src/app/api/auth/me/route.ts`: GET
- `src/app/api/auth/request-otp/route.ts`: POST
- `src/app/api/auth/verify-otp/route.ts`: POST
- `src/app/api/bank/check/route.ts`: POST
- `src/app/api/bank/route.ts`: GET, POST, DELETE
- `src/app/api/ceremony/[ceremonyId]/route.ts`: GET
- `src/app/api/ceremony/[ceremonyId]/share-token/route.ts`: POST
- `src/app/api/ceremony/[ceremonyId]/viewed/route.ts`: POST
- `src/app/api/ceremony/banner/route.ts`: GET
- `src/app/api/creator-notes/[id]/delivered/route.ts`: POST
- `src/app/api/creator-notes/route.ts`: POST
- `src/app/api/cron/biweekly-ceremony/route.ts`: GET
- `src/app/api/cron/daily-assignments/route.ts`: GET
- `src/app/api/daily/answer/route.ts`: POST
- `src/app/api/daily/catchup/answer/route.ts`: POST
- `src/app/api/daily/catchup/dismiss/route.ts`: POST
- `src/app/api/daily/catchup/route.ts`: GET
- `src/app/api/daily/feedback/route.ts`: POST
- `src/app/api/daily/preferences/route.ts`: GET, PATCH
- `src/app/api/daily/queue/route.ts`: GET, POST
- `src/app/api/daily/reset/route.ts`: POST
- `src/app/api/daily/skip/route.ts`: POST
- `src/app/api/daily/status/route.ts`: GET
- `src/app/api/daily/summary/route.ts`: GET
- `src/app/api/declared-interests/route.ts`: GET, PATCH
- `src/app/api/feed/[feedItemId]/answer/route.ts`: POST
- `src/app/api/feed/[feedItemId]/state/route.ts`: PATCH
- `src/app/api/feed/[feedItemId]/thumbsdown/route.ts`: POST, DELETE
- `src/app/api/feed/[feedItemId]/thumbsup/route.ts`: POST
- `src/app/api/feed/dismiss-domain/route.ts`: POST, DELETE
- `src/app/api/feed/dismissed-domains/route.ts`: GET
- `src/app/api/feed/route.ts`: GET
- `src/app/api/joshing-games/[id]/answer/route.ts`: POST
- `src/app/api/joshing-games/[id]/route.ts`: GET
- `src/app/api/joshing-games/route.ts`: POST
- `src/app/api/knowledge/[domain]/route.ts`: GET, PATCH
- `src/app/api/knowledge/route.ts`: GET
- `src/app/api/knowledge/tidy/route.ts`: POST
- `src/app/api/onboarding/canonicalize/route.ts`: POST
- `src/app/api/onboarding/propose-interests/route.ts`: POST
- `src/app/api/onboarding/save-interests/route.ts`: POST
- `src/app/api/questions/[id]/rating/route.ts`: GET, POST
- `src/app/api/questions/[id]/route.ts`: GET, PATCH, DELETE
- `src/app/api/questions/critique/route.ts`: POST
- `src/app/api/questions/route.ts`: GET, POST
- `src/app/api/questions/send/route.ts`: POST
- `src/app/api/questions/suggest-answer/route.ts`: POST
- `src/app/api/questions/suggest/route.ts`: POST
- `src/app/api/reactions/[id]/reply/route.ts`: POST
- `src/app/api/reactions/route.ts`: POST, GET
- `src/app/api/replay/grade/route.ts`: POST
- `src/app/api/replay/missed/route.ts`: GET
- `src/app/api/share/ceremony/[token]/route.ts`: GET
- `src/app/api/users/route.ts`: GET

### New/modified route checks

- ⚠️ `/api/feed/dismiss-domain`: POST and DELETE present; GET split to `/api/feed/dismissed-domains`.
- ⚠️ `/api/daily/answer`, `/api/feed/[feedItemId]/answer`, `/api/joshing-games/[id]/answer`: call `createFeedItemsForFriendsFromAnswer` + `selectQuip`, not expected `propagateFriendAnswerToFeeds` symbol.
- ✅ `/api/questions` POST calls `openKBDomain`.
- ✅ `/api/questions/[id]/rating` updated for thumbs up/down priority/roll-off behavior.
- ✅ `/api/onboarding/propose-interests` accepts cultural anchor.
- ✅ `/feed` renders `FeedList`, not `FriendsList`.

## Section 12 — End-to-End Flow Verification (read-only)

### 12.1 New user onboarding (10.3)

🟡 PARTIAL/LIKELY COMPLETE: `/login → SMS OTP → /onboarding → welcome → cultural anchor → warmup → review → confirmation → /` is present by reading routes and component state. Caveats: OTP accepts universal `000000`; country selector is not obviously searchable; runtime DB persistence not verified.

### 12.2 Authored question opens declared territory (10.2)

🟡 PARTIAL: QuestionForm → POST `/api/questions` → `openKBDomain({ via:'authorship' })` creates declared `PlayerMastery` row. Knowledge circle can render declared as muted. Missing/partial: user-facing toast/helper does not clearly mention “declared territory.”

### 12.3 Friend-answered Feed propagation (10.1)

🟡 PARTIAL: Answer endpoints call propagation-equivalent `createFeedItemsForFriendsFromAnswer`; new friend feed items can be returned and rendered with friend-answered attribution; subsequent answers propagate onward. Divergence: expected function name/file absent; activity notifications target previous answerers, not strictly question authors; no runtime DB verification.

### 12.4 Declared → demonstrated promotion (10.2 + 10.1)

🟡 PARTIAL/LIKELY COMPLETE: Authorship opens declared PlayerMastery; friend correct answer calls promotion from feed/joshing/daily routes; promotion writes MasteryEvent and ActivityItem; knowledge map can display demonstrated fill. Runtime DB verification not performed.

### 12.5 Quip rendering (10.4)

🟡 PARTIAL: Answer endpoints call `selectQuip`; feed/joshing persist quips and return them; `GameplayChat` renders quip. Caveat: daily/catchup persistence does not map to a `daily_answers.quip` table because none exists.

### 12.6 Session close interpretive line (10.4)

⚠️ DIVERGENT BUT FUNCTIONAL: `/daily/summary` computes priority interpretive line client-side and renders with 300ms delay. Expected server module `src/server/daily/select-interpretive-line.ts` is missing.

### 12.7 Domain reconciliation (9.1)

🟡 PARTIAL: Daily generation has granularity prompt + reconciliation against existing domains. Authored question creation does not reconcile proposed facet-level domains, and authored domain input is broad/category-driven rather than LLM-proposed canonical domain.

### 12.8 Hidden domains flow (10.1)

🟡 PARTIAL/LIKELY COMPLETE: Feed `Not my focus` calls POST, server dismisses active domain feed items, Knowledge page lists hidden domains, Re-open calls DELETE. Caveat: local toast after removing all matching cards may disappear with the removed item.

## Section 13 — TODO Markers

### Friend system/profile/knowledge-card TODOs

- `src/lib/knowledge-card.ts:9` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/lib/knowledge-card.ts:15` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/lib/knowledge-card.ts:21` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/lib/knowledge-card.ts:27` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/lib/knowledge-card.ts:33` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/portrait.ts:38` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/portrait.ts:44` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/portrait.ts:50` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/knowledge.ts:23` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/knowledge.ts:29` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/knowledge.ts:36` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/knowledge.ts:42` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/profile/friend.ts:2` — `// TODO Phase 8: port to Drizzle when friend profiles are built`
- `src/server/mastery/write-mastery-event.ts:57` — `// TODO Phase 8: write friend_mastery activity for each friend when`
- `src/server/db/queries/joshing-game.ts:511` — `// TODO Phase 8: replace with getFriends() when friend system is built.`

### Drizzle/Prisma migration TODOs

- `src/lib/games/winner.ts:10` — `// PrismaClient removed - TODO R2: rewire to Drizzle db client`
- `src/server/daily/mastery.ts:52` — `// TODO R2: complex mastery query — needs full Drizzle rewrite`
- `src/server/mastery/awards.ts:14` — `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.`
- `src/server/mastery/season-snapshot.ts:10` — `// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.`

### v11.0 legacy/group TODOs

- `src/lib/games/winner.ts:40` — `// TODO v11.0: group member lookup needs new data source`
- `src/lib/games/winner.ts:41` — `// TODO v11.0: group lookup needs new data source`
- `src/lib/games/winner.ts:42` — `// TODO v11.0: answer.game_id winner scoping - needs new data source`
- `src/server/sms.ts:155` — `// TODO v11.0: group member lookup needs new data source`
- `src/server/mastery/season-snapshot.ts:32` — `// TODO v11.0: "GroupMember" raw SQL table - needs new data source`

No `FIXME`, `XXX`, or `HACK` matches were found in `src/` by the requested patterns.

## Section 14 — Top Risks

### Top 5 v11.1 requirements missing entirely

1. 🔴 Expected `propagateFriendAnswerToFeeds` file/function is missing; equivalent exists under a different name.
2. 🔴 Expected server module `src/server/daily/select-interpretive-line.ts` is missing.
3. 🔴 `DAILY_FIVE_DECLARED_WEIGHT` and `DAILY_FIVE_DEMONSTRATED_WEIGHT` env vars are missing.
4. 🔴 `GET /api/feed/dismiss-domain` is missing; GET is split to `/api/feed/dismissed-domains`.
5. 🔴 `Manage interests` link in Account was not found.

### Top 5 partial/divergent concerns

1. ⚠️ OTP accepts universal `000000` without an environment guard.
2. 🟡 `FeedDismissedDomain` lacks a partial unique constraint for active dismissals.
3. 🟡 Activity notification for friend-answer propagation targets previous answerers, not specifically authors.
4. 🟡 Authored question creation opens broad selected domains but does not run reconciliation/facet consolidation.
5. 🟡 Daily/catchup quip persistence lacks a direct `daily_answers.quip` schema mapping.

### Top 5 incomplete/short-circuited prompt sequence areas

1. Prompt 10.1 renamed/implemented propagation as `createFeedItemsForFriendsFromAnswer`, leaving expected API/file absent.
2. Prompt 10.4 interpretive-line logic was implemented client-side instead of server-side module.
3. Prompt 10.2 daily weighting was hardcoded rather than env-configurable.
4. Prompt 10.1 hidden domain GET route was split, not implemented on expected route.
5. Prompt 9.1 reconciliation was wired into Daily Five but not authored question creation.

### Top 5 production behavior risks vs PRD intent

1. Universal OTP could allow unauthorized access if production users know/guess the bypass.
2. Propagation chain volume may grow quickly because each answer can propagate onward to all friends who have not answered correctly.
3. Quip repetition likely because banks are small and random without per-user/session dedupe.
4. Domain dismissal toast may not be visible because matching cards are removed immediately.
5. Activity “friend answered your question” may miss authors who never answered their own authored question.

## Section 15 — Verdict

Rough PRD v11.1 conformance estimate: **72%**. The core social/feed model is substantially present: friend graph enforcement, feed items with source users/results, friend-answer propagation-equivalent logic, hidden domains, declared/demonstrated territory, cultural-anchor onboarding, and quips are all real code paths. However, several prompt-specified names/routes/modules are missing or divergent, schema constraints are softer than specified, and a few UX copy/surface requirements are incomplete.

Alpha-testing blockers right now: the largest functional blocker is **authentication safety**: universal OTP `000000` remains live. A second blocker is environmental: local/prod builds depending on Google font fetch can fail in restricted build environments. For PRD-valid social alpha, testers may also observe missing “declared territory” explanatory copy, hidden-domain toast oddities, and friend-answer activity notifications that do not always reach the question author.

Smallest fixes to reach alpha-testable v11.1 social validation with 3–5 real users: guard or remove universal OTP in production; alias or rename propagation to the expected `propagateFriendAnswerToFeeds` and ensure author notifications are written; add the missing Account “Manage interests” link; add env-configurable Daily Five weights; add the `GET /api/feed/dismiss-domain` alias or update PRD/client expectations; and add visible declared-territory copy on successful question creation.

What is working well: the friend graph enforcement is solid in the main routes; broadcast share rollback is largely complete; the feed redesign has real schema, query, UI, and propagation behavior; onboarding cultural anchor is well represented end-to-end; and quip rendering is implemented with tests. These areas should be stabilized, not rewritten wholesale.

## Section 16 — Recommended Next Actions

### Critical fixes (blocking alpha testing)

1. **Guard universal OTP** — small — production safety work. Require an explicit env flag for `000000` or remove it outside development/test.
2. **Normalize propagation API and author notification behavior** — medium — Prompt 10.1 follow-up. Add expected `propagateFriendAnswerToFeeds` wrapper/export and ensure question authors get `friend_answered_your_question` activity when applicable.
3. **Make build robust to font fetch failures** — small/medium — production hardening. Self-host Montserrat or configure a local fallback so `next build` does not depend on Google Fonts network access.

### Important fixes (degrade alpha experience but not blocking)

1. **Add Account “Manage interests” link** — small — PRD v11.1 surface follow-up.
2. **Add env-configurable Daily Five weights** — small — Prompt 10.2 follow-up. Support `DAILY_FIVE_DECLARED_WEIGHT` and `DAILY_FIVE_DEMONSTRATED_WEIGHT` with sane defaults.
3. **Add `GET /api/feed/dismiss-domain` or formally update route contract** — small — Prompt 10.1 follow-up.
4. **Add visible declared-territory success/helper copy** — small — Prompt 10.2 UX follow-up.
5. **Add partial unique active-dismissal constraint** — medium — schema migration follow-up.

### Nice-to-haves (post-alpha)

1. **Move interpretive-line logic into `src/server/daily/select-interpretive-line.ts`** — small/medium — Prompt 10.4 conformance cleanup.
2. **Deduplicate/rotate quips per user/session** — medium — commentary quality improvement.
3. **Fully remove dead `SpiderGraph` if killed concept should not exist anywhere** — small — PRD cleanup.
4. **Add deterministic facet-domain validator after LLM output** — medium — Prompt 9.1 robustness.
5. **Replace remaining TODO R2/v11.0 legacy stubs** — medium/large — technical debt cleanup.
