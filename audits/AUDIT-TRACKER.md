# Audit Tracker

One living ledger for the two audits currently being worked down. Edit the **Status** column as you take items off the board.

**Last code-verification pass:** 2026-06-13 (against branch `claude/audit-items-tracking-kp59my`).

## How to use this file

- **Take an item down:** change its **Status** and, if useful, drop a note + commit SHA in the **Notes** column.
- **Re-run the code check:** ask me in this session — "re-verify the audit tracker" (or just the items you touched). I re-read the current code, update the Status/Notes columns, and note a fresh "Last verification pass" date. The check is a read-only pass; it never changes app code.
- **Add a new item:** add a row to the relevant table with the next free ID (e.g. `PLR-26`, `CONS-16`), or a new `MISC-n` row in the *Other / ad-hoc* table at the bottom. Or tell me "add X to the tracker" and I'll slot it in. New audits get their own table + ID prefix.

### Status legend

| Status | Meaning |
|---|---|
| `DONE` | Verified fixed in code. |
| `PARTIAL` | Substantially addressed; a residual gap remains (see Notes). |
| `OPEN` | Not addressed yet. |
| `NEEDS DECISION` | Real finding, but a product/design call is required before any work. |
| `TRACKED ELSEWHERE` | Genuine signal, already owned by another workstream. |
| `WON'T DO` | Dismissed — contradicts canon, describes a surface we don't have, or generic boilerplate. |

---

## ⭐ Start here — open & important

The items most worth attention right now (open launch blockers + the one decision gate):

| ID | Item | Priority | Status |
|---|---|---|---|
| PLR-1 | Developer tools (test game / reset / noon reset / staging flags / points diagnostic) visible to all users | P0 | `OPEN` |
| PLR-11 | "Card Color" PaletteToggle dev tool still shipped to all users (code comment: "remove before shipping") | — | `OPEN` |
| PLR-2 | Intermittent 404 on root during sign-in | P0 | `OPEN` (runtime verify) |
| PLR-3 | "Show me the answer" double-action / duplication | P1 | `OPEN` (runtime verify) |
| PLR-8 | Catch-up answer-reveal consumes a missed question with no confirmation | P1 | `OPEN` |
| PLR-15 | No onboarding/tour for the Knowledge Map | P1 | `OPEN` |
| PLR-16 | Overwhelming home feed after the daily five | P1 | `PARTIAL` |
| CONS-7 | Shadow / elevation drift (flat letterpress vs. blurred shadows coexist) | — | `NEEDS DECISION` |

---

## Audit #2 — Product Design Pre-Launch Review

Source: `audits/2026-06-13-product-design-prelaunch-review.md` (25 improvements + launch blockers). Priority = the audit's own launch-blocker ranking (blank = not on the blocker list; rank by impact).

| ID | Item | Priority | Status | Notes (evidence @ 2026-06-13) |
|---|---|---|---|---|
| PLR-1 | Dev tools visible to all users | P0 | `OPEN` | Rendered unconditionally in `src/components/profile/settings/AccountActions.tsx:102–135`; no `NODE_ENV`/admin guard. |
| PLR-2 | Intermittent 404 on root during sign-in | P0 | `OPEN` | `page.tsx`/`proxy.ts` redirect logic looks correct; a 404 *flash* is a runtime/network timing observation — needs a live repro. |
| PLR-3 | "Show me the answer" duplication (double action) | P1 | `OPEN` | Text reveal at `src/components/play/GameplayChat.tsx:541`; the exact "button-inside-button, same label" wasn't found in code — needs a live repro to confirm/close. |
| PLR-4 | Auto-generated tagline misrepresents new users | P1 | `DONE` | `buildMindStatement()` `src/app/users/[id]/page.tsx:78–91` now derives the line from real mastery; new users get a neutral placeholder, not random subcultures. |
| PLR-5 | "Use this" artefact in rewrite suggestions | P1 | `DONE` | Fixed in `75eb625`; "Use this" + text are separate block spans in `src/components/QuestionForm.tsx:280–291`. |
| PLR-6 | No success feedback after saving a question | — | `DONE` | `419201a`; "✓ Saved to your bank" panel (`role=status`, `aria-live=polite`) at `src/components/QuestionForm.tsx:541–549` + host toast. |
| PLR-7 | Gear icon on Today's Five card does nothing | P2 | `DONE` | It's a `<Link href="/daily/setup">` (`aria-label="Set up daily round"`) at `src/components/TodaysFiveCard.tsx:209–215`. |
| PLR-8 | Catch-up reveal consumes a missed question, no confirmation | P1 | `OPEN` | `onGiveUp={() => skipCurrent()}` with no confirm step — `src/app/daily/catchup/page.tsx:138`. |
| PLR-9 | Privacy toggles lack per-section context | P2 | `DONE` | `419201a`; `SECTION_VISIBILITY_HELP` per-scope copy `src/app/users/[id]/page.tsx:546–565`, wired via `help` prop (`:606`). |
| PLR-10 | "Establishing" label unclear | — | `OPEN` | Rendered with no tooltip — `src/components/TodaysFiveCard.tsx:49,58`; tier name also at `TerritorySetupClient.tsx:181`. |
| PLR-11 | Card-colour switcher confusing / unexplained | — | `OPEN` | `PaletteToggle` is a **dev tool still live for everyone** — `src/app/layout.tsx:7,72` with comment "Remove … before shipping." Treat as a ship gate alongside PLR-1. |
| PLR-12 | Profile editing hidden behind preview | — | `PARTIAL` | Inline click-to-edit fields (`InlineEditableField`, `InlineHandleField`) `src/app/users/[id]/page.tsx:492–539`; no explicit "Edit profile" affordance — discoverable only by tapping. |
| PLR-13 | Explanation field is a small scrolling textarea | — | `OPEN` | `rows={4}`, no `resize-y` — `src/components/QuestionForm.tsx:666`. |
| PLR-14 | Friend list lacks quick actions | P2 | `OPEN` | `FriendCard` is just a `<Link>` to profile — `src/components/FriendsList.tsx:108–122`; no play/message/unfriend. |
| PLR-15 | No onboarding/tour for Knowledge Map | P1 | `OPEN` | No first-run tour/intro in `src/app/knowledge/page.tsx` or children. |
| PLR-16 | Overwhelming home feed | P1 | `PARTIAL` | Budgeted "edition" caps volume (`src/server/home/build-edition.ts`, `src/app/page.tsx:118–161`, D-HOME-PACING-01) — but no collapsible grouping as the audit asked. |
| PLR-17 | Catch-up flow lacks closure/celebration | — | `PARTIAL` | `RoundSummary` closing state w/ score dots + recap + CTAs `src/app/daily/catchup/page.tsx:173–311`; no celebratory animation. |
| PLR-18 | Knowledge frequency options lack micro-copy | P2 | `DONE` | Each zone has explanatory `copy` — `src/app/daily/setup/TerritorySetupClient.tsx:43–55`. |
| PLR-19 | Invite flow generic; unclear link/email/SMS | — | `PARTIAL` | "Send a personal invite" + "Copy invite link" with "share anywhere" copy — `src/components/friends/InviteSomeoneNew.tsx:54–84`; no explicit SMS/email labelling. |
| PLR-20 | Avatars are initials-only; no photo upload | — | `OPEN` | `AvatarChip` is initials-only; no upload input/API anywhere. |
| PLR-21 | Inconsistent link styling on summary page | — | `OPEN` | Underlined + button-styled links coexist — `src/app/daily/summary/page.tsx:242,255,259,635,663`. |
| PLR-22 | No dark mode | P3 | `OPEN` | No `prefers-color-scheme: dark` block / dark tokens in `src/app/globals.css`. |
| PLR-23 | No audio/haptic feedback on answers | P3 | `OPEN` | No `navigator.vibrate` / `AudioContext` anywhere in `src/`. |
| PLR-24 | Knowledge categories skew Western | P3 | `OPEN` | Pool is LLM-generated against user interests; prompts acknowledge cultural context (`src/server/llm/interests.ts:219,269`). Needs live data analysis to judge skew. |
| PLR-25 | Missing first-run micro-copy (streaks/points/"Daily Five is sacred") | P3 | `PARTIAL` | First-run intro exists (`src/app/daily/page.tsx:807–855`) but doesn't cover streaks/points/the ritual framing. |

