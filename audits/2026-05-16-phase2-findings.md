# Joshing Codebase Audit — Phase 2 Findings

_Date: 2026-05-16 · Scope: five deep-dives approved after Phase 1 triage._

**Out of scope, per standing instruction:** the hardcoded `000000` OTP shortcut in `src/server/auth/otp-store.ts`. All invitation findings below stand independent of that shortcut.

**Rubric.** P0 = data loss / privacy breach / security hole / invitation bypass / mastery scoring miscalculation or double-counting. P1 = significant correctness or broken core flow. P2 = second-order gap or polish. P3 = debt, cleanup, low-severity drift.

---

## Section 1 — Author-credit model resolution (F2.5)

### F1.1 — Author credit not written from Feed or Daily surfaces **[P1 · Gameplay]**

- **Location:** `src/app/api/feed/[feedItemId]/answer/route.ts` (no author-credit write); `src/app/api/daily/answer/route.ts` (no author-credit write); `src/app/api/daily/catchup/answer/route.ts` (no author-credit write). Contrast with `src/server/db/queries/joshing-game.ts:425–447` (the only write site).
- **What's wrong.** Every answer surface that could credit a question's author — Feed answers, Daily Five answers, Catch-up answers — does not write an `author_credit` mastery event. The PRD rule says "Author credit = 0.5× of the question's calibrated difficulty, awarded only on Moderate/Specialist questions, one credit per question per answering player ever." No surface restriction is stated. The code restricts it to Joshing Games only.
- **Why it matters.** A player whose questions are primarily answered from the Feed or Daily Five never accumulates author credit, so the Master-tier gate (≥20% author credit share) is unreachable from normal play patterns. Joshing Games are a minority surface relative to Feed and Daily Five.
- **Direction.** Factor out the author-credit write into a shared helper (analogous to the existing `writeMasteryEvent`) and call it from all three answer surfaces, behind the same difficulty gate once F1.2 is resolved.

### F1.2 — No difficulty gate on author-credit awards **[P1 · Gameplay]**

- **Location:** `src/server/db/queries/joshing-game.ts:425–447`. `src/server/mastery/scoring.ts:75–94` (the implementation). `src/server/mastery/constants.ts:36–41` (`AUTHOR_CREDIT_WEIGHT = 0.5`, defined but unused by active code).
- **What's wrong.** The PRD-locked rule says author credit is "awarded only on Moderate/Specialist questions." The call at `joshing-game.ts:427` passes no difficulty argument to `creatorMasteryAwardForNthCorrect`; the function itself (`scoring.ts:75–94`) accepts `correctCount` and `askedCount` but no `difficulty` parameter, so an Accessible question earns the same author credit as a Specialist one. The constant `AUTHOR_CREDIT_WEIGHT = 0.5` is the PRD-locked multiplier, defined in `constants.ts` with a comment acknowledging the pending F2.5 clarification, but no active code path uses it.
- **Why it matters.** Accessible questions earning author credit widens the author-credit pool in a way the PRD did not intend, reducing the relative rarity of Master tier for prolific authors of easy questions.
- **Direction.** Product decision: either adopt the PRD-locked rule (add a difficulty parameter to the function, skip Accessible, apply `AUTHOR_CREDIT_WEIGHT × difficulty base points`) or formally adopt the empirical-rate model and update the PRD. Until resolved, no fix. If PRD-locked: add `difficulty` to `creatorMasteryAwardForNthCorrect`, add `if (difficulty === 'accessible') return { basePoints: 0, weight: 0, awardedPoints: 0 }`, and reference `AUTHOR_CREDIT_WEIGHT`.

### F1.3 — Windowed model vs. per-answerer model — architecture divergence **[P1 · Gameplay · Spec Drift]**

- **Location:** `src/server/mastery/scoring.ts:45–94` (empirical-rate windowed scheme); `src/server/db/queries/joshing-game.ts:130–141` (`countAuthorCreditEvents`).
- **What's wrong.** The PRD says "one credit per question per answering player ever" — unlimited total credits, one per unique answerer. The code implements a windowed scheme: full credit for the first 2–5 answerers (globally), half credit for the next 2–5, zero after. The cap is `fullCreditWindow + reducedCreditWindow = 4–10`, depending on empirical difficulty. This is both more restrictive in total (a widely-answered question earns no further credits after ~10 answerers) and different in structure (per-question global window vs. per-answerer binary).
- **Why it matters.** The two models diverge in every measurement that matters for Master-tier attainability: max author-credit ceiling per question, credit rate per question as it becomes popular, and which questions the author benefits most from.
- **Direction.** Product decision required before any engineering fix. Present both models: PRD model (simple: 0.5× difficulty per unique answerer, DB constraint already enforces the one-per-answerer rule); windowed model (complex but rewards effort-to-create via difficulty-rate correlation). The `MASTERY_EVENTS` unique constraint on `(source_type, question_id, answered_by_user_id)` already enforces idempotency under both models — no change there.

