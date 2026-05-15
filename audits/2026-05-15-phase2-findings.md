# Joshing Codebase Audit — Phase 2 Findings

_Date: 2026-05-15 · Scope: deep-dive on the five areas approved after Phase 1 triage._

**Out of scope, per product owner:** the hardcoded `000000` OTP shortcut in `src/server/auth/otp-store.ts:37–38`. All P0 invitation findings below stand **independent of** that shortcut — they would hold even with OTP fully secured.

**Rubric reminder.** P0 = data loss / privacy breach / game-breaking bug / invitation bypass. P1 = significant correctness or broken core flow. P2 = polish / second-order edge case. P3 = long-term debt.

---

## Section 1 — Invitation enforcement end-to-end

### F1.1 — Session creation does not require an invitation **[P0 · Resilience]**

- **Location:** `src/app/api/auth/verify-otp/route.ts:54–133` (the `POST` handler; particularly lines 61–62, 94, 96–102, 114).
- **What's wrong.** The handler accepts a POST with `phone` and `code` but treats `invitationToken` as optional. The literal logic at lines 61–62 and 96–102 is "if a token was *supplied*, validate it; otherwise skip." Then unconditionally calls `getOrCreateUserForLogin(...)` (line 94) and `createSession(user.id)` (line 114). A client that omits `invitationToken` from the JSON body — or sends `{ "invitationToken": "" }`, since `hasInvitationToken` keys off `!== undefined && !== null` — reaches a full session.
- **Why it matters.** Invitation-only is the product's permanent gate. The auth surface treats invitation as a *bonus*, not a *requirement*. Anyone able to receive an OTP at a valid phone number — i.e. anyone who acquires service to a US number — can sign in. There is no enforcement that a `friendInvitations` row references their phone.
- **Direction.** Make the invitation a precondition of session creation, not an optional side-effect. Concretely: before calling `createSession`, the handler must establish either (a) a successfully accepted invitation in this request, or (b) an existing `friendInvitations` row for the verified phone whose `acceptedAt` is set and `inviteeUserId` matches the user being signed in. New users without (a) or (b) should 403 before the session is written. The product team should also decide whether to allow re-login of already-onboarded users with no token in the body (the answer is almost certainly yes, but the path needs to be explicit, not accidental).

### F1.2 — `getOrCreateUserForLogin` silently provisions Users on first OTP success **[P0 · Resilience]**

- **Location:** `src/app/api/auth/verify-otp/route.ts:25–52`.
- **What's wrong.** The function performs an unconditional `INSERT … ON CONFLICT DO NOTHING` on `users` for the verified phone. There is no read of `friendInvitations` and no check that the phone has been invited. The function is named "for login" but materially performs signup.
- **Why it matters.** This is the actual mechanism by which an uninvited phone becomes a persistent account. Even if F1.1 is later fixed at the route level, this helper will keep creating User rows unless invitation status is checked here too — and the function is a tempting place to call from new routes.
- **Direction.** Either (i) split into `findUser(phone)` and `provisionUser(phone, invitation)` so that user creation is impossible without an invitation context; or (ii) gate the `INSERT` on an acceptance/eligibility query and throw a typed error the route handler can convert to 403. Option (i) is cleaner.

### F1.3 — No app-wide invitation middleware; authenticated surfaces only check `getSession()` **[P1 · Resilience]**

- **Location.** `src/middleware.ts` does not exist (`Glob` returned nothing); 72 files call `getSession()` / `requireUser()` / `getCurrentUser()` per-route (`src/app/page.tsx`, `src/app/onboarding/page.tsx`, every API route, every authenticated page).
- **What's wrong.** The session is the only gate. Once F1.1/F1.2 produce a session, every authenticated surface is reachable. There is no second factor that asks "does this user have an accepted invitation?"
- **Why it matters.** Defense in depth. Even after F1.1/F1.2 are patched, a regression in a future auth code-path would silently re-open the gate, because no downstream surface re-checks invitation membership.
- **Direction.** Add `src/middleware.ts` (Next.js App Router middleware) that runs ahead of authenticated pages and API routes. It should call a single helper that resolves session → user → invitation acceptance, and 302 to `/login` (or 403 for API) when missing. Keep the route-level `getSession()` calls — middleware is an additional fence, not a replacement for handler-level checks.