---

## Audit #1 — Design Consistency Audit ("…and Polish Plan")

Source: dispositioned in `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` (15 items, code-verified 2026-06-13). Net: only **CONS-7** is a live finding; the rest are closed.

| ID | Item | Status | Notes |
|---|---|---|---|
| CONS-1 | Inconsistent button styling | `TRACKED ELSEWHERE` | Misreads the "blue = action CTA only" rule; the one real sub-point (hardcoded vs. token) lives in `B-VISUAL-TOKEN-BUDGET-01`. |
| CONS-2 | Duplicate card patterns | `WON'T DO` | Canon: card-tier work deferred to `B-VISUAL-CARD-TIERS-01`; `LoadingScreen`/`OverlapMap` are intentional bespoke primitives. |
| CONS-3 | Inconsistent iconography | `WON'T DO` | Generic — no Joshing surface cited. |
| CONS-4 | Duplicate modals & bottom sheets | `WON'T DO` | Canon — same as CONS-2; deferred card/primitive decisions. |
| CONS-5 | Multiple spacing systems | `TRACKED ELSEWHERE` | Folds into the token-budget literal inventory. |
| CONS-6 | Varying corner radii | `TRACKED ELSEWHERE` | Same files re-literalize values; covered by token-budget. |
| CONS-7 | Inconsistent elevation / shadows | `NEEDS DECISION` | **Real (low).** Flat `Npx Npx 0` offsets coexist with blurred drop shadows; nothing uses `1px 1px 0`. Decide **Option A** (uniform flat letterpress) vs **Option B** (two intentional registers) before any prompt. |
| CONS-8 | Non-standard typography hierarchy | `WON'T DO` | Generic — font tokens defined; complaint ungrounded. |
| CONS-9 | Mixed illustration styles | `WON'T DO` | Generic — no screens cited. |
| CONS-10 | Inconsistent form controls | `WON'T DO` | Generic — no surface cited. |
| CONS-11 | Multiple progress-indicator styles | `WON'T DO` | Generic — progress already unified (`GeometricProgress`, Daily Five dots). |
| CONS-12 | Duplicate tag/chip/badge components | `WON'T DO` | Generic — no instances cited. |
| CONS-13 | Uneven navigation patterns | `WON'T DO` | Invented — one consistent bottom nav (`src/components/Nav.tsx`); no drawer/top-tab conflict. |
| CONS-14 | Different animation language | `WON'T DO` | Generic — no interactions cited. |
| CONS-15 | Knowledge-visualisation inconsistency | `WON'T DO` | Canon — category colours are identity signals, not a palette to normalize. The underlying collision was already fixed/promoted. |

---

## Other / ad-hoc items

Add anything that isn't from the two audits here.

| ID | Item | Status | Notes |
|---|---|---|---|
| _(none yet)_ | | | |
