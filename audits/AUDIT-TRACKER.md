# Audit Tracker

One living ledger for the two audits currently being worked down. Edit the **Status** column as you take items off the board.

**Last code-verification pass:** 2026-06-14 (re-verified against `origin/dev2`). Delta since 2026-06-13: **PLR-2 (root 404) → DONE** (fix `304215b8` merged via #922).
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

| ID | Item | Priority | Status | Disposition |
|---|---|---|---|---|
| CONS-7 | Shadow / elevation drift | — | `OPEN` (decided: B) | Two registers chosen → token-snap; fold into `B-VISUAL-TOKEN-BUDGET-01` |
| PLR-10 | "Establishing" label unclear | — | `NEEDS DECISION` | `FIX VIA CANON` — copy decision (may be deliberate) |

**Clean cheap-and-safe cluster (mostly already done):** PLR-5 ✅, PLR-6 ✅, PLR-7 ✅, PLR-9 ✅, PLR-13, PLR-21.

---

## Audit #2 — Product Design Pre-Launch Review (25 items)

Source: `audits/2026-06-13-product-design-prelaunch-review.md`. Priority = the audit's own launch-blocker ranking.

| ID | Item | Priority | Status | Disposition | Notes |
|---|---|---|---|---|---|
| PLR-1 | Dev tools visible to all users | P0 | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Not being tracked as actionable. (Code unchanged: unconditional in `AccountActions.tsx:102–135`.) |
| PLR-2 | Intermittent 404 on root during sign-in | P0 | `DONE` | `CLEAN WIN` | Fixed `304215b8` (#922): re-login now mints the real `onb` claim (`verify-otp/route.ts:50,213`), removing the `refresh-onboarding-claim` redirect hop that opened the 404 window. Regression test added. Diagnosed root cause; a live smoke confirms. |
| PLR-3 | "Show me the answer" duplication | P1 | `OPEN` | `CLEAN WIN` | Text reveal `GameplayChat.tsx:541`. The "double action" wasn't found in code — needs a live repro. Cost concern removed: reveal is non-destructive (see PLR-8), so simplifying it is low-risk. |
| PLR-4 | Auto-generated tagline misrepresents new users | P1 | `DONE` | `FIX VIA CANON` | Portrait must be *earned by play*, not auto-assigned. Canon-correct fix shipped: `buildMindStatement()` `users/[id]/page.tsx:78–91` derives from real mastery + neutral placeholder for new users. |
| PLR-5 | "Use this" artefact in rewrite suggestions | P1 | `DONE` | `CLEAN WIN` | `75eb625`; separate block spans `QuestionForm.tsx:280–291`. (Generation prompt is the biggest quality lever — good it's clean.) |
| PLR-6 | No success feedback after saving a question | — | `DONE` | `CLEAN WIN` | `419201a`; "✓ Saved" panel `QuestionForm.tsx:541–549` + host toast. |
| PLR-7 | Gear icon on Today's Five does nothing | P2 | `DONE` | `CLEAN WIN` | **Confirmed functional (2026-06-14):** the gear is a working `<Link href="/daily/setup">` with `aria-label="Set up daily round"` (`TodaysFiveCard.tsx:209–215`) — it opens the daily setup page, not a dead control. The reviewer's live "dead control" read doesn't hold against current code (older build / non-obvious destination). The `claude/fix-gear-icon-LZCOK` branch is unnecessary and can be closed. |
| PLR-8 | Catch-up reveal, no confirmation | P1 | `WON'T DO` | — | **Not a bug per owner (2026-06-14), code-confirmed.** Premise ("reveal consumes a missed question") is false: `skipCurrent()` `useCatchupFlow.ts:424–463` makes **no server call** — purely a client-session `outcome:'revealed'`. The slot stays `answered:false`/`dismissed_at:null`, so `isCatchUpSlotEligible` (`catch-up-eligibility.ts:28–37`) keeps it eligible; it resurfaces in catch-up until answered correctly, dismissed, or it ages out (7-day window). Nothing is burned. |
| PLR-9 | Privacy toggles lack context | P2 | `DONE` | `CLEAN WIN` | `419201a`; `SECTION_VISIBILITY_HELP` `users/[id]/page.tsx:546–565`. |
| PLR-10 | "Establishing" label unclear | — | `NEEDS DECISION` | `FIX VIA CANON` | Treat as a **copy decision** (copy before pixels); "Establishing" may be deliberate vocabulary. Rename ideas ("In review") are direction, not a quick relabel. No tooltip today `TodaysFiveCard.tsx:49,58`. |
| PLR-11 | Card-colour switcher confusing | — | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Not being tracked as actionable. (Code unchanged: dev `PaletteToggle` live for all `layout.tsx:7,72`.) |
| PLR-12 | Profile editing hidden behind preview | — | `PARTIAL` | — | Inline click-to-edit fields, no explicit "Edit profile" `users/[id]/page.tsx:492–539`. |
| PLR-13 | Explanation field is a small scrolling textarea | — | `OPEN` | `CLEAN WIN` | Low-stakes. `rows={4}`, no resize `QuestionForm.tsx:666`. |
| PLR-14 | Friend list lacks quick actions | P2 | `OPEN` | `FIX VIA CANON` | Richer friend actions are fine — but **no** streak count, leaderboards, "Challenge," or competition language. `FriendCard` is just a `<Link>` `FriendsList.tsx:108–122`. |
| PLR-15 | No onboarding/tour for Knowledge Map | P1 | `DONE` | `FIX VIA CANON` | Reworked the post-first-five recap (`FirstSessionRecap.tsx`): Beat 2 now points to the **Knowledge** tab; new Beat 3 points to the **Questions** tab (write-questions); new Beat 4 carries the daily rhythm + the reminder email opt-in. Removed the invite beat (per owner). Copy avoids the mastery-size misstatement. Also moved the reminder opt-in **off onboarding** (`OnboardingFlow.tsx` — `reminders` step deleted; finishes straight to /daily). Typecheck/lint/tests green. |
| PLR-16 | Overwhelming home feed | P1 | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Budgeted "edition" already caps arrival volume (`build-edition.ts`, `page.tsx:118–161`); not tracking further. (Collapsible grouping remains banned regardless — see traps.) |
| PLR-17 | Catch-up lacks closure/celebration | — | `PARTIAL` | `DO NOT DO` (confetti) | `RoundSummary` closing state exists `catchup/page.tsx:173–311`. A closure beat is OK in the quiet-warmth voice; **no** game-win celebration/confetti. |
| PLR-18 | Frequency options lack micro-copy | P2 | `DONE` | `CLEAN WIN` | Per-zone `copy` `TerritorySetupClient.tsx:43–55`. |
| PLR-19 | Invite flow generic (link/email/SMS unclear) | — | `PARTIAL` | — | Personal invite + copy link `InviteSomeoneNew.tsx:54–84`; no explicit SMS/email labelling. |
| PLR-20 | Avatars initials-only; no photo upload | — | `OPEN` | — | `AvatarChip` initials-only; no upload anywhere. |
| PLR-21 | Inconsistent link styling on summary page | — | `OPEN` | `CLEAN WIN` | Low-stakes. Underlined + button links coexist `summary/page.tsx:242,255,259,635,663`. |
| PLR-22 | No dark mode | P3 | `DEFERRED` | `DO NOT DO` (for launch) | Not canon-violating, but reworks the cream/serif/illustration brand — large effort. Park post-launch. |
| PLR-23 | Audio/haptic feedback on answers | P3 | `WON'T DO` | `DO NOT DO` | Wrong answer = discovery, not failure; an "incorrect" tone betrays the thesis. Skip. |
| PLR-24 | Categories skew Western | P3 | `WON'T DO` | — | **Ignored per owner (2026-06-14).** Not applicable: categories follow each person's declared interests — content is interest-matched by design, not a fixed seed corpus. No "skew" to correct. |
| PLR-25 | Missing first-run micro-copy (streaks/points/ritual) | P3 | `PARTIAL` | — | Intro exists `daily/page.tsx:807–855`; omits those concepts. (Note: "streaks/points" framing — keep it ritual/warmth, not pressure.) |

---

## Audit #1 — Design Consistency Audit (15 items)

Source: dispositioned in `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` (code-verified 2026-06-13). Template-style audit run against screenshots, not the live tree — only **CONS-7** is a live finding. A second offline pass (against PRDs/prototype/screenshots) corroborated this disposition on 14 of 15 items; it diverged only on CONS-7, which the live-code check had already flipped from "intentional flat" to a real low finding.

| ID | Item | Status | Notes |
|---|---|---|---|
| CONS-1 | Inconsistent button styling | `TRACKED ELSEWHERE` | Real sub-point owned by `B-VISUAL-TOKEN-BUDGET-01` |
| CONS-2 | Duplicate card patterns | `WON'T DO` | Canon — card tiers deferred; bespoke primitives intentional |
| CONS-3 | Inconsistent iconography | `WON'T DO` | Generic — no surface cited |
| CONS-4 | Duplicate modals & bottom sheets | `WON'T DO` | Canon — same as CONS-2 |
| CONS-5 | Multiple spacing systems | `TRACKED ELSEWHERE` | Folds into token-budget inventory |
| CONS-6 | Varying corner radii | `TRACKED ELSEWHERE` | Covered by token-budget |
| CONS-7 | Inconsistent elevation / shadows | `OPEN` (decided: B) | **Decision (2026-06-14): Option B — two intentional registers.** Live inventory: (A) flat letterpress `N N 0` on inline/printed artifacts — `ShareCard:134` (4px), `SharePortraitCard:245` (3px), `OverlapMap:34,298` (6/4px), `KnowledgeOverviewClient:310` (2px), `knowledge/page:641`, feed-card border accent `2px 2px 0 var(--brand-ink)`; (B) blurred elevation on floating surfaces — feed cards / `KnowledgeCard` / `RecentlyExploring`/`Expanding` / `ActivityStreamItem` (`0 4px 12px`), `GameplayChat:418` (`0 8px 20px`), `TerritorySetupClient` (`0 8px 22px`/`0 10px 30px`/`0 12px 28px`), `QuickAddQuestionModal:131` (`0 8px 32px`), `knowledge/page` (`0 8px 24px`/`0 18px 48px`), `PortraitCircles:309` (`0 1px 3px`), token `--shadow-paper-rest` (`0 1px 2px`). Feed cards intentionally combine both. **Plan:** define ~3 tokens — `--shadow-press` (flat), `--shadow-card` (`0 4px 12px`), `--shadow-overlay` (one heavy blur for modals/dialogs) — and snap the ~4 offsets + ~11 blur values to them. Folds into `B-VISUAL-TOKEN-BUDGET-01` (also reduces off-system rgba count). |
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
| _(none yet)_ | | | |