### F1.4 — Onboarding does not verify invitation acceptance **[P1 · Resilience]**

- **Location:** `src/app/onboarding/page.tsx:8–32`.
- **What's wrong.** The page guards on session and `onboardingComplete`. It calls `getPreSeededInterestsForUser(session.userId)` — which presumably reads from any matched invitation — but never checks that an invitation actually exists. A user who reached `/onboarding` via F1.1's path will complete onboarding and be promoted to the rest of the app.
- **Why it matters.** Onboarding is the last natural choke-point before full app access. It is the place where you would expect to verify "yes, this user is here because someone invited them." It does not.
- **Direction.** Before rendering `OnboardingFlow`, require `friendInvitations` to have at least one row with `inviteeUserId = session.userId` and `acceptedAt IS NOT NULL`. If not, redirect to a "you need an invitation" page or to `/login`. This pairs with F1.1: if F1.1 is fixed, F1.4 becomes a belt-and-suspenders check.

### F1.5 — Invite landing page renders "valid" before confirming the viewer is the recipient **[P2 · UX/Resilience]**

- **Location:** `src/app/invite/[token]/page.tsx` (entry path) + `src/server/friends/invitations.ts:94–152` (`getFriendInvitationLandingByToken`); phone-match enforcement is at `src/server/friends/invitations.ts:398–405`.
- **What's wrong.** The landing fetches `acceptedAt`, `cancelledAt`, `expiresAt`, and `preSeededInterests`, then decides `valid | expired | accepted | invalid` purely on token state. It never compares the verified phone to `invitation.inviteePhone`. The phone-match gate exists, but only inside `acceptFriendInvitation`, which fires later in the OTP flow. The wrong recipient sees a "Welcome — Alice invited you" landing first, then a generic failure after OTP.
- **Why it matters.** Soft information leak: a leaked or shared invite link reveals the inviter's display name and pre-seeded interests to anyone with the URL, before the recipient identity is established. Also confusing UX — the messaging arc is "everything looks fine → suddenly broken" rather than "this link isn't for you."
- **Direction.** Two paths, not exclusive: (a) keep the landing as marketing but defer pre-seeded interests until after phone verification; (b) require a phone collection on the landing and short-circuit to "this link isn't for you" before any OTP is sent. Option (a) is the minimal change.

### F1.6 — Phone-match failure logs but uses a generic error message **[P3 · Resilience/UX]**

- **Location:** `src/server/friends/invitations.ts:398–405`.
- **What's wrong.** On phone mismatch the code logs `friend_invite_phone_mismatch_rejected` (good) but returns the generic `INVITATION_ACCEPTANCE_ERROR_MESSAGE`. From the caller's perspective, "wrong recipient" looks identical to "expired" / "missing" / "cancelled". That's fine for security messaging but makes incident triage harder.
- **Direction.** Keep the user-facing message generic; surface the structured `reason` to telemetry/server logs (already partially done) and to internal admin tooling. No user-facing change.

### Invitation subsection summary

Five gaps, all reachable. F1.1 and F1.2 are the load-bearing P0s — fix one and you've closed the bypass; fix both for defense in depth. F1.3 and F1.4 are the safety net. F1.5 is the only UX-facing one. The system has *some* discipline (token uniqueness, 14-day TTL, phone-match check inside `acceptFriendInvitation`, transactional claim with idempotency) but the actual chokepoint is missing.

---

## Section 2 — Mastery scoring correctness

### F2.1 — Daily answer route writes `first_correct` unconditionally; never detects recovery or repeat **[P1 · Gameplay]**

