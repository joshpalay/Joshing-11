# Joshing — Full Design Audit

**Date:** 2026-05-30
**Reviewer role:** VP of Design (Color · Consistency · Usability)
**Method:** 6 parallel surface audits (Feed, Gameplay, Home/Daily, Knowledge, Login/Onboarding/Friends, Shell/Profile/Questions) + codebase-wide static analysis.
**Source of truth:** `src/app/globals.css` `:root` design tokens.

---

## Executive Summary

**Is this shippable?** Functionally yes; as a "design-system-driven" product, not yet. The token foundation in `globals.css` is genuinely good (navy ink, warm cream, orange accent, triangle palette, gameplay greens/terracottas). The problem is the app largely **doesn't use it**: ~290 hardcoded hex literals across `.tsx` files, 55 files using inline `style={{}}`, and ~40 distinct font sizes (including half-pixel rem values like `0.58rem`, `0.78rem`, `0.88rem`).

The 3-hour Figma alignment made specific screens *look* right by pasting Figma's hex/px inline — pixel-correct today, but it bypassed the token layer, so a retheme won't reach them and screens are already drifting from each other.

**Single biggest problem:** there is no *enforced* design system — there are four-to-five competing ones running simultaneously:
1. the intended navy-ink token system;
2. a warm-brown ink ramp (`#1a1208` / `#8a8070` / `#0e0e0e`) on Knowledge;
3. a Courier/Playfair "receipt" aesthetic on share cards;
4. raw Tailwind `stone/emerald/amber/rose` palettes on feed sheets and the game summary;
5. a brutalist inline-style island (`OverlapMap`, `borderRadius: 0`, offset shadows).

Adjacent components literally use three different "blacks."

**Two defects rise above style and are effectively bugs:**
- `--accent` is pale cream (`#f1ebdd`) yet used with white/cream text in ≥3 places → the Nav unread-bell badge, the QuestionBankPicker "N selected" state, and the FriendsList "new contacts" highlight were all **invisible**.
- **Fabricated data** in `RecentlyExpanding.tsx` — "Biggest jump this week" was assigned to whichever row was 3rd in the array (`index === 2`); tier transitions were hardcoded fiction, not real user data.

---

## Issues by Severity (deduped across surfaces)

### CRITICAL

