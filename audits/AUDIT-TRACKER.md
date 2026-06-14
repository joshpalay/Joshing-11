# Audit Tracker

One living ledger for the two audits currently being worked down. Edit the **Status** column as you take items off the board.

**Last code-verification pass:** 2026-06-13 (against branch `claude/audit-items-tracking-kp59my`).
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
| #3 | "Simplify reveal to one tap" / make revealing faster | Reveal in catch-up **consumes** a question; grading must fail toward the player. Resolve via PLR-8 (add confirmation), don't make reveal more accidental. |
| #17 | Confetti / game-win celebration on catch-up close | A closure state is fine, but in the quiet-warmth ("knows it down cold") voice — not a celebration-of-correctness register. |

---

## ⭐ Start here — open & important

| ID | Item | Priority | Status | Disposition |
|---|---|---|---|---|
| PLR-1 | Dev tools visible to all users | P0 | `OPEN` | `CLEAN WIN` — gate behind `ADMIN_USER_IDS` (same allowlist as content reporting) |
| PLR-2 | Intermittent 404 on root during sign-in | P0 | `OPEN` | `CLEAN WIN` — trace root-route redirect race in `src/proxy.ts` |
| PLR-8 | Catch-up reveal consumes a question, no confirmation | P1 | `OPEN` | `FIX VIA CANON` — the important half of #3/#8; aligns with fail-toward-player |
| PLR-11 | "Card Color" PaletteToggle dev tool still shipped to all | — | `OPEN` | — (ship gate; pull before launch, like PLR-1) |
| PLR-15 | No onboarding/tour for the Knowledge Map | P1 | `OPEN` | `FIX VIA CANON` — tie to B-FirstRecap-1 / B-HomeSeed-1; explanation must match the mastery model |
| PLR-16 | Overwhelming home feed | P1 | `PARTIAL` | `FIX VIA CANON` — stagger CTAs; **do not** reintroduce grouping |
| PLR-24 | Categories skew Western | P3 | `NEEDS DECISION` | `PRODUCT CONVERSATION` — audit seed bank + interest taxonomy, not a content drive |
| CONS-7 | Shadow / elevation drift | — | `NEEDS DECISION` | Option A (uniform flat) vs B (two registers) |

**Clean cheap-and-safe cluster (mostly already done):** PLR-5 ✅, PLR-6 ✅, PLR-7 (re-verify), PLR-9 ✅, PLR-13, PLR-21.

---

## Audit #2 — Product Design Pre-Launch Review (25 items)

Source: `audits/2026-06-13-product-design-prelaunch-review.md`. Priority = the audit's own launch-blocker ranking.