- **Location:** `src/app/api/daily/answer/route.ts:182–194`; canonical helper at `src/server/answer-state.ts:13–31`.
- **What's wrong.** Line 186 hardcodes `answerState: isCorrect ? 'first_correct' : 'incorrect'`. There is no read of prior answers. The route also passes `eventQuestionId: null` (line 191), so this mastery event won't be discoverable as "this user got this question right" by the cross-surface helper `userAnsweredQuestionCorrectly` (which filters on `masteryEvents.questionId`, not the dedup `answer_id`).
- **Why it matters.** Within Daily alone the bug is mostly latent — generated questions are user-scoped and slot-scoped, so the same `generated_questions.id` does not re-appear. The real harm is *cross-surface*: once `persistGeneratedQuestion` (called at line 208) promotes the question into the canonical `questions` table, the same question can later land in feed or a joshing-game. The mastery event from Daily has `question_id = NULL`, so feed's `userAnsweredQuestionCorrectly` returns false, and full credit is awarded a second time. Live double-credit on hard questions.
- **Direction.** Two changes: (a) when writing the daily mastery event, set `eventQuestionId` to the canonical persisted Question ID (or the generated-question id consistently across surfaces); (b) call `computeAnswerState` against `masteryEvents` for the user and question before writing, so `first_correct_after_wrong` is detectable. The dedup answer_id already protects against the same daily slot writing twice; this fixes the *different surface, same question* case.

### F2.2 — Daily catch-up route has the same hardcoded answer state **[P1 · Gameplay]**

- **Location:** `src/app/api/daily/catchup/answer/route.ts:100–112`.
- **What's wrong.** Line 104 hardcodes `answerState: isCorrect ? 'first_correct' : 'incorrect'`; `eventQuestionId: null` at line 109. Same shape as F2.1.
- **Why it matters.** Catch-up correct already attracts only 25% credit (`weight: 0.25`), so the cross-surface harm is smaller in magnitude than F2.1 — but it still violates the "repeat correct = zero" rule when the same question reappears across surfaces. Also: if a user got the question wrong in Daily, recovered it in Catch-up, then later sees it in Feed, both Catch-up *and* Feed will award `first_correct` weight rather than `first_correct_after_wrong` and then `repeat_correct`.
- **Direction.** Same as F2.1 — populate `eventQuestionId` and run `computeAnswerState` against history. Confirm `weight: 0.25` is what catchup *should* do for `first_correct_after_wrong` too; the rule says recovery is 0.25× of the difficulty regardless of surface, so the catchup-recovery case may need explicit policy.

### F2.3 — Feed route detects `repeat_correct` but never `first_correct_after_wrong` **[P1 · Gameplay]**

- **Location:** `src/app/api/feed/[feedItemId]/answer/route.ts:75, 84`.
- **What's wrong.** Line 84: `answerState = isCorrect ? (alreadyCorrect ? 'repeat_correct' : 'first_correct') : 'incorrect'`. There is no check for "previously *wrong* on this question". The taxonomy in `src/types/db.ts:3–7` enumerates `first_correct_after_wrong`, but the feed route can never produce it.
- **Why it matters.** The 0.25× recovery multiplier (live correct after prior wrong) never fires for feed-answered questions — users get the full `first_correct` base points instead. This is the most-trafficked answer surface, so the over-award compounds.
- **Direction.** Replace the inline ternary with `computeAnswerState(result, priorAnswers)` from `src/server/answer-state.ts:13–31` and pass `priorAnswers` derived from a `masteryEvents` lookup (or, when migrated, the `answers` table). `joshing-game.ts:379` is the working reference pattern.

### F2.4 — Only `joshing-game` uses the canonical `computeAnswerState` helper **[P2 · Code]**

- **Location:** `src/server/db/queries/joshing-game.ts:5, 379` (the only consumers). `computeAnswerState` and `liveMasteryCreditFromAnswerState` are exported from `src/server/answer-state.ts` but not imported by `daily/answer`, `daily/catchup/answer`, `feed/answer`, `daily/recheck`, or `feed/.../recheck`.
- **What's wrong.** Five answer-writing routes, four different ad-hoc state derivations. The canonical helper exists.
- **Why it matters.** Behavioural drift across surfaces. The lens is "internal consistency" — the rule should be implemented in one place and reused.
- **Direction.** Have all answer routes call `computeAnswerState` and pass the result through `writeMasteryEvent`. The "prior answers" query can be a single shared helper (`readPriorAnswers(userId, questionId)`).

### F2.5 — Author-credit scoring diverges from the stated rule; no difficulty gate **[P1 · Gameplay]**