### F1.4 — DB-level idempotency on author credit is correct **[no finding — confirmed clean]**

- `MASTERY_EVENTS` has a unique index `MASTERY_EVENTS_source_type_question_id_answered_by_user_id_key` on `(sourceType, questionId, answeredByUserId)` (`src/server/db/schema.ts:355–358`). This enforces "one author_credit event per (question, answering player)" at the DB level. No double-counting is possible regardless of which algorithmic model is in effect. Verified against `joshing-game.ts:426–431` (the ordinal check + write path).

---

## Section 2 — Re-login / Invitation gate completeness

### F2.1 — Middleware infrastructure built but middleware absent **[P1 · Resilience]**

- **Location:** `src/server/auth/session.ts:128–145` (`readSessionClaims` — "Used by middleware to gate authenticated routes"); `src/server/auth/session.ts:155–206` (`refreshSessionInvitationClaim` — upgrades legacy JWTs); `src/app/api/auth/refresh-session/` (the upgrade endpoint). Confirm: `src/middleware.ts` does not exist (verified by `find` — no file).
- **What's wrong.** The session system was explicitly refactored to support Edge-safe middleware: `readSessionClaims` reads the JWT without a DB lookup, the `inv: true` claim is baked into every new session, and a refresh endpoint exists for legacy sessions that lack the claim. But the middleware that actually gates authenticated routes using this infrastructure was never written. The `inv` flag in the JWT is currently metadata — no enforcement code reads it post-login.
- **Why it matters.** The invitation check exists only at session creation (`verify-otp`). Any regression in the OTP route, or any future route that mints a session without going through `verify-otp`, would silently grant full access with no secondary check.
- **Direction.** Write `src/middleware.ts` that calls `readSessionClaims(cookieStore.get('joshing_session'))`. If the token is missing or `invitationAccepted === false`, redirect to `/login` (pages) or return 401 (API). Exclude `/login`, `/invite/[token]`, `/api/auth/*`, and static assets. The session infra is ready — this is a one-file gap. For legacy sessions with `inv: undefined`, redirect to `/api/auth/refresh-session` instead of `/login` so users don't lose their session.

### F2.2 — Re-login grants `invitationAccepted: true` regardless of invitation history **[P1 · Resilience]**

- **Location:** `src/app/api/auth/verify-otp/route.ts:113–138` (the `existingUser` branch). The session is created with `{ invitationAccepted: true }` on line 126 for any user who already exists in the DB, without checking whether that user has a valid accepted invitation row.
- **What's wrong.** The code comment says this is intentional ("The invitation gate only applies to new-account creation below"), but the consequence is that any user created before the invitation fix (`F1.1/F1.2` from May 15) retains permanent re-login access. Additionally, users created in the race window (user row provisioned, `acceptFriendInvitation` failed before it could complete — see lines 158–170) arrive at the `existingUser` branch on their next login and receive a full session.
- **Why it matters.** Pre-fix accounts are permanently grandfathered. If the product's intent is a clean break (only users with a valid accepted invitation), these accounts represent a persistent bypass population. If the intent is "existing accounts are trusted, the gate only applies going forward," then this is working as designed — but that intent should be explicit.
- **Direction.** Product decision: (a) grandfather existing accounts (current behavior, explicit intent); (b) on re-login, check for at least one `friendInvitations` row where `inviteeUserId = userId` and `acceptedAt IS NOT NULL`. Option (b) requires a DB read on every re-login and an admin workflow to onboard grandfathered accounts cleanly.

### F2.3 — Onboarding page still has no invitation check **[P1 · Resilience]**

- **Location:** `src/app/onboarding/page.tsx:8–32`. The page renders for any user with `onboardingComplete = false`, checks only session existence and onboarding status, and makes no query against `friendInvitations`.
- **What's wrong.** Unchanged since the May 15 audit (F1.4). Onboarding is the last natural choke-point before full app access. A user who reaches this page via any session — including a pre-fix session or a re-login from F2.2 — will complete onboarding and be promoted to the full app with no invitation verification.
- **Direction.** Before rendering `OnboardingFlow`, query for at least one `friendInvitations` row with `inviteeUserId = session.userId` AND `acceptedAt IS NOT NULL`. Redirect to `/login` or a dedicated "you need an invitation" page if absent. This pairs with F2.1 as belt-and-suspenders.