| # | Dimension | Location | What's wrong | Status |
|---|---|---|---|---|
| C1 | Color/Usability | `Nav.tsx:133`; `QuestionBankPicker.tsx:81,107`; `FriendsList.tsx:331` | `--accent` (#f1ebdd pale cream) used as fill/text on light surfaces → unread bell badge, "N selected", new-contacts highlight invisible (~1.05:1). | ✅ Fixed |
| C2 | Usability | `RecentlyExpanding.tsx:135-177` | "Biggest jump this week" / tier deltas fabricated from array index & `reason`, not real data. | ✅ Fixed |
| C3 | Color | `TierProgressBar.tsx:48`; `DomainRow.tsx:116` | Progress-bar fill `#2b6ef2` — a blue that exists nowhere in the brand — on the most prominent data-viz element. | ✅ Fixed |
| C4 | Usability | `play-client.tsx:360-366, 343-350` | Answer input has no label/`aria-label`/`id`; form unmounts during the 850ms grading pause (focus lost); submit error renders off-screen with no `role="alert"`. | ✅ Fixed |
| C5 | Usability | `FeedCard.tsx:156`; `SparkleEnvelope.tsx:59` | Feed's primary "Answer →" is a ~24px text-only button (no min-height, no focus-visible ring). | ✅ Fixed |
| C6 | Consistency | whole app | 7 distinct button systems (shadcn `ui/button` — *unused*; `.btn-primary`; `.btn-ghost`; raw `<button>`; inline-style; `role="switch"`; icon-action at 3 sizes). | ✅ Fixed (core) |
| C7 | Consistency | feed + knowledge | Multiple card shells per surface: feed has 3, knowledge has 5 circle renderers + 3 ink systems. | ⏳ Open |
| C8 | Consistency | `circle-sizing.ts:3-15` | Tier sizes jump non-continuously (familiar ≤48px → solid 156-216px → mastery 304-384px), overflowing the 760px column. | ⏳ Open |

### MAJOR (grouped)

**Color — token bypass**
- `NewsRow.tsx:65-156` invents an 8-color hex semantic palette (`#d97706`,`#16a34a`,`#2563eb`…); `accentColor` is computed but never rendered (dead). Body copy is `text-black` (#000), not brand ink.
- `KnowledgeOverviewClient.tsx:232-311`, `DomainRow`, `ProgressionLandscape` use a warm-brown ink ramp (`#1a1208`,`#8a8070`,`#696257`) contradicting the navy ink tokens — `DomainCircle` next to it uses navy `#0a1f3d`. Two blacks side by side.
- `AnsweredByYouCard`, `AnswerFeedbackSheet`, `AnswerSheet`, `AddToDailyFivePrompt` are entirely on Tailwind `stone/emerald/amber/rose` + raw hex (`#047857`,`#065f46`,`#b91c1c`) — never got the brand-token treatment the shared feed cards got.
- `GameplayChat.tsx` hardcodes `#fbf4e3` (= existing `--primary-foreground`), `#b45309`, inside-joke gold trio `#b58a2b`/`#f6c97a`/`#6b4a10`, recheck `#065f46`.
- **Three correct/wrong color systems coexist:** `--game-correct` #366045 (chat) vs Tailwind `emerald/rose` (summary) vs `--success` #178245.
- **Four different "amber" warning recipes** across QuestionForm / InlineHandleField / NotificationsForm / AddToBankAction. Toggles use raw `emerald-500`; errors use `rose-700` instead of `--destructive`.

**Consistency — structure**
- `QuickAddQuestionModal`, `AddFriendRequestModal`, `OverlapMap` each use a foreign token namespace (`--bg`/`--danger`/`--font-literata`, or pure inline hex) — won't match the cards they float over.
- Lately surface (`MomentRow`/`UtilityCard`/`DayDivider`) uses a JS `tokens.ts` that re-declares the CSS palette as string literals consumed via inline style — guaranteed to drift from `:root`.
- Daily flow splits two token vocabularies: summary uses `--brand-*`; `daily/page` + `catchup` use `--surface`/`--text`/`--danger`.
- Off-scale padding everywhere: `p-[14px]`, `pb-[12px]`, `space-y-[14px]`, `gap-[18px]`. Radius vocabulary spans `rounded-[4px]`,`-md`,`-lg`,`-xl`,`-2xl`,`-3xl` for the same "card" concept.
- `AvatarChip` exists but profile header hand-rolls a second avatar; feed person-links reimplemented per card with inconsistent affordance.

**Usability**
- Pervasive sub-44px tap targets: Nav tabs, feed filter pills (`py-1.5`), reaction pills (34px), overflow buttons (`size-8`), close `×` glyphs (~16-28px), `catchup` dismiss (32px).
- `text-foreground/55` inactive nav + `text-[9px]` mono nav labels — fail AA and legibility.
- `window.confirm()` for unfriend (`AddFriendButton`) and invite-rotation (`PrivacyForm`) — native chrome breaks the design language.
- Dead CTA: `MomentRow` "SEND TO A FRIEND →" only `console.log`s.
- Placeholder copy: `MissedQuestionsCard.tsx:22` heading was literally "Learn More!" (✅ fixed → "Catch up").

### MINOR (themes)
- `--font-literata` is misnamed — aliases Cormorant; no Literata loaded. `--game-correct-soft` is a dead token.
- Muted text (`#8a8a8a` ~3.4:1) and orange links (`#d15e36` ~3.8:1) fail WCAG AA for small text across nearly every surface; `/70`–`/80` opacity modifiers push to ~2.9:1.
- ASCII glyphs (`->`, `x`, `-`) where `→`, lucide `X`, `·` are used elsewhere.
- Toasts reimplemented 5+ times at the same `fixed bottom-24` coords (can stack/collide).
- Dark mode (`.dark` block) contains zero brand tokens — dark mode is generic gray, fully off-brand.

---

## Prioritized Fix List (impact ÷ effort)

1. ✅ **Fix `--accent` misuse (C1)** — tiny diff, fixes 3 invisible UI elements.
2. ✅ **Remove fabricated "this week" data (C2)** — trust/integrity issue.
3. ✅ **Recolor blue progress bar + add `role="progressbar"` ARIA (C3)**.
4. ✅ **Fix "Learn More!" placeholder** — content bug.
5. ✅ **Game-loop a11y (C4)** — label input, keep mounted during grading, `role="alert"` error.
6. ✅ **Feed action button (C5)** — shared 44px focus-visible `FeedActionLink`. (Nav/reaction-pill tap targets still ⏳.)
7. ✅ **Pick ONE button system; delete shadcn (C6)** — done: `ui/button.tsx` deleted, `.btn-*` utilities are canonical, single `Switch`. (Sweeping the remaining raw `<button>` ad-hoc styling onto `.btn-*` is follow-on.)
8. ⏳ **Token sweep**: replace Tailwind `stone/emerald/amber/rose` + raw hex with brand tokens on feed sheets, game summary, knowledge.
9. ⏳ **Consolidate card shells + circle renderers (C7/C8)**.
10. ⏳ **Dead `MomentRow` CTA** — wire to real send flow or remove.

---

## Applied in this pass (2026-05-30)

- **C1** — `Nav.tsx` bell badge → `var(--destructive)`; `QuestionBankPicker.tsx` all `--accent` → `--primary` (count text, "Add questions" link, selected border/bg, hover, checkbox accent); `FriendsList.tsx` new-contacts highlight → `bg-primary/5 ring-1 ring-primary/20`.
- **C2** — `RecentlyExpanding.tsx`: deleted `getRowContent`/`growthFor` fabrication (incl. `index === 2 ? 'Biggest jump this week'`), the `from → to` growth column, and the `proof` column. Row now shows only the real `supportingText` or a qualitative label derived from the real `reason` enum (no invented numbers/tiers). Simplified grid to 2 columns; removed now-dead `growthStyle`/`arrowStyle`/`proofStyle`.
- **C3** — `TierProgressBar.tsx`: fill `#2b6ef2` → `var(--brand-navy)`, track `#f3f1eb` → `var(--muted)`; added `role="progressbar"` + `aria-valuemin/max/now`; removed the misleading `Math.max(0.08, …)` fill floor so true 0% renders empty. `DomainRow.tsx` highlight `rgba(43,110,242,0.08)` → `color-mix(in srgb, var(--brand-navy) 8%, transparent)`, border `#1a1208` → `var(--brand-ink)`.
- **Copy** — `MissedQuestionsCard.tsx` heading "Learn More!" → "Catch up".

All changed files pass `npx tsc -p tsconfig.typecheck.json`.

## Applied in second pass (2026-05-30)

- **C5** — added `src/components/feed/FeedActionLink.tsx` (real `<button>`, `min-h-11` 44px target, 18px serif, `focus-visible` ring, `active:`/`disabled:` states). Wired into `FeedCard` (Answer →), `SparkleEnvelope` (Answer →/answerLabel), and `AnsweredByYouCard` (Try again →, Recheck →), replacing four hand-rolled text buttons. Feed card tests still pass (9/9).
- **C4** — `play-client.tsx`: answer `<input>` gets `id`/`<label class="sr-only">`/`aria-label="Your answer"`, `autoComplete="off"`, `autoCapitalize="sentences"`, `enterKeyHint="send"`, and a focus-visible ring. Form now renders on `actualCurrentQuestion` (stays mounted through the 850ms grading pause) with the input/button `disabled` during `pending`/`pausingAfterAnswer`; a `useEffect` keyed on `currentQuestion?.questionId` + `pending` refocuses the field when it becomes editable. Error moved directly above the sticky input with `role="alert"` + `aria-live="assertive"`, colored `var(--game-wrong-strong)`.

## Applied in third pass — C6 button consolidation (2026-05-30)

The canonical button system is now the `.btn-*` utility family in `globals.css`; the shadcn component was deleted.

- **`globals.css`** — `.btn-primary`/`.btn-ghost` bumped to `min-h-11` (44px) + `focus-visible` ring; added `.btn-danger` and `.btn-icon` (size-11) utilities.
- **Deleted `src/components/ui/button.tsx`** (the unused-but-imported shadcn `Button`/`buttonVariants`). Migrated its 4 importers to `.btn-*`:
  - `friends/AddFriendButton.tsx` — all states → `.btn-primary`/`.btn-ghost` (secondary/disabled states map to `.btn-ghost` disabled).
  - `friends/AddFriendRequestModal.tsx` — Cancel → `.btn-ghost`, Send → `.btn-primary`.
  - `feed/AnswerSheet.tsx` + `feed/AnswerFeedbackSheet.tsx` — Submit/Done converted to plain `<button>` keeping their stone palette but now `min-h-11` + focus-visible ring. (Their stone/emerald palette is still on the token-sweep list — out of scope for C6.)
- **Added `src/components/ui/Switch.tsx`** — one toggle with `--primary` (navy) on-state + focus-visible ring, replacing the duplicated `role="switch"` markup and the raw `bg-emerald-500` on-state in `NotificationsForm` (SMS + email toggles) and `PrivacyForm` (`ToggleRow`).

Typecheck clean (exit 0). No `@/components/ui/button`, `emerald-500`, or raw `role="switch"` references remain. `FeedCards` tests 25/25.

> **Test-suite caveat (pre-existing, not from this work):** `npx vitest run` shows ~27 failures across ~13 suites, but these reproduce with all design changes stashed. They are test-infra issues — `vi.mock` factories missing `masteryEvents` / `INVITE_REQUIRED_MESSAGE` exports, the LLM mock returning no `usage.input_tokens`, and a `DomainCard` "contribution dots" assertion. None touch the button/switch/feed/progress changes here. Worth a separate cleanup pass.

---

## Ready-to-paste fix prompts (remaining top items)

### C6 — Decide the button system
> Audit shows 7 button implementations and the canonical `src/components/ui/button.tsx` is imported by almost nothing. Pick one. If `.btn-primary`/`.btn-ghost` win: add `.btn-danger` + `.btn-icon` utilities and a `min-h-11` standard; migrate raw/inline buttons in `QuestionForm`, `MyQuestionCard`, `AccountActions`, `questions/page`, `QuickAddQuestionModal`, `AddFriendButton`; delete `ui/button.tsx`. Build one `<Switch>` to replace duplicated `role="switch"` markup in `NotificationsForm`/`PrivacyForm` (stop using raw `emerald-500`).

### Token sweep (feed/game/knowledge)
> Replace hardcoded Tailwind palette colors and raw hex with brand tokens: correct → `--success`/`--game-correct`, wrong → `--destructive`/`--game-wrong`, card surface → `--brand-card` (not `bg-white`), ink → `--brand-ink` (not `text-stone-9xx`/`text-black`), borders → `--brand-rule`/`--border-warm`, muted → `--brand-ink-400`. Target files: `AnsweredByYouCard`, `AnswerFeedbackSheet`, `AnswerSheet`, `AddToDailyFivePrompt`, `FeedList` pills/links, `GameplayChat`, `summary/page`, `KnowledgeOverviewClient`, `DomainRow`, `ProgressionLandscape`, `NewsRow`.

### Card-shell + circle consolidation
> Extract one `FeedCardShell` (border `--brand-rule`, `bg-[var(--brand-card)]`, `rounded-md`, top accent bar) and render SparkleEnvelope/FriendAnswered/FriendLiked/AnsweredByYouCard through it. Extract one `KnowledgeBubble` primitive owning the gradient + opacity math and pulling color from a single `getDomainColor`; refactor the 5 circle renderers to it. Rework `circle-sizing.ts` to one continuous, column-bounded scale.

---

## Cross-cutting recommendation

The foundation is strong but **advisory, not enforced**. Highest-leverage next move isn't pixel work — it's a token-enforcement sweep (lint rule against raw hex / `bg-white` / Tailwind palette colors in `src/components`, plus a shared card/button/input primitive set) so the Figma fidelity you bought stays bought.