- **Location:** `src/server/db/queries/joshing-game.ts:425–456`; helper `creatorMasteryAwardForNthCorrect` at `src/server/mastery/awards.ts:80–99`; window config at `awards.ts:63–78`.
- **What's wrong.** The PRD-locked rule is "Author credit = 0.5× the calibrated difficulty of the question, awarded only on Moderate/Specialist questions, one credit per question per answering player ever." The code implements a *different* model: empirical-correct-rate base points (25 / 50 / 100), a credit-window weighting (full credit for the first 2–5 correct, half credit for the next 2–5, zero after), and **no difficulty filter at all** — Accessible questions earn author credit on the same terms.
- **Why it matters.** This is a substantive rule divergence, not a bug. Author credit is the lever that gates the Master tier (requires ≥20% of domain points from `author_credit` and ≥2 distinct authored questions — see `src/server/mastery/tiers.ts:29–45`). Getting the inputs to that gate wrong will systematically tilt who can reach Master.
- **Direction.** Product clarification required. Either (a) the code is the spec and the PRD-locked rule should be amended; or (b) the PRD-locked rule is the spec and `creatorMasteryAwardForNthCorrect` needs to be replaced with a difficulty-keyed `0.5 × getBasePoints(difficulty, 'first_correct')` capped at one per (question, answering player), with `if (difficulty === 'accessible') return zero`. Don't ship either way until this is resolved.

### F2.6 — `awards.ts` is `@deprecated` but still exports load-bearing helpers used by live routes **[P3 · Code]**

- **Location:** `src/server/mastery/awards.ts:1–8` (deprecation banner); `getBasePoints` imported by `feed/answer/route.ts:9` and `joshing-game.ts`; `creatorMasteryAwardForNthCorrect` imported by `joshing-game.ts`.
- **What's wrong.** The file's top comment says "should NOT be imported by active code." It is imported by active code. The deprecated path also contains the only `console.info('[mastery] mastery blocked …')` log (line 272) — but the real gate is in `tiers.ts:effectiveTier`, which is correctly enforced via `write-mastery-event.ts:86`. The Phase 1 triage misread this: the live `effectiveTier` does enforce the share/distinct-questions gate; only the deprecated path is log-only.
- **Direction.** Move `getBasePoints`, `creatorEarningsFromEmpiricalRate`, `creatorMasteryAwardForNthCorrect` out of the deprecated file into a non-deprecated module (e.g. `src/server/mastery/scoring.ts`). Then delete the rest of `awards.ts`, or keep it explicitly as test fixtures. The deprecation banner should not be a lie.

### F2.7 — Scoring multipliers and tier thresholds are scattered magic numbers **[P3 · Code]**

- **Location.** Tier thresholds: `src/server/mastery/tiers.ts:4–9` (correctly centralized). Catchup `0.25`: `src/app/api/daily/catchup/answer/route.ts:73, 111`. Author-credit windows / 0.5 weight: `src/server/mastery/awards.ts:80–99`. Daily explicit `weight: 1`: `src/app/api/daily/answer/route.ts:193`.
- **What's wrong.** Tier thresholds are good. Everything else is hand-keyed at the call site.
- **Direction.** A `src/server/mastery/constants.ts` module exporting `CATCHUP_WEIGHT`, `AUTHOR_CREDIT_WEIGHT`, the difficulty point tables, and the share-gate constants (`0.2`, `2`). Reference them everywhere.

### F2.8 — Privacy of numeric mastery deltas — clean **[no finding]**

I traced every response shape that exposes `masteryDelta` (`daily/answer:244`, `daily/catchup/answer:170`, `feed/[id]/answer:189`, `ceremony/[id]:19`). In every case the recipient is the authenticated session user; no path returns another player's numeric delta. The feed list endpoint deliberately omits deltas. Beat 3 (Authorship Impact) and Beat 5 (Gave) expose author-credit *counts* (not numeric mastery deltas), which is consistent with the rule ("authorship counts may be shared"). No P0 leak. The one privacy issue is in Section 3 (Beat 4).

---

## Section 3 — Ceremony state machine: spec vs. reality

### F3.1 — There is no per-game ceremony; only a biweekly personal cron **[P1 · Gameplay]**