### F2.4 — `createSession` type signature prevents accidental regression **[no finding — confirmed healthy]**

- `src/server/auth/session.ts:89–91` declares `options: { invitationAccepted: true }` with TypeScript literal type `true` (not `boolean`). Any caller that tries to pass `false` or omit the option produces a compile-time error. Both call sites in `verify-otp` (line 126 and line 172) explicitly supply `{ invitationAccepted: true }`. This is a sound anti-regression pattern.

---

## Section 3 — Ceremony state machine: spec vs. reality

### F3.1 — Ceremony model **[RESOLVED 2026-05-16 — code is correct, PRD was stale]**

- **Confirmed product decision:** The ceremony model is biweekly-personal. There is no per-game ceremony and there never will be. PRD sections describing a two-act per-game ceremony are out of date and should be treated as superseded by this decision. The code (`fire-ceremony.ts`, `biweekly-ceremony` cron, `BiweeklyCeremony` table) correctly implements the shipped model.
- **Action required on PRD:** Rewrite PRD §8.1.x ceremony sections to describe the biweekly personal cron model. Remove all references to Act 1 / Act 2 and the per-game trigger. No engineering action required.

### F3.2 — Mode is computed and stored; beat suppression in solo mode is implicit, not explicit **[P2 · Gameplay]**

- **Location:** `src/server/ceremony/compute-beats.ts:397–418` (`countActiveAnsweringPlayers`), `compute-beats.ts:434` (mode stored in payload). The UI reads `payload.mode` but no branch in `compute-beats.ts` suppresses Beat 3 or Beat 4 when `mode === 'solo'`.
- **What's wrong.** Beat 3 (Shaped — "who contributed to your learning") and Beat 4 (Alignment — "best-aligned friend") only make semantic sense when there are active friends. In practice, `computeBeat3` returns `null` if no contributors are found, and `computeBeat4` returns `null` if no friends exist. But a user with friends who answered in prior cycles (present in `getFriends`) but not the current cycle could receive a Beat 4 referencing a friend whose activity predates the ceremony window — because `computeBeat4` is not time-bounded to the cycle. It queries all-time player mastery, not cycle-scoped mastery.
- **Why it matters.** A solo ceremony could still surface Beat 4 with a friend's alignment based on lifetime mastery overlap, producing confusing copy ("your best alignment is with Alice" when Alice hasn't played in months). Also, ceremony copy is not yet mode-branched in the UI — the ceremony page renders the same copy regardless of `solo` vs `group`.
- **Direction.** (a) In `computeBeat4`, consider whether lifetime-overlap Beat 4 is correct for a solo ceremony. If the ceremony is meant to reflect activity-in-cycle, Beat 4 should be suppressed when the user had no social activity that cycle — which `mode === 'solo'` already signals. (b) The UI should branch copy on `payload.mode` for solo vs. duo/group ceremony register.

### F3.3 — `domainFor` fallback is `'General'`; under-categorized questions produce invalid Beat 2 entries **[P3 · UX · Spec Drift]**

- **Location:** `src/server/ceremony/compute-beats.ts:139`.
- **What's wrong.** When `canonicalSubcategory`, `broadCategory`, and `category` are all empty, `domainFor` returns the string `'General'`. A Beat 2 entry with `domain: 'General'` can reach the ceremony screen as "You discovered General." This was flagged as F5.6 in the prior audit and is unchanged.
- **Direction.** Replace the `'General'` fallback with `null` and exclude null-domain entries from Beat 2's `friendMediated` array. Pair with a write-path check (F4.5 from prior audit) that prevents under-categorized questions from being committed.

### F3.4 — `beatsPayloadSchema` validation at write time **[no finding — confirmed fixed]**

`src/server/ceremony/fire-ceremony.ts:62` calls `beatsPayloadSchema.parse(beatsPayload)` before insert. F3.5 from prior audit is resolved.

---

## Section 4 — Design-system conformance

### F4.1 — Caveat and Playfair Display are now loaded **[no finding — F5.1 / F5.2 confirmed fixed]**

- `src/app/layout.tsx:2, 13–27` imports and loads both fonts with correct variables: Caveat → `--font-handwriting`; Playfair Display italic → `--font-display`. `src/app/globals.css:99` sets `--font-literata: var(--font-display, Georgia)` so category labels get Playfair Display with Georgia fallback. Both findings from the prior audit are resolved.

