# Audit Tracker

One living ledger for the two audits currently being worked down. Edit the **Status** column as you take items off the board.

**Last code-verification pass:** 2026-06-14 (re-verified against `origin/dev2`). Delta since 2026-06-13: **PLR-2 (root 404) → DONE** (fix `304215b8` merged via #922). Also triaged a third audit (2026-06-14 product launch-readiness eval) — ~90% a re-run of Audit #2; its launch-blockers map to existing PLR items or are invalid against current code (logout, friend "Answer →", double-reveal, "Use this" all checked out clean). Four genuinely new valid findings filed as `MISC-1`…`MISC-4` below.
**Canon disposition pass (audit #2):** 2026-06-13 — every Pre-Launch item sorted against product canon (see Disposition column + guardrails).

## How to use this file

- **Take an item down:** change its **Status** and, if useful, drop a note + commit SHA in the **Notes** column.
- **Re-run the code check:** ask me in this session — "re-verify the audit tracker" (or just the items you touched). Read-only pass; never changes app code.
- **Add a new item:** add a row with the next free ID (`PLR-26`, `CONS-16`), or a `MISC-n` row in *Other / ad-hoc*. Or tell me "add X" and I'll slot it in.

### Status legend (what the code shows)

| Status | Meaning |
|---|---|
| `DONE` | Verified fixed in code. |
| `PARTIAL` | Substantially addressed; a residual gap remains. |
| `OPEN` | Not addressed yet. |
| `NEEDS DECISION` | Real, but a product/design/copy call is required before work. |
| `DEFERRED` | Valid but parked (post-launch). |
| `TRACKED ELSEWHERE` | Genuine signal, owned by another workstream. |
| `WON'T DO` | Dismissed — contradicts canon, invented, or generic boilerplate. |

### Disposition legend (whether / how to act — canon lens)

| Disposition | Meaning |
|---|---|
| `CLEAN WIN` | Canon-aligned; fix as written. |
| `FIX VIA CANON` | Real signal, but the reviewer's recommendation must be rerouted through canon — see note. |
| `PRODUCT CONVERSATION` | Strategic question, not a quick fix; discuss before acting. |
| `DO NOT DO` | Contradicts a load-bearing product decision. |

> **Provenance note:** Audit #2 (Pre-Launch Review) was written against the **live app** (`joshing-11.vercel.app`) and names real surfaces — most of it is real signal, unlike audit #1. Where its static-code Status and live-app observation disagree (e.g. PLR-7), trust the live observation enough to re-verify. The numeric scores (Vision 9, Craftsmanship 6, …) are a generic rubric — **ignore the numbers, keep the specific observations.**

---

## 🚫 Canon traps — do NOT act on these (even though the audit recommends them)

| From | Trap | Why it's banned |
|---|---|---|
| #14 + "Opportunities" | Leaderboards, streak-as-pressure, "Challenge Blake," competition-register words ("beat," "called," "challenge") | Anti-competition is foundational. Friend actions can be richer **without** any of this. |
| #23 | Audio/haptic chime on correct **and a tone on "incorrect"** | A wrong answer is a connection/discovery event, not a failure — a sad tone betrays the thesis. |
| #16 | Collapsible grouping of the home feed | Clustering was tried on Group 3, rejected (fragment-copy), and `B-FEED-GROUP3-FIX-01` enforces a straight chronological stream. Real fix = sequencing/staggering CTAs, not grouping. |
| #17 | Confetti / game-win celebration on catch-up close | A closure state is fine, but in the quiet-warmth ("knows it down cold") voice — not a celebration-of-correctness register. |

---

## ⭐ Start here — open & important

**Both audits fully cleared.** Every Pre-Launch item is `DONE`, `WON'T DO`, or `DEFERRED`; the Consistency audit is closed. Nothing open.

- **Deferred:** PLR-22 (dark mode, post-launch).
- **Still tracked separately:** the `MISC-1…4` findings from the third-audit triage (see *Other / ad-hoc*).

---

## Audit #2 — Product Design Pre-Launch Review (25 items)

Source: `audits/2026-06-13-product-design-prelaunch-review.md`. Priority = the audit's own launch-blocker ranking.

| ID | Item | Priority | Status | Disposition | Notes |
|---|---|---|---|---|---|
| PLR-1 | Dev tools visible to all users | P0 | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Not being tracked as actionable. (Code unchanged: unconditional in `AccountActions.tsx:102–135`.) |
| PLR-2 | Intermittent 404 on root during sign-in | P0 | `DONE` | `CLEAN WIN` | Fixed `304215b8` (#922): re-login now mints the real `onb` claim (`verify-otp/route.ts:50,213`), removing the `refresh-onboarding-claim` redirect hop that opened the 404 window. Regression test added. Diagnosed root cause; a live smoke confirms. |
| PLR-3 | "Show me the answer" duplication | P1 | `WON'T DO` | — | **Owner: not a real finding (2026-06-15).** The "double action" was never present in code — `GameplayChat.tsx:541` is a single text reveal. Confirmed untrue; no change. |
| PLR-4 | Auto-generated tagline misrepresents new users | P1 | `DONE` | `FIX VIA CANON` | Portrait must be *earned by play*, not auto-assigned. Canon-correct fix shipped: `buildMindStatement()` `users/[id]/page.tsx:78–91` derives from real mastery + neutral placeholder for new users. |
| PLR-5 | "Use this" artefact in rewrite suggestions | P1 | `DONE` | `CLEAN WIN` | `75eb625`; separate block spans `QuestionForm.tsx:280–291`. (Generation prompt is the biggest quality lever — good it's clean.) |
| PLR-6 | No success feedback after saving a question | — | `DONE` | `CLEAN WIN` | `419201a`; "✓ Saved" panel `QuestionForm.tsx:541–549` + host toast. |
| PLR-7 | Gear icon on Today's Five does nothing | P2 | `DONE` | `CLEAN WIN` | **Confirmed functional (2026-06-14):** the gear is a working `<Link href="/daily/setup">` with `aria-label="Set up daily round"` (`TodaysFiveCard.tsx:209–215`) — it opens the daily setup page, not a dead control. The reviewer's live "dead control" read doesn't hold against current code (older build / non-obvious destination). The `claude/fix-gear-icon-LZCOK` branch is unnecessary and can be closed. |
| PLR-8 | Catch-up reveal, no confirmation | P1 | `WON'T DO` | — | **Not a bug per owner (2026-06-14), code-confirmed.** Premise ("reveal consumes a missed question") is false: `skipCurrent()` `useCatchupFlow.ts:424–463` makes **no server call** — purely a client-session `outcome:'revealed'`. The slot stays `answered:false`/`dismissed_at:null`, so `isCatchUpSlotEligible` (`catch-up-eligibility.ts:28–37`) keeps it eligible; it resurfaces in catch-up until answered correctly, dismissed, or it ages out (7-day window). Nothing is burned. |
| PLR-9 | Privacy toggles lack context | P2 | `DONE` | `CLEAN WIN` | `419201a`; `SECTION_VISIBILITY_HELP` `users/[id]/page.tsx:546–565`. |
| PLR-10 | "Establishing" label unclear | — | `WON'T DO` | — | **Owner: deliberate (2026-06-14).** "Establishing" is intentional vocabulary (the tier name) — no rename, no tooltip. |
| PLR-11 | Card-colour switcher confusing | — | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Not being tracked as actionable. (Code unchanged: dev `PaletteToggle` live for all `layout.tsx:7,72`.) |
| PLR-12 | Profile editing hidden behind preview | — | `DONE` | `CLEAN WIN` | Shipped #957: added a visible pencil cue to the inline name + handle fields (`InlineEditableField`/`InlineHandleField`) so they read as editable — lighter than a separate Edit-profile button + modal. |
| PLR-13 | Explanation field is a small scrolling textarea | — | `DONE` | `CLEAN WIN` | Shipped #934: explanation `<textarea>` is now `resize-y` with a taller default (`rows={5}`, `min-h-[7.5rem]`) — `QuestionForm.tsx:666`. |
| PLR-14 | Friend list lacks quick actions | P2 | `DONE` | `FIX VIA CANON` | Shipped #945. Each friend row now carries two warm activity facts (not action buttons, per owner): **Questions created** (their authored count) and **You've answered** (of those, how many the viewer answered across all surfaces — feed/mastery/game union). Single bulk aggregate in `getFriendsHub` (no N+1); rendered as a label/count ledger, never a ranking (anti-leaderboard). |
| PLR-15 | No onboarding/tour for Knowledge Map | P1 | `DONE` | `FIX VIA CANON` | Reworked the post-first-five recap (`FirstSessionRecap.tsx`): Beat 2 now points to the **Knowledge** tab; new Beat 3 points to the **Questions** tab (write-questions); new Beat 4 carries the daily rhythm + the reminder email opt-in. Removed the invite beat (per owner). Copy avoids the mastery-size misstatement. Also moved the reminder opt-in **off onboarding** (`OnboardingFlow.tsx` — `reminders` step deleted; finishes straight to /daily). Typecheck/lint/tests green. |
| PLR-16 | Overwhelming home feed | P1 | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Budgeted "edition" already caps arrival volume (`build-edition.ts`, `page.tsx:118–161`); not tracking further. (Collapsible grouping remains banned regardless — see traps.) |
| PLR-17 | Catch-up lacks closure/celebration | — | `DONE` | `DO NOT DO` (confetti) | Shipped #961. The closer (`RoundCloseCard` + `RoundSummary`) already existed for the answer path; the gap was the **dismiss** path — dismissing the last missed question dead-ended the thread (no closer/input). `dismissCurrent` now closes the round (mirroring `dropStaleItem`); Undo restores it. Reuses the existing quiet "You're all caught up" card — no confetti (canon). |
| PLR-18 | Frequency options lack micro-copy | P2 | `DONE` | `CLEAN WIN` | Per-zone `copy` `TerritorySetupClient.tsx:43–55`. |
| PLR-19 | Invite flow generic (link/email/SMS unclear) | — | `DONE` | — | Shipped #962: invite card now names the two methods — "Text a personal invite" (SMS to a phone) vs "Copy invite link" (share anywhere). No email path exists, so none is implied. |
| PLR-20 | Avatars initials-only; no photo upload | — | `WON'T DO` | — | **Ignored per owner (2026-06-15).** Not doing photo uploads. |
| PLR-21 | Inconsistent link styling on summary page | — | `DONE` | `CLEAN WIN` | **Resolved (2026-06-14).** Code is already consistent: every text link uses `underline underline-offset-4` (`summary/page.tsx:242,259,635,663`); `btn-primary`/`btn-ghost` are buttons (correctly not underlined). No color-only link exists. No change needed. |
| PLR-22 | No dark mode | P3 | `DEFERRED` | `DO NOT DO` (for launch) | Not canon-violating, but reworks the cream/serif/illustration brand — large effort. Park post-launch. |
| PLR-23 | Audio/haptic feedback on answers | P3 | `WON'T DO` | `DO NOT DO` | Wrong answer = discovery, not failure; an "incorrect" tone betrays the thesis. Skip. |
| PLR-24 | Categories skew Western | P3 | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Not applicable: categories follow each person's declared interests — content is interest-matched by design, not a fixed seed corpus. No "skew" to correct. |
| PLR-25 | Missing first-run micro-copy (streaks/points/ritual) | P3 | `DONE` | — | **Closed (2026-06-15):** covered by the first-session ceremony (`FirstSessionRecap.tsx`). It conveys the ritual completed (Beat 1), the daily rhythm "five new questions, every day" + commitment via reminder opt-in (Beat 4), and what play builds (Beats 2–3) — earned after the first play rather than front-loaded. The streaks/points part of the audit is canon-excluded (anti-competition). |

---

## Audit #1 — Design Consistency Audit (15 items)

Source: dispositioned in `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` (code-verified 2026-06-13). Template-style audit run against screenshots, not the live tree — only **CONS-7** is a live finding. A second offline pass (against PRDs/prototype/screenshots) corroborated this disposition on 14 of 15 items; it diverged only on CONS-7, which the live-code check had already flipped from "intentional flat" to a real low finding.

| ID | Item | Status | Notes |
|---|---|---|---|
| CONS-1 | Inconsistent button styling | `DONE` | **Closed (2026-06-14).** The "blue vs green" complaint was a canon misread (navy reserved for CTAs). The real sub-point — hardcoded literals vs tokens on buttons — was owned by `B-VISUAL-TOKEN-BUDGET-01`, whose bucket-B inventory (`B-VISUAL-TOKEN-BUDGET-01-bucket-B.md`) is now **stale**: a `--warning`/`--warning-surface`/`--warning-border` family was invented (`globals.css:230–232`) and applied, and the flagged button/control surfaces (`QuestionForm`, `AddToBankAction`, `CeremonyPin`, `InlineHandleField`, `InlineEditableField`, `PreviewBanner`, `NotificationsForm`, `AuthoredQuestionsFeed`, `ReplaySummary`) are all token-clean. Last residual button literal — `QuestionRatingButtons:94` thumbs-down pressed state `border-stone-400 bg-stone-200` → `--warm-ink-400`/`--warm-border` — fixed this pass. Color ratchet 145 (under 180). Remaining repo-wide `stone-*` literals are on the ceremony-share dark page and `FirstSessionRecap`, never classified as bucket-B button rows. **Follow-up (2026-06-15):** the `knowledge/page.tsx` buttons (and the surrounding sections/modals/toasts on that known drift surface) were still on `bg-white`; all 20 snapped to `bg-[var(--brand-card)]` — off-system-color lint warnings down to 10/44 (no visual change; #fff→#fdfcfb). |
| CONS-2 | Duplicate card patterns | `WON'T DO` | Canon — card tiers deferred; bespoke primitives intentional |
| CONS-3 | Inconsistent iconography | `WON'T DO` | Generic — no surface cited |
| CONS-4 | Duplicate modals & bottom sheets | `WON'T DO` | Canon — same as CONS-2 |
| CONS-5 | Multiple spacing systems | `DONE` | **Standardized + fully burned down (2026-06-15).** Added the `check:spacing` ratchet (`scripts/check-spacing-ratchet.mjs` + CI, with a `--list` review mode and `env(...)` safe-area exemption; sizing `h-/w-` out of scope). Burn-down 1 snapped 21 exact scale-equivalents (zero pixels moved). Burn-down 2 (owner: "a 3–4px shift is fine") rounded the remaining 34 off-scale values to nearest scale steps (gap-[18px]→gap-5, px-[46px]→px-12, the rems → nearest; ≤2px shift) across 13 files. **Ceiling 59 → 0** — all box-model spacing now uses the scale; none can be added. |
| CONS-6 | Varying corner radii | `TRACKED ELSEWHERE` | **Standardized + frozen (2026-06-15):** added the `check:radius` ratchet (`scripts/check-radius-ratchet.mjs` + CI workflow), ceiling **25** literal arbitraries (`rounded-[var(--radius-*)]` consumers excluded — on-system). No new literal `rounded-[Npx]` can land. **Burn-down 1 (2026-06-15):** added a `--radius-xs` token (0.25rem = 4px, in `@theme` + `:root`) and snapped the nine `rounded-[4px]` → `rounded-[var(--radius-xs)]` (button/card corner; zero visual change). Ceiling **25 → 16**. The remaining 16 (`rounded-[8px]`, `rounded-[2rem]`, `rounded-[1.5rem]`, `rounded-[12px]`, `rounded-[1.75rem]`) are design calls — round to the scale or promote a recurring value to a token. |
| CONS-7 | Inconsistent elevation / shadows | `DONE` (Option B) | **Implemented (2026-06-14).** Added registers to `globals.css`: `--shadow-card` (`0 4px 12px` .04), `--shadow-card-strong` (.10), `--shadow-overlay` (`0 12px 28px rgba(26,18,8,.16)`). Snapped the **card** family (8 identical usages, zero visual change) — `FeedCardShell`, `DismissedFeedBar`, `TodaysFiveCard`, `KnowledgeCard`, `RecentlyExploringSection`, `RecentlyExpanding`, `ActivityStreamItem` — and the warm-brown **overlay** cluster in `TerritorySetupClient` (3 usages → one token; 789 was exact, 857/974 unify slightly heavier). Color ratchet 147 (↓, under 180 ceiling); typecheck/lint/tests green. **Deferred (own surfaces, not collapsed):** differently-hued overlays — `GameplayChat` navy `0 8px 20px`, `knowledge/page` black `0 8px 24px`/`0 18px 48px`, `QuickAddQuestionModal` `0 8px 32px` — and the flat **press** register (`#3a3a3a` share buttons, canvas/OG `ShareCard`/`SharePortraitCard`/`OverlapMap` which can't read CSS vars). Those are color/palette calls for `B-VISUAL-TOKEN-BUDGET-01`. |
| CONS-8 | Non-standard typography hierarchy | `WON'T DO` | Generic — font tokens defined |
| CONS-9 | Mixed illustration styles | `WON'T DO` | Generic — no screens cited |
| CONS-10 | Inconsistent form controls | `WON'T DO` | Generic — no surface cited |
| CONS-11 | Multiple progress-indicator styles | `WON'T DO` | Generic — progress already unified |
| CONS-12 | Duplicate tag/chip/badge components | `WON'T DO` | Generic — no instances cited |
| CONS-13 | Uneven navigation patterns | `WON'T DO` | Invented — one consistent bottom nav |
| CONS-14 | Different animation language | `WON'T DO` | Generic — no interactions cited |
| CONS-15 | Knowledge-visualisation inconsistency | `WON'T DO` | Canon — category colours are identity signals; underlying collision already fixed |

---

## Other / ad-hoc items

Add anything that isn't from the two audits here.

| ID | Item | Status | Notes |
|---|---|---|---|
| MISC-1 | Knowledge-map nodes inert in normal view | `WON'T DO` | **Ignored per owner (2026-06-15).** The interactive "mind garden" is a large opportunity, not being pursued. (Was: nodes only respond in `editMode` — `PortraitCircles.tsx:200–201`.) |
| MISC-2 | "Explore your overlap" Venn is non-interactive | `WON'T DO` | **Ignored per owner (2026-06-15).** The overlap diagram stays a pure render (`OverlapMap.tsx`); interactivity not pursued. |
| MISC-3 | OTP screen lacks resend button + expiry timer | `DEFERRED` | **Deferred per owner (2026-06-15) until SMS sending is enabled** — a resend affordance is moot while OTP delivery isn't wired to actually send. Revisit when SMS is on. (`LoginPanel.tsx:677–750`; expiry `otp-store.ts:16`.) |
| MISC-4 | No auto-scroll to feedback after a daily answer | `PARTIAL` | Feedback sheet is a fixed-position modal so it *is* visible, but there's no `scrollIntoView` (`daily/page.tsx`, `GameplayChat.tsx`). Audit's "card scrolls out of view" is plausible on some viewports — verify with a live repro before acting. Low effort. From 2026-06-14 audit. |
| MISC-5 | Thumbs-down redundant with the "criticize" report flow | `DONE` | **Shipped (2026-06-14).** The thumbs-down on `/games/[id]/summary` and `/archive` overlapped the structured report (`ReportReasonSheet`, B-Report/PRD-D-6) but those two pages had no report affordance. Brought the shared ⋯ → report control (`AnsweredRowActions`, now `surface`-parameterized: `round_recap` on summary, `answered_list` on archive) onto both pages, then removed the thumbs-**down** button (kept thumbs-**up**, which drives `surfacePriorityScore`). Negative feedback is now one structured mechanism everywhere. Typecheck/lint/tests green; color ratchet 145. **Follow-up (not done):** `rating='down'` now has no writer, so the propagation-rolloff branch (`ratings.ts:80–114`) and the `ratingDown` probe (`create-feed-items-for-answer.ts:55–65`) are dead-but-harmless — leave for a later server cleanup. |

### Post-Pro performance review (2026-06-21)

From the data-backed perf pass after the Vercel Hobby→Pro upgrade (see [[vercel-pro-upgrade]] / `_docs/PERF-FINDINGS-01.md`). DB is healthy and not the current bottleneck (tiny scale); the real levers are cold starts + the synchronous LLM daily-build. Items numbered to match the review's priority list.

| ID | Item | Status | Notes |
|---|---|---|---|
| PERF-1 | Pre-build daily queues via reliable native crons + daily-build timeout guard | `DONE` | Review #1 — the biggest user-facing win. **Both PRs merged (2026-06-21):** **#1140** (retire `external-crons.yml`; schedule all crons natively — fixes the un-prebuilt-queue → slow synchronous build that caused the "only 3 questions / took forever" report) + **#1139** (never start an LLM round that can't finish before the function ceiling → no 504 / short Daily Five). Pro's honored `maxDuration` is the root cure. |
| PERF-2 | Pin Fluid Compute (`"fluid": true`) to cut cold starts | `TRACKED ELSEWHERE` | Review #2. PR **#1142**. ~8 distinct functions booted cold in one low-traffic session; Fluid keeps instances warm. Also verify Fluid is on at the account/project level (dashboard). |
| PERF-3 | Verify `SKIP_BOOT_DB_GUARDS=1` in the production Vercel env (B-PERF-02) | `DONE` | **Verified by owner (2026-06-22):** `SKIP_BOOT_DB_GUARDS=1` is confirmed set in the production Vercel env, keeping the ~70-statement boot-guard chain off cold starts (preview/dev leave it unset so the guards keep auto-repairing). Matches the CLAUDE.md production posture. |
| PERF-4 | Set up a Vercel Log Drain for durable `[perf]`/`[latency]` capture | `OPEN` | Review #4 — owner/dashboard. Unblocks the `PERF-FINDINGS-01` §0 p50/p95 table: the logs MCP truncates messages, so server-timing percentiles aren't readable without a drain. Pro feature. |
| PERF-5 | Covering indexes for cold-path unindexed FKs (advisor lint 0001) | `TRACKED ELSEWHERE` | Review #5. PR **#1142** (migration 0083). Pre-scale hygiene — no impact at today's tiny row counts, indexed pre-emptively. |
| PERF-6 | Route Anthropic calls via Vercel AI Gateway (auto prompt-caching, failover, cost/latency observability) | `DEFERRED` | Review #6 — bigger optional lever; scope before doing. |