- **Location.** Fire path: `src/server/ceremony/fire-ceremony.ts:17–66`. Beat computation: `src/server/ceremony/compute-beats.ts:297–316`. Schedule: `src/app/api/cron/biweekly-ceremony/route.ts`. Schema: `src/server/db/schema.ts:755–771` (`BiweeklyCeremony` table).
- **What's wrong.** The locked rule is "Two-act ceremony tied to game completion: Act 1 on personal completion (Portrait, Personal Record); Act 2 when all active players finish (Group Knowledge Map, Authorship Impact, Relational Feedback summary, Climax, Invitation)." The implementation is a 14-day cron that produces one payload per user with five beats (Mastered / Discovered / Shaped / Alignment / Gave). There is no game-session reference in the ceremony row, no "all players finished" detection, no Act 1 vs Act 2 boundary in the data model, and no `CeremonyProgress` / `act1_viewed_at` / `act2_viewed_at` columns anywhere in the live schema (grep returned nothing in `src/`). The Prisma file still has a `CeremonyProgress` table — dead.
- **Why it matters.** Most of the locked rule isn't there. Until product clarifies, no further work in this area is well-defined.
- **Direction.** This needs a product decision before engineering action: (a) the biweekly-personal model is the new spec and the PRD section should be rewritten; or (b) the two-act per-game ceremony is the spec and an entire feature surface needs to be built (new `gameCeremonies` table keyed on `gameId`, an "all players completed" trigger, Act 1/2 fire functions, mode branching, UI). Phase 2 engineering effort is wasted until this is resolved.

### F3.2 — `ceremonyModeFromAnsweringCount` is exported but never called **[P2 · Code/Gameplay]**

- **Location:** `src/lib/ceremony/mode.ts:3–7`. Grep across `src/` returns only the definition site.
- **What's wrong.** The mode helper exists but no code path computes a mode, persists it, or branches on it. `BeatsPayload` (`compute-beats.ts:30–42`) has no `mode` field. Solo / duo / group is indistinguishable in the stored payload.
- **Why it matters.** Even within the current biweekly-personal model, the locked rule says solo mode should still be coherent. Without persisted mode, you can't tell whether a beat array reflects a solo player or a group play pattern, which makes solo-specific UX impossible.
- **Direction.** Pick a definition of "active answering players" (probably "friends who answered ≥ N in the cycle") and persist `mode` on `BiweeklyCeremony`. Branch Beat 3 (Shaped) and Beat 4 (Alignment) on mode — solo should suppress those beats or substitute different copy. Resolve in tandem with F3.1.

### F3.3 — No unique constraint on `(userId, cycleStart, cycleEnd)`; duplicate ceremonies possible **[P1 · Resilience]**