### F4.2 — `--font-sans` and `--font-neutral` do not resolve to Montserrat **[P2 · UX]**

- **Location:** `src/app/layout.tsx:7–10` (Montserrat loaded with `variable: '--font-sans-body'`, applied via `montserrat.className` on `<body>`). `src/app/globals.css:51` (`--font-sans: ui-sans-serif, system-ui, -apple-system...`). `globals.css:94` (`--font-neutral: var(--font-sans)`).
- **What's wrong.** Components that use `font-[var(--font-neutral)]` (seen in knowledge page, ceremony) get the system font stack — not Montserrat — because `--font-sans` points to `ui-sans-serif`. Montserrat is only active via CSS inheritance from the `<body>` class. The `--font-sans-body` variable is set but never referenced anywhere. Body-inherited Montserrat and `var(--font-neutral)` produce different typefaces on components that explicitly set `--font-neutral`.
- **Why it matters.** Visual inconsistency: body text renders in Montserrat; any element that explicitly overrides to `--font-neutral` reverts to the system sans-serif. On macOS/iOS this is San Francisco — similar enough to be subtle, but not Montserrat.
- **Direction.** Either (a) change `--font-sans` in globals.css to `var(--font-sans-body)` so Tailwind's `font-sans` and `--font-neutral` resolve to Montserrat; or (b) replace `--font-neutral: var(--font-sans)` with `--font-neutral: var(--font-sans-body)` in globals.css. Option (a) is a one-line change with broad effect.

### F4.3 — INK / CREAM / HILITE brand tokens not encoded as CSS variables **[P2 · UX]**

- **Location:** `src/app/globals.css:50–104`. Multiple components: `src/app/knowledge/page.tsx` (uses `text-[#1a1208]`, `bg-[#f0e6c8]`, `bg-[#fdfbf6]`, `border-[#ddd6c7]` inline). `src/components/progression/TierProgressBar.tsx:42` (`border: '1px solid #d8d2c6'`).
- **What's wrong.** The brand palette values are used consistently but hardcoded as hex literals throughout components rather than through named CSS variables. `globals.css` has `--wrong: var(--destructive)` (correct) but no `--ink`, `--cream`, or `--hilite`. Changing the palette requires a grep-and-replace across dozens of files rather than a one-line variable update.
- **Direction.** Add to `:root` in globals.css:
  - `--ink: oklch(...)` (maps to `#1a1208` equivalent)
  - `--cream: oklch(...)` (maps to `#fdfbf6` / `#f5f0e8` — confirm which is the canonical cream)
  - `--hilite: oklch(...)` (the marker-style highlight, if used)
  - Re-alias `--background: var(--cream)`, `--foreground: var(--ink)`. Then do a sweep of components to replace inline hex values with these tokens. This is a medium-sized sweep but worth scoping.

### F4.4 — Circle sizing correctly implements PRD §8.4.8 **[no finding — confirmed correct]**

- `src/lib/knowledge/circle-sizing.ts` uses the exact desktop ranges from PRD §8.4.8: Establishing 18–28px, Familiar 32–48px, Solid 52–72px, Mastery 76–96px. Mobile ranges scale proportionally smaller (15–22px, 26–38px, 42–56px, 60–76px). Intra-tier variance scales linearly by `pointsInTier / maxPointsInTier`. Called correctly from `src/components/knowledge/ProgressionLandscape.tsx:60–63`. Section §16.13 concern (mobile collision) is addressed by the separate mobile range.

### F4.5 — "Grow your map" copy diverges from PRD §8.4.11 **[P3 · Spec Drift]**

- **Location:** `src/app/knowledge/page.tsx:503–513`.
- **What's wrong.** The rendered copy says: "When you send a friend a question and they answer it correctly, that domain joins your map. When a friend sends you a question and you answer it correctly, that domain joins your map too." The PRD §8.4.11 copy includes three expansion paths: (1) Feed correct answers, (2) direct sends, (3) authorship opening declared territory. The rendered copy describes only direct-send in both directions and omits Feed answers and authorship as an expansion path.
- **Direction.** Update copy to match PRD §8.4.11 (or the approved variant), making all three growth paths legible: friend-answered feed items, direct sends, and "writing a question opens that domain as declared territory." This is a copy-only change.

---

## Section 5 — Onboarding LLM cultural anchor

### F5.1 — Cultural anchor correctly implemented **[no finding — confirmed correct]**