| ID | Item | Priority | Status | Disposition | Notes |
|---|---|---|---|---|---|
| PLR-1 | Dev tools visible to all users | P0 | `OPEN` | `CLEAN WIN` | Unconditional in `AccountActions.tsx:102–135`. Gate behind `ADMIN_USER_IDS` allowlist (reuse the content-reporting gate). |
| PLR-2 | Intermittent 404 on root during sign-in | P0 | `OPEN` | `CLEAN WIN` | Real instability. Likely a root-route redirect race; auth routes via `src/proxy.ts`. Trace before launch. |
| PLR-3 | "Show me the answer" duplication | P1 | `OPEN` | `FIX VIA CANON` | Text reveal `GameplayChat.tsx:541`. **Resolve only in light of PLR-8** — do NOT make reveal faster/more accidental. |
| PLR-4 | Auto-generated tagline misrepresents new users | P1 | `DONE` | `FIX VIA CANON` | Portrait must be *earned by play*, not auto-assigned. Canon-correct fix shipped: `buildMindStatement()` `users/[id]/page.tsx:78–91` derives from real mastery + neutral placeholder for new users. |
| PLR-5 | "Use this" artefact in rewrite suggestions | P1 | `DONE` | `CLEAN WIN` | `75eb625`; separate block spans `QuestionForm.tsx:280–291`. (Generation prompt is the biggest quality lever — good it's clean.) |
| PLR-6 | No success feedback after saving a question | — | `DONE` | `CLEAN WIN` | `419201a`; "✓ Saved" panel `QuestionForm.tsx:541–549` + host toast. |
| PLR-7 | Gear icon on Today's Five does nothing | P2 | `OPEN` (verify) | `CLEAN WIN` | **Discrepancy:** code shows a working `<Link href="/daily/setup">` `TodaysFiveCard.tsx:209–215`, but the live-app reviewer read it as a dead control. Re-verify on live: is the destination non-obvious, or a different build? Remove/clarify accordingly. |
| PLR-8 | Catch-up reveal, no confirmation | P1 | `OPEN` | `FIX VIA CANON` | The more important of #3/#8. `onGiveUp={() => skipCurrent()}` `catchup/page.tsx:138`. Add a confirm before a reveal burns a question (fail-toward-player). |
| PLR-9 | Privacy toggles lack context | P2 | `DONE` | `CLEAN WIN` | `419201a`; `SECTION_VISIBILITY_HELP` `users/[id]/page.tsx:546–565`. |
| PLR-10 | "Establishing" label unclear | — | `NEEDS DECISION` | `FIX VIA CANON` | Treat as a **copy decision** (copy before pixels); "Establishing" may be deliberate vocabulary. Rename ideas ("In review") are direction, not a quick relabel. No tooltip today `TodaysFiveCard.tsx:49,58`. |
| PLR-11 | Card-colour switcher confusing | — | `OPEN` | — | Dev `PaletteToggle` live for all `layout.tsx:7,72` ("remove before shipping"). Ship gate alongside PLR-1. |
| PLR-12 | Profile editing hidden behind preview | — | `PARTIAL` | — | Inline click-to-edit fields, no explicit "Edit profile" `users/[id]/page.tsx:492–539`. |
| PLR-13 | Explanation field is a small scrolling textarea | — | `OPEN` | `CLEAN WIN` | Low-stakes. `rows={4}`, no resize `QuestionForm.tsx:666`. |
| PLR-14 | Friend list lacks quick actions | P2 | `OPEN` | `FIX VIA CANON` | Richer friend actions are fine — but **no** streak count, leaderboards, "Challenge," or competition language. `FriendCard` is just a `<Link>` `FriendsList.tsx:108–122`. |
| PLR-15 | No onboarding/tour for Knowledge Map | P1 | `OPEN` | `FIX VIA CANON` | Real gap; B-FirstRecap-1 / B-HomeSeed-1 exist. **Tooltip must not misstate mastery** (author 0.5× / catch-up 0.25× / live full) — "bigger = more answered" is wrong. |
| PLR-16 | Overwhelming home feed | P1 | `PARTIAL` | `FIX VIA CANON` | Budgeted "edition" caps volume (`build-edition.ts`, `page.tsx:118–161`). Real signal = too many CTAs at arrival → **stagger/sequence**, NOT collapsible grouping (banned, see traps). |
| PLR-17 | Catch-up lacks closure/celebration | — | `PARTIAL` | `DO NOT DO` (confetti) | `RoundSummary` closing state exists `catchup/page.tsx:173–311`. A closure beat is OK in the quiet-warmth voice; **no** game-win celebration/confetti. |
| PLR-18 | Frequency options lack micro-copy | P2 | `DONE` | `CLEAN WIN` | Per-zone `copy` `TerritorySetupClient.tsx:43–55`. |
| PLR-19 | Invite flow generic (link/email/SMS unclear) | — | `PARTIAL` | — | Personal invite + copy link `InviteSomeoneNew.tsx:54–84`; no explicit SMS/email labelling. |
| PLR-20 | Avatars initials-only; no photo upload | — | `OPEN` | — | `AvatarChip` initials-only; no upload anywhere. |
| PLR-21 | Inconsistent link styling on summary page | — | `OPEN` | `CLEAN WIN` | Low-stakes. Underlined + button links coexist `summary/page.tsx:242,255,259,635,663`. |
| PLR-22 | No dark mode | P3 | `DEFERRED` | `DO NOT DO` (for launch) | Not canon-violating, but reworks the cream/serif/illustration brand — large effort. Park post-launch. |
| PLR-23 | Audio/haptic feedback on answers | P3 | `WON'T DO` | `DO NOT DO` | Wrong answer = discovery, not failure; an "incorrect" tone betrays the thesis. Skip. |
| PLR-24 | Categories skew Western | P3 | `NEEDS DECISION` | `PRODUCT CONVERSATION` | Genuine strategic question. Skew (if real) lives in seed/bank content + declared-interest taxonomy. Fix = **audit those for skew**, NOT a diversity content drive (content is friend-authored/declared, `interests.ts:219,269`). |
| PLR-25 | Missing first-run micro-copy (streaks/points/ritual) | P3 | `PARTIAL` | — | Intro exists `daily/page.tsx:807–855`; omits those concepts. (Note: "streaks/points" framing — keep it ritual/warmth, not pressure.) |

---

## Audit #1 — Design Consistency Audit (15 items)

Source: dispositioned in `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` (code-verified 2026-06-13). Template-style audit run against screenshots, not the live tree — only **CONS-7** is a live finding.

| ID | Item | Status | Notes |
|---|---|---|---|
| CONS-1 | Inconsistent button styling | `TRACKED ELSEWHERE` | Real sub-point owned by `B-VISUAL-TOKEN-BUDGET-01` |
| CONS-2 | Duplicate card patterns | `WON'T DO` | Canon — card tiers deferred; bespoke primitives intentional |
| CONS-3 | Inconsistent iconography | `WON'T DO` | Generic — no surface cited |
| CONS-4 | Duplicate modals & bottom sheets | `WON'T DO` | Canon — same as CONS-2 |
| CONS-5 | Multiple spacing systems | `TRACKED ELSEWHERE` | Folds into token-budget inventory |
| CONS-6 | Varying corner radii | `TRACKED ELSEWHERE` | Covered by token-budget |
| CONS-7 | Inconsistent elevation / shadows | `NEEDS DECISION` | **Real (low).** Option A (uniform flat letterpress) vs B (two intentional registers) before any prompt |
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