- **Location:** `src/server/db/schema.ts:755–771`. Unique indexes are only on `shareCardToken`. Idempotency for the cron lives in the cron handler's recent-window query, not in the table.
- **What's wrong.** If `fireCeremony(userId)` is called twice in the same cycle — concurrent cron tick, manual replay, retry after an SMS-send failure that succeeded server-side — two rows are inserted. The user sees two ceremonies for the same fortnight; the cron-recency check (`gte(firedAt, recentCutoff)`) doesn't fire because both inserts are competing within the window.
- **Why it matters.** Duplicate beats = duplicate SMS, duplicate activity items (`writeActivity` fires once per call), and a confused user. Cheap to prevent at the DB level.
- **Direction.** Add `uniqueIndex('BiweeklyCeremony_user_cycle_key').on(table.userId, table.cycleStart, table.cycleEnd)`. Catch the unique-violation in `fireCeremony` and treat it as success (returning the existing ceremony's id). Backfill: deduplicate existing rows by `(userId, cycleStart, cycleEnd)` before adding the constraint, keeping the earliest `firedAt`.

### F3.4 — Beat 4 (Alignment) ignores `ProfileDomainVisibility` — friend's "private" domains can leak **[P1 · Resilience/UX]**

- **Location:** `src/server/ceremony/compute-beats.ts:236–265`. Compare with `src/server/mastery/ceremony.ts:210–253` (the visibility-aware consolidation used elsewhere).
- **What's wrong.** Beat 4 queries `playerMastery` directly (`compute-beats.ts:247–249`) and selects all rows with `totalPoints > 0`. It then intersects friend-domains with viewer-domains (`compute-beats.ts:256`) without checking `profileDomainVisibility`. A friend who has set a domain to private will still surface that domain in the viewer's Beat 4 if both have points in it.
- **Why it matters.** The rule allows authorship *counts* to be shared but treats numeric mastery (and, by extension, domain *presence*) as private. Beat 4 quietly exposes domain presence — which is a privacy signal even without numeric deltas. The viewer learns "Alice has mastery in Late Tchaikovsky" even if Alice hid that domain from her own portrait.
- **Direction.** Filter the inner-join (`compute-beats.ts:247–249`) by `profileDomainVisibility.isVisible = true` (or use the consolidated helper in `mastery/ceremony.ts`). Re-test the visibility tests in `src/server/mastery/__tests__/ceremony-visibility.test.ts` cover this path; if not, add a case.

### F3.5 — Beat ordering is client-side only; payload corruption is silent **[P3 · Resilience]**

- **Location:** `src/app/ceremony/[ceremonyId]/page.tsx:97–105, 242, 271–276`. Stored as a single JSONB blob in `beatsPayload`.
- **What's wrong.** The UI walks `payload.beat1 … beat5`, filtering nulls. If a beat is malformed (e.g. an unexpected type), the page either crashes the section or skips it. The server doesn't validate the payload shape on read, and there's no Zod / runtime guard.
- **Why it matters.** A bug in `compute-beats.ts` produces silently empty ceremonies rather than loud failures.
- **Direction.** Define a Zod schema for `BeatsPayload` and validate at both write time (`fire-ceremony.ts:23` before insert) and read time (`ceremony/[id]` route). On read failure, render an explicit error state rather than a partial.

### F3.6 — `runDomainMergesForUser` runs before beats compute; ordering and idempotency unclear **[P3 · Resilience]**

- **Location:** `src/server/ceremony/fire-ceremony.ts:22–23`.
- **What's wrong.** `runDomainMergesForUser` mutates `playerMastery` (and writes `mastery_events` with `source_type='domain_merged'`). It is called *before* `computeBeats`. If the same user fires twice in a window (see F3.3), merges run twice. Re-merging mostly is idempotent (a merge target already at the canonical name is a no-op) but the merge-events are not guaranteed unique.
- **Direction.** Same prevention as F3.3 — once duplicate firings are blocked at the DB level, this concern is mostly mooted. As a secondary measure, gate `runDomainMergesForUser` on a hash of `(userId, cycleEnd)` to skip if it's already executed for this cycle.

---

## Section 4 — Data-layer hygiene

### F4.1 — Prisma is in `package.json` and ships a schema, but is fully dead at runtime **[P2 · Code]**

- **Location:** `package.json` (`@prisma/client`, `prisma` devDep); `prisma/schema.prisma` (full file, ~124 tables). No `@prisma/client` import anywhere in `src/`.
- **What's wrong.** Two declared ORMs, one used. The Prisma schema has drifted: it lacks `slug`, `adaptiveLevel`, `birthYear`, `grewUpCountry`, several new tables (`CritiqueUsageDaily`, `JoshingGameResponse`, `Friendship`, `FriendRequest`).
- **Why it matters.** Confuses contributors ("which is the schema?"), wastes install time, leaves stale documentation about an ORM that no longer exists. Drift means anyone who *does* run `prisma generate` will silently get the wrong types.
- **Direction.** Remove `@prisma/client` and `prisma` from `package.json`. Delete `prisma/schema.prisma` and `prisma/migrations` if present (move to git history). Update any docs in `_docs/` that reference Prisma. Confirm no scripts in `scripts/` invoke Prisma before deletion.

### F4.2 — `src/types/db.ts` `DifficultyEstimate` enum is wrong **[P2 · Code]**

- **Location:** `src/types/db.ts:9–13` — exports `'easy' | 'medium' | 'hard' | 'very_hard'`. The Drizzle schema enum (`src/server/db/schema.ts`, the `difficultyEstimate` enum, also used inline in queries) is `'accessible' | 'moderate' | 'specialist'`.
- **What's wrong.** Type lies to TypeScript. Anything that imports `DifficultyEstimate` from `@/types/db` is type-checked against the wrong domain. The mastery scoring tables (`awards.ts:42–44`) and the adaptive-difficulty thresholds (`src/server/adaptive-difficulty.ts`) all key on `accessible | moderate | specialist`, so the type is unused by the live scoring path — which is *also* a smell, because client-side surfaces that *do* import this type get false reassurance.
- **Direction.** Replace the union with `InferSelectModel`-style derivation from the Drizzle enum, or re-export the enum's `.enumValues`. Track down all consumers (grep `from '@/types/db'`) and confirm they expect the canonical three values. Remove the legacy four-value union.

### F4.3 — Legacy directories cluttering the repo **[P3 · Code]**

- **Location:** `_salvaged/`, `_docs/`, `.drizzle-tmp/`, plus loose top-level files (`{`, `dev-out.txt`, `dev-stderr.txt`, `.codex-next-*.log`).
- **What's wrong.** Visible from `ls`; nothing imports from these directories; they hold historical PRDs and abandoned implementations.
- **Direction.** Move to a `archive/` git tag and delete from `main`; add the loose files to `.gitignore`. None of this affects runtime; it's contributor noise.

### F4.4 — `awards.ts` deprecation doesn't match reality (cross-ref F2.6) **[P3 · Code]**

- Already covered in F2.6. Listed here for the data-layer/hygiene index.

### F4.5 — Schema doesn't enforce category labels avoid "Other" — relies on a runtime mapping **[P2 · Code]**

- **Location:** `src/lib/question-categorization.ts:19` maps `'other'` → `'general_knowledge'`; `src/lib/llm.ts:52–72` defines `GENERIC_SUBCATEGORY_NORMALIZED` (`other`, `general knowledge`, `general`, `trivia`, `potpourri`) and re-prompts the LLM for a specific label.
- **What's wrong.** The PRD principle is "Other is never used as a category anywhere in the UI" and "hyper-specific labels preserved". The current defense is *runtime* — the LLM is asked again. There is no DB constraint or zod schema preventing `'other'` or `'general_knowledge'` from landing in `questions.canonical_subcategory`. If the LLM ever returns one of those after retry (or a future code path bypasses the LLM helper), the label lands.
- **Direction.** Add a write-time check inside `persistGeneratedQuestion` and the question-creation route that rejects (or re-prompts) any canonical_subcategory in the generic set. Optionally a Postgres `CHECK` constraint; more practical is a zod-validated boundary on the write path.

---

## Section 5 — Design-system conformance

### F5.1 — Caveat (handwriting) is not loaded anywhere **[P2 · UX]**

- **Location.** Grep across `src/` for `Caveat` returns zero hits. `src/app/layout.tsx:2,7–9` loads only `Montserrat`.
- **What's wrong.** The locked typography spec calls for Caveat for handwriting-register copy (Personal Record, annotations, signatures-style microcopy). It's absent. Any surface intending the "handwriting" register currently falls back to Montserrat.
- **Direction.** Add `Caveat` to the `next/font/google` import in `src/app/layout.tsx`, expose it as a CSS variable (e.g. `--font-handwriting`), and reference it in components that need the register (Personal Record summary, ceremony Portrait beat, share-card overlays).

### F5.2 — Playfair Display italic is not loaded; Georgia is the only serif **[P2 · UX]**

- **Location.** Grep for `Playfair` returns zero hits. `src/app/globals.css:96` defines `--font-literata: Georgia, "Times New Roman", serif;` — system serif fallback. The locked spec wants Playfair Display italic for category names.
- **What's wrong.** Categories render in Georgia italic instead of Playfair Display italic. Different letterforms; the editorial register is muted.
- **Direction.** Load Playfair Display via `next/font/google` (italic subset) and re-point `--font-literata` (or introduce a `--font-display`) to use it with a Georgia fallback. Update `CategoryCircles` / `PortraitCircles` to reference the new variable.

### F5.3 — Brand palette tokens missing — INK / CREAM / WRONG / HILITE are not encoded **[P2 · UX]**

- **Location.** `src/app/globals.css:50–101`. The palette is the default shadcn neutral OKLch ladder. `--wrong: var(--destructive)` (line 93) is the only brand-named alias; there is no `--ink`, `--cream`, `--hilite`. `--success: #178245` is hand-keyed (line 91).
- **What's wrong.** The design language is verbal but not encoded. Components reference `--primary` / `--destructive` / `--muted` and inherit the neutral shadcn aesthetic, not the ink-on-cream editorial register the product wants.
- **Direction.** Introduce a Joshing-named layer on top of the shadcn tokens:
  - `--ink: oklch(...)` (the warm near-black used for body/foreground)
  - `--cream: oklch(...)` (the off-white background)
  - `--wrong: var(--destructive)` (keep; already aliased)
  - `--hilite: oklch(...)` (the marker-style highlight color)
  - Re-point `--background`/`--foreground`/`--primary` to the new brand names where the design system intends "ink" / "cream", not neutral.
- Then a sweep of `src/components/ui/` to refactor to the brand-named tokens. The CSS-variable layer means most components don't need touching.

### F5.4 — Body font is Montserrat, spec calls for Inter **[P2 · UX]**

- **Location:** `src/app/layout.tsx:2, 7–9, 23`.
- **What's wrong.** Spec is Inter; loaded font is Montserrat. Two different humanist sans-serifs — close enough that the swap may have been intentional, but should be confirmed with product.
- **Direction.** Either (a) load Inter and swap the className, or (b) update the locked spec to say Montserrat. One-line change either way; flag for product decision.

### F5.5 — Loading / empty / error states inconsistently scaffolded **[P2 · UX/Resilience]**

- **Location.** Feed (`src/components/feed/FeedList.tsx`) has a Suspense `FeedListLoading`; daily catch-up has an `error` state via `recheckState`. `src/app/activities/page.tsx`, `src/app/knowledge/page.tsx`, and `src/app/replay/` lack explicit error boundaries.
- **What's wrong.** No global `error.tsx` / `not-found.tsx` at the App Router root, no top-level `loading.tsx`. The site's empty states are inconsistent: some pages assume data; some hand-roll a skeleton.
- **Direction.** Add `src/app/error.tsx`, `src/app/loading.tsx`, `src/app/not-found.tsx` at the App Router root. Audit each top-level route segment for an explicit empty-state component. Adopt one standard skeleton primitive in `src/components/ui/` rather than per-component skeletons.

### F5.6 — Generic-category fallbacks in copy, not just in the DB **[P3 · UX]**

- **Location:** `src/server/ceremony/compute-beats.ts:58` returns `'General'` when canonical_subcategory / broad_category / category are all empty. `src/types/db.ts:30` — `Category = string`. The `compute-beats` fallback can end up in Beat 2's `friendMediated`/`authored`/`promoted` arrays, then on a user's ceremony screen.
- **What's wrong.** "General" is the user-visible cousin of "Other". A user who answers an under-categorized question can have a Beat reading "you discovered General".
- **Direction.** Drop the `'General'` fallback in `domainFor`; if the question has no canonical subcategory, exclude it from the beat instead of inventing a label. Pair with F4.5 to make the write path the only place that handles the generic case.

---

## Cross-cutting summary

Two themes connect the findings:

1. **The product's load-bearing rules live in one place but get re-implemented in another.** The mastery taxonomy lives in `answer-state.ts`, but four of five answer routes reinvent it. The ceremony rule lives in the PRD, but the code implements an entirely different model. The design language lives in the product owner's brief, but the CSS tokens are unmodified shadcn defaults. Fix-once-use-everywhere is the recurring move.
2. **The invitation gate is real in code (`acceptFriendInvitation` is well-built), but the gate isn't in the right *position* in the flow.** It's an optional side-effect of OTP verification rather than a precondition. The fix isn't to rewrite the invitation primitives — they're fine — it's to make every other authenticated path require invitation acceptance as a hard precondition.

Sequencing recommendation if Phase 3 is implementation: F1.1+F1.2 first (close the gate), then F2.1–F2.3+F2.5 (mastery correctness), then product clarification on F3.1, then F4.2 (type lie), then design-system work as a separate sweep.

---

_Phase 2 complete. No code was modified during this audit._