- `src/app/api/onboarding/propose-interests/route.ts`: validates birth year (1920–currentYear-13), ISO 3166-1 country code against `VALID_ISO_CODES` set, region (max 100 chars). Saves to user record on acceptance. `src/server/llm/interests.ts:187–247`: `proposeInterests` builds the system prompt with `buildCulturalAnchorPrompt` (lines 249–265), which reproduces the exact PRD §7.3 cultural anchor instruction including geography-determines-culture framing and the PRD's own examples (suburban Michigan, London). Uses `ANTHROPIC_MODEL = 'claude-sonnet-4-6'` (current). Returns 10–14 hyper-specific candidates. Falls back gracefully when LLM is unavailable.

### F5.2 — Cultural anchor is optional at the route level; client enforcement is unverified **[P2 · Spec Drift]**

- **Location:** `src/app/api/onboarding/propose-interests/route.ts:86–105`. `parseCulturalAnchor` returns `null` (not `'invalid'`) when the body contains no `culturalAnchor` field. The route proceeds with `culturalAnchor = undefined`, which causes `buildCulturalAnchorPrompt` to return an empty string and the LLM to use only warm-up answers.
- **What's wrong.** PRD §7.3 presents cultural anchor (Step 2) as a required step: "Two fields, presented plainly: When were you born? / Where did you grow up?" There is no PRD-specified skip path for Step 2. The route silently allows it to be absent, which means a client bug or deliberate skip produces non-culturally-anchored suggestions with no server-side complaint.
- **Direction.** Either (a) make `culturalAnchor` required at the route level and return 400 if absent; or (b) confirm with product that Step 2 is intentionally skippable (e.g., for users born before 1920 or unwilling to share geography) and document the skip state explicitly. If (a): add `if (!culturalAnchor) return NextResponse.json({ error: 'cultural_anchor_required' }, { status: 400 })`.

### F5.3 — Fallback interests are only weakly specific **[P3 · UX]**

- **Location:** `src/server/llm/interests.ts:98–155` (`fallbackInterests`).
- **What's wrong.** If the Anthropic client is unavailable, fallback domains include "Modern Literary Fiction", "Auteur Film Favorites", "Personal Canon Music", "Recent Cultural Obsessions." These are more specific than bare "Literature" or "Music" but are not hyper-specific in the PRD sense (no era, no movement, no person/scene). A user who onboards during an outage gets a low-quality starting map.
- **Direction.** Low urgency — outage scenario only. If addressed, replace fallbacks with a small bank of genuinely hyper-specific examples across a spread of broad categories ("Late Coltrane", "Weimar-Era Cinema", "19th-Century British Novels", "1970s New Hollywood", "Cold War Space Race"). These would still be wrong for most users but are defensibly specific.

### F5.4 — `CANONICALIZE_MODEL = 'claude-haiku-4-5'` is an informal model alias **[P3 · Code]**

- **Location:** `src/server/llm/interests.ts:33`.
- **What's wrong.** The current canonical model ID for the Haiku family is `claude-haiku-4-5-20251001`. `'claude-haiku-4-5'` is an informal alias that the API resolves, but it may not be pinned to a specific version. The main `ANTHROPIC_MODEL` constant in `src/lib/llm.ts` correctly uses `'claude-sonnet-4-6'` — the canonicalize function is an outlier.
- **Direction.** Replace `'claude-haiku-4-5'` with the fully-qualified model ID `'claude-haiku-4-5-20251001'` in `interests.ts:33`, or move this constant to `src/lib/llm.ts` alongside `ANTHROPIC_MODEL` so it's maintained in one place.

---

## Cross-cutting summary

Two systemic patterns repeat across the five areas:

1. **Infrastructure built, enforcement missing.** The session system was cleanly refactored for middleware (Edge-safe `readSessionClaims`, `inv` claim in JWT, legacy upgrade endpoint) — but middleware.ts was never written. The author credit system has a DB-level idempotency constraint that correctly enforces one-per-answerer — but the difficulty gate and surface coverage were never completed. In both cases the load-bearing skeleton is present; the last enforcement step is the gap.

2. **Product decisions blocking engineering.** The author-credit model (F1.2/F1.3) and the ceremony architecture (F3.1) are both frozen on explicit product clarifications that haven't been made. No amount of code work unblocks these — the right artifact is a decision, not a PR.

**Sequencing recommendation for Phase 3 (implementation):** F2.1 (write middleware.ts — one file, session infra ready), then F2.3 (onboarding invitation check), then product decision on F1.2/F1.3 (author credit model) → F1.1 (surface coverage after model is settled), then F3.1 (ceremony decision), then design-system token sweep (F4.2/F4.3) as a parallel track.

---

_Phase 2 complete. No code was modified during this audit._
