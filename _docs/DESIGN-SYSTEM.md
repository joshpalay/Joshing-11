# Joshing — Design Canon

**This file is the one authoritative design ruleset.** It replaced the 2026-05-19 "Design
System Reference" in place on 2026-09-11 (`B-FABLE-DESIGN-CANON-01`, Fork B3). The old
inventory documented a `<Button>` component that had been deleted, a 10px card that had become
4px, and a font stack that had been swapped; nothing from it survives here unverified.

**Status contract.** Every rule carries one of two markers:

- **RATIFIED** — a decision that has been made, with its source named. Do not reopen without
  cause. Sources are `DECISIONS.md`, a ratified `D-*` doc, `_docs/STYLE-GUIDE-*.md`, or the
  Phase 2 rulings of 2026-09-11 (recorded in `_docs/DESIGN-CANON-CONFLICTS.md` §4).
- **PROPOSED** — a rule written where no rule existed, justified against canon and live usage.
  Not enforced until ratified. **As of 2026-09-11 every rule in this document is RATIFIED**:
  the Phase 3 proposals were ratified individually in Phase 4 (recorded in
  `_docs/DESIGN-CANON-CONFLICTS.md` §5), with one amendment — the FAB sits on
  `--shadow-card-strong`, not `--shadow-overlay`. Future additions start as PROPOSED again —
  the first is §4.3 (selectable chips), surfaced by the conformance script the same day.

**Sources of truth for values.** Tokens live in `src/app/globals.css` (the only place a colour,
radius, shadow, or z-index value is defined). Button recipes live in the `@layer components`
block of the same file. Primitives live in `src/components/ui/`. Where this document and
`globals.css` disagree, `globals.css` is right and this document has a bug — fix the document.

**Standing rules inherited, not restated.** No new design token without an explicit decision
(`D-CONSISTENCY-AUDIT-DISPOSITION-01`). Grading colours are reserved and never the sole signal
(`STYLE-GUIDE-COLOR` §1). The content is loud, the interface is quiet (`STYLE-GUIDE-TYPE`).
Provenance is honest (`PRODUCT-CANON` §5.3). Colour rules are **out of this document's scope**
(Fork D1) — see §10.

**Grep expressions** are given where a rule can be checked mechanically. They are the input to
the Phase 5 lint selectors and `scripts/audit-design-conformance.mjs`; they match violations,
so a clean codebase returns zero.

---

## 1. Geometry

### 1.1 The radius scale — RATIFIED (`globals.css:45-52`)

This app overrides Tailwind's scale. Use these numbers, not Tailwind's defaults.

| Token | Value | Tailwind class |
|---|---|---|
| `--radius-xs` | 4px | `rounded-[var(--radius-xs)]` |
| `--radius-card` | **4px** (alias of `--radius-xs`) | `rounded-[var(--radius-card)]` |
| `--radius-sm` | 6px | `rounded-sm` |
| `--radius-md` | 8px | `rounded-md` |
| `--radius-lg` | 10px | `rounded-lg` |
| `--radius-xl` | 14px | `rounded-xl` |
| `--radius-2xl` | **18px** (not 16) | `rounded-2xl` |
| `--radius-3xl` | **22px** (not 24) | `rounded-3xl` |
| `--radius-4xl` | 26px | `rounded-4xl` |
| — | 9999px | `rounded-full` |

Literal arbitrary radii (`rounded-[4px]`, `rounded-[2rem]`) are banned in components; the
radius ratchet holds them at zero (`scripts/check-radius-ratchet.mjs`). The `.btn-*` recipes
write `rounded-[4px]` inside `globals.css`, which is exempt.

### 1.2 Cards — RATIFIED (Phase 2 ruling 1; `globals.css:378-385`; commit `5b873477`)

**Every content card has a 4px corner, spelled `--radius-card`.** One value, one name.

- `--radius-card` is for anything that *is* a card: feed cards, section cards, settings rows
  that render as cards, skeleton stand-ins for cards.
- `--radius-xs` (the same 4px) is reserved for **non-card controls**: inputs, the login field,
  small chrome. Do not use it on a card; the card rule must stay greppable by its own name.
- `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl` on a card-shaped container are drift.
  The Phase 2 migration (`5b873477`) covered the friends/profile/invite section cards; the
  conformance script (`check:design` R3) then found **about forty more** card containers still
  on `rounded-lg`/`rounded-xl` — the daily summary and catch-up panels, `ExpandDomainOfferCard`,
  `FirstSessionPanel`, `knowledge/[domain]` sections, every settings form section
  (`NotificationsForm`, `PrivacyForm`, `AccountActions`, the LLM readouts), `BlockedList` rows,
  `InlineEditableField`/`InlineHandleField` card variants, `SendQuestionDrawer:173` — plus the
  four on `rounded-2xl` (`NotForMeSheet.tsx:157`, `HiddenQuestions.tsx:69`,
  `daily/summary/page.tsx:328`, `users/[id]/page.tsx:582`). All codemod work, not exceptions.

Grep (cards on a non-card radius, approximate — pairs a card fill with a named radius):
`rg -n 'rounded-(lg|xl|2xl|3xl)\b[^"]*(bg-card|bg-\[var\(--brand-card\)\]|border-\[var\(--brand-rule\)\])|(bg-card|bg-\[var\(--brand-card\)\])[^"]*rounded-(lg|xl|2xl|3xl)\b' src --glob '*.tsx'`

### 1.3 Sheets, modals and popovers — RATIFIED (Phase 4, 2026-09-11)

These are **not cards** and do not take the card radius. Live usage has converged on one shape
(`CreateChooser.tsx:65`, `AddAreaModal.tsx:47`, `AskFriendForDomain.tsx:215`,
`InviteLinksSection.tsx:359,470`):

- Bottom sheet: `rounded-t-2xl` (18px, top corners only), full width on mobile.
- The same component centered on `md:`: `md:rounded-2xl`, `md:max-w-md`.
- Centered modal: `rounded-2xl`.
- Anchored action menu (`FeedActions.tsx:158`, `AnsweredRowActions.tsx:70`,
  `daily/summary/page.tsx:990`): today `rounded-3xl` (22px). Ratified (Phase 4): **`rounded-2xl`**, so
  every overlay shares one corner.

Grep (overlay on a non-2xl radius): `rg -n 'role="dialog"' -A3 src --glob '*.tsx' | rg 'rounded-(3xl|xl|lg)\b'`

### 1.4 Round things — RATIFIED (Phase 2 ruling 3; inputs Phase 4)

`rounded-full` is for **chips, badges, avatars, the FAB, and circular icon hit-areas** only.

- **RATIFIED:** a primary or secondary action is never a pill. The onboarding "Add" pill
  (`OnboardingFlow.tsx:881`) becomes a standard button (§3.1). Commit `e68aebde` already
  stripped the other `rounded-full` overrides from `.btn-*` sites; none remain on `main`.
- **RATIFIED (Phase 4):** inputs are never pills either (`OnboardingFlow.tsx:880` `rounded-full` input →
  `--radius-xs`, matching `LoginPanel.tsx:27` and `KnowledgeFlatClient.tsx:914`).

Grep (a button or input that is a pill):
`rg -n '<(button|input)\b' -A5 src --glob '*.tsx' | rg 'rounded-full' | rg -v 'size-(9|10|11|12|14)|aria-label'`

### 1.5 Inputs — RATIFIED (Phase 4, 2026-09-11)

Two recipes exist (`LoginPanel.tsx:27` at 44px; `KnowledgeFlatClient.tsx:914` at 48px). Ratified (Phase 4)
floor: `min-h-11` (44px), `rounded-[var(--radius-xs)]`, `bg-[var(--brand-field)]` (white, per
`globals.css:88`), hairline `border`, `text-base`. Height beyond 44 is a surface choice.

---

## 2. Elevation

### 2.1 The registers — RATIFIED (`D-CONSISTENCY-AUDIT-DISPOSITION-01` §"Register assignment", Option B; `globals.css:386-399`)

Two intentional registers plus a focus idiom. Tailwind `shadow-sm/md/lg/xl/2xl` are
**off-register** everywhere in components (the old DESIGN-SYSTEM §5.1 table that sanctioned
them is withdrawn).

| Register | Token | Value | Belongs to |
|---|---|---|---|
| Soft — rest | `--shadow-paper-rest` | `0 1px 2px /0.05` | inputs, inline paper lift |
| Soft — card | `--shadow-card` | `0 4px 12px rgba(40,32,30,.04)` | every resting card (`.card`, `FeedCardShell`, section cards) |
| Soft — card-strong | `--shadow-card-strong` | `0 4px 12px /0.1` | elevated / playable cards (`FeedCardShell` elevated, `ActivityStreamItem` playable rows) |
| Soft — overlay | `--shadow-overlay` | `0 12px 28px rgba(26,18,8,.16)` | centered modals (`QuickAddQuestionModal`, `AddFriendRequestModal`), and per §2.2 every sheet |
| Flat letterpress | `--shadow-stamp` / `--shadow-stamp-sm` | `4px 4px 0 ink` / `2px 2px 0 ink` | `OverlapMap`, `KnowledgeOverviewClient`, `ShareCard` (see §2.3) |
| Focus / selection ring | `0 0 0 2px <color>` | literal | selected-state cards (`AnsweredByYouCard`, catch-up, summary, `DomainCircle`) — a *selection* idiom, distinct from keyboard focus (§9) |

Grep (Tailwind shadow utility in a component): `rg -n '\bshadow-(sm|md|lg|xl|2xl)\b' src --glob '*.tsx'` — 35 on `main` (11 `shadow-sm`, 24 `lg/xl/2xl`).

### 2.2 Sheets, drawers, popovers and the FAB sit on `--shadow-overlay` — RATIFIED (Phase 4, 2026-09-11)

The disposition doc assigned `--shadow-overlay` to the two centered modals only; 30 sites now
use it, including bottom sheets. Ratified: **one overlay register** for every floating surface
(sheet, drawer, anchored menu, toast). The remaining `shadow-2xl/xl` sheets
(`FeedActions.tsx:158`, `AnsweredRowActions.tsx:70`, `AddAreaModal.tsx:47`,
`daily/summary/page.tsx:990`) migrate. **Exception, by Phase 4 amendment:** the FAB
(`Nav.tsx:225`) moves from `shadow-lg` to **`--shadow-card-strong`** — the heavy overlay blur
under a 56px circle reads as a stain; if it looks fine in practice, overlay is acceptable.

### 2.3 Letterpress is tokenised — RATIFIED (Phase 4, 2026-09-11) (E-2)

The disposition text says "literal, not tokenized"; `globals.css:398-399` has since tokenised
it and `OverlapMap`/`KnowledgeOverviewClient` consume the tokens. Ratified (Phase 4): the tokens are the
register's canonical form; `ShareCard.tsx:134` (live DOM) migrates to `var(--shadow-stamp)`;
`SharePortraitCard.tsx` (html2canvas raster) stays literal, exempt.

### 2.4 Exemptions — RATIFIED (disposition doc §"Register assignment" and §"Deferred")

- Bespoke tinted glows: `GameplayChat` navy glow, ceremony gem radial glow + inset.
- Deferred "raised" register: `TerritorySetupClient` (`0 12px 28px`, `0 24px 60px`,
  `drop-shadow-lg`) and `PortraitCircles` (`0 1px 3px`). Left as literals until a
  `--shadow-raised` token is decided. Not drift; not to be "fixed" by a sweep.
- Dev-only CSS: the `data-shadow` / `data-flat` blocks at `globals.css:720-762` are testing
  chrome; `PaletteToggle` is unmounted (`layout.tsx:10`).

---

## 3. Buttons — the whole tree

**RATIFIED (Phase 2 rulings 2–3; `globals.css:488-510`; commit `8df528f8`, 2026-05-30):
there is no React `<Button>`. The `.btn-*` utility family is the button primitive.** Do not
reintroduce a component wrapper; add a recipe to `globals.css` under an explicit decision.

Shared by every type below: `type="button"` unless it submits; the Interface voice (sans,
sentence case — `STYLE-GUIDE-TYPE` §3); the focus ring of §9; `disabled:pointer-events-none
disabled:opacity-45`; the 44px touch floor of §9. **No per-site overrides of height, radius,
weight, or fill on a `.btn-*` class** — if a surface needs a different button, it needs a
different type, decided here.

Grep (a `.btn-*` site overriding the recipe):
`rg -n 'btn-(primary|ghost|danger|icon)[^"'\''`]*\b(min-h-|h-1|rounded-|text-(xs|sm|base|lg)|font-(medium|semibold|bold)|bg-\[)' src --glob '*.tsx'` — 8 on `main`, all `min-h-11` (moot once §3.1 lands) except `InviteLinksSection.tsx:501`.

### 3.1 Primary CTA — `.btn-primary` — RATIFIED (Phase 2 ruling 2)

**Height is 44px (`min-h-11`).** Josh chose the invite-screen override over the 48px recipe.
Everything else in the recipe stands: `rounded-[4px]`, `bg-[var(--btn-primary-bg)]` (navy),
`text-base font-bold tracking-[0.04em] text-white`, `px-4 py-2`, `hover:opacity-90`.

- **Pending recipe edit** (this job may not touch `globals.css`; see §12): `globals.css:497`
  `min-h-12` → `min-h-11`; the header comment's "48px-tall" and "brand-link fill" both
  corrected. Once landed, the eight `btn-primary min-h-11` overrides are redundant and the
  codemod strips them.
- **One per view.** A primary CTA is the single most important action on the surface. Two
  side by side is a design error, not a layout problem.
- **Use it for:** starting or resuming play, submitting a form, accepting an invitation,
  the one "yes" in a confirm. **Not for:** anything destructive (§3.3), anything in a list row
  (§3.6), anything that merely navigates (use a link or §3.7).

### 3.2 Secondary — `.btn-ghost` — RATIFIED (`globals.css:500-502`)

44px, `rounded-[4px]`, hairline `border`, `bg-background`, `text-sm font-medium
text-foreground`, `hover:bg-muted`. The "no" or "later" beside a primary; a self-contained
low-emphasis action ("Change number", "Cancel", "Not now"). Reads as a step quieter than
primary by weight and size, never by colour.

### 3.3 Destructive — `.btn-danger` — RATIFIED (`globals.css:504-506`; Phase 2 ruling 2)

44px, `rounded-[4px]`, `bg-destructive`, `text-sm font-medium text-white`. **The only button
that may be red.** `InviteLinksSection.tsx:501` (a `.btn-primary` repainted
`bg-[var(--destructive)]`) is a `.btn-danger` wearing the wrong class — codemod. Always paired
with an inline confirm (`.btn-danger` + `.btn-ghost`), never `window.confirm()`
(`design-sweep-NEXT-STEPS` item 5).

### 3.4 Icon button — `.btn-icon` — RATIFIED recipe (`globals.css:508-510`); adoption RATIFIED (Phase 4)

`size-11` (44×44), `rounded-[4px]`, `text-foreground`, `hover:bg-muted`. One consumer on
`main`; ~30 icon buttons hand-roll `inline-flex size-11 items-center justify-center
rounded-full …` (`AnswerFeedbackSheet.tsx:201,210,428`, sheet close buttons, "More actions").

**RATIFIED (Phase 4):** every icon-only button uses `.btn-icon`. A **circular** icon button is allowed
in exactly two places — a sheet/modal close control and the FAB — via an added `rounded-full`
(the one sanctioned override of the family, because the circle is the affordance there).
Icon-only buttons **must** carry `aria-label`. The glyph is lucide at `size-5` (20px).

Grep (hand-rolled icon button): `rg -n '<button\b' -A5 src --glob '*.tsx' | rg 'size-(9|10|11|12) [^"]*rounded-full' | rg -v 'btn-icon'`

### 3.5 Tab — RATIFIED (Phase 4, 2026-09-11)

Live: `FeedList.tsx:717` (`role="tab"`, `aria-selected`, `px-4 py-2.5 text-sm font-medium`),
`Nav.tsx` bottom tabs (active = `bg-foreground`). Ratified (Phase 4) recipe: `min-h-11 px-4 text-sm
font-medium`, `role="tab"` + `aria-selected` + roving `tabIndex` mandatory, selected state
carried by **ink fill or a 2px underline in `--foreground`**, never by hue alone. No radius
on inline tab strips; bottom-nav tabs keep their own chrome (`Nav.tsx` is a named surface).

### 3.6 List-row button — RATIFIED (Phase 4, 2026-09-11)

A whole row that is tappable (`daily/summary/page.tsx:1002`, `NotForMeSheet.tsx:157`,
`HiddenQuestions.tsx:69`, 18 sites). Ratified (Phase 4) recipe: `flex w-full min-h-11 items-center
gap-3 px-3 text-left text-sm rounded-[var(--radius-card)] hover:bg-muted transition`. Rows
inside a `divide-y` list take **no radius and no border of their own** (the list rule
separates them, §6); rows that stand alone take the card radius. Never `rounded-xl/2xl`.

### 3.7 Inline text action — RATIFIED (`STYLE-GUIDE-TYPE` §3, "one recipe"; `FeedActionLink.tsx`)

`inline-flex min-h-11 items-center text-[color:var(--brand-link)] underline underline-offset-4`,
size `lg` = `text-sm font-medium`, size `sm` = `text-quiet font-medium tracking-[0.04em]`.
Canonical implementation `FeedActionLink`; satellites match it by hand. Sans, never serif
(exception: a person's name as subject, `STYLE-GUIDE-TYPE` §5). It is a link register, not a
heading — never the old 18px serif. Use for "Answer →", "Try again →", "View N more", "See
today's recap". 49 sites on `main`.

### 3.8 FAB — RATIFIED as a type (Phase 2 ruling 3); spec RATIFIED (Phase 4, amended shadow)

`Nav.tsx:225`: `fixed right-5 bottom-24 size-14 rounded-full bg-primary
text-primary-foreground grid place-items-center`. **One FAB in the app** (the composer).
Its shadow moves from `shadow-lg` to `var(--shadow-card-strong)` (§2.2, Phase 4 amendment);
its z-index is `--z-nav` (it is chrome). Never a second FAB, never a FAB inside a sheet.

### 3.9 Invisible hit target — RATIFIED (Phase 4, 2026-09-11)

The scrim-tap-to-close button (`CreateChooser.tsx:64`, `questions/page.tsx:599`,
`daily/summary/page.tsx:984`, 14 sites): `<button type="button" className="absolute inset-0
cursor-default" aria-label="Close …" onClick={onClose} />`. Rules: always `type="button"`,
always an `aria-label` naming what it closes, never carries a visible child, never the only way
to close (a visible close control must exist). It is the one button exempt from the 44px
floor because it *is* the whole backdrop.

### 3.10 Choosing — the decision rule

> Is it the one thing this screen wants me to do? → **primary.** Is it the quiet alternative
> next to that? → **ghost.** Does it delete or revoke? → **danger.** Is it a glyph with no
> words? → **icon.** Does it switch what I'm looking at without leaving? → **tab.** Is the whole
> row the button? → **list-row.** Is it a sentence-level "do this →"? → **inline text.** Is it
> the composer, floating over everything? → **FAB.** Is it the backdrop? → **invisible.**

Anything that fits none of these is a new type and needs a decision before it ships.

---

## 4. Chips and badges

### 4.1 Chip — RATIFIED (Phase 2 ruling 4; `src/components/ui/Chip.tsx`; commit `9b9820b0`)

**`<Chip>` is the one chip/tag primitive, and `md` is the chip.** `md` = `px-2.5 py-1 text-xs
font-medium leading-none rounded-full`; `neutral` (`bg-muted`) or `outline`; `uppercase`
adds the System-voice signature (`tracking-[0.08em]`). A label is required — a chip never
signals by colour alone. Surface *colour* stays a caller concern (audit CH-2, out of scope
here); callers pass hue via `className`/`style` **in addition to** the label.

- **RATIFIED (Phase 4):** retire Chip `sm` (`text-[10px]`). Its only real job was the difficulty label
  (`MyQuestionCard.tsx:65`), which is `md` + `uppercase`; the count-badge job moves to §4.2.
- **RATIFIED (Phase 4):** callers may **not re-pad or re-size** a Chip. `PeopleYouInvited.tsx:299`
  (`className="px-3"`) is drift. Colour overrides remain allowed until the palette pass.

Grep (chip geometry override): `rg -n '<Chip\b[^>]*className="[^"]*\b(p[xy]-|text-(xs|sm|\[)|rounded-)' src --glob '*.tsx'`
Grep (hand-rolled chip): `rg -n 'rounded-full[^"]*\b(px-2|px-2\.5|px-3)\b[^"]*\b(text-xs|text-\[10px\]|text-sm)' src --glob '*.tsx' | rg -v 'Chip|<button|<input'`

### 4.2 Badge — RATIFIED (Phase 4, 2026-09-11) (Phase 2 ruling 4 asked for a suggestion)

A **count badge** (the unread number on the bell, `Nav.tsx:201,300`; the count on a tab,
`FeedList.tsx:733`) is a separate primitive, not a Chip: it carries a number, not a label,
and sits *on* another control. Ratified (Phase 4) `<Badge>` in `src/components/ui/`:

- Geometry: `min-w-[18px] h-[18px] px-1.5 rounded-full grid place-items-center`.
- Type: **10px**, `font-semibold`, `tabular-nums`, `leading-none`. This is the single
  sanctioned use of 10px; it is a primitive-internal size, not a new step on the type scale
  (`STYLE-GUIDE-TYPE` §3 stays as written: 9/10/11/15 remain arbitrary elsewhere).
- Content: a number or a dot (`size-2`, no text) for "unread, uncounted". Never words.
- Colour: out of scope (the bell uses `--destructive`, the tab uses `--primary` — audit B-2
  flags the latter; resolved in the palette pass, not here).
- Position: `absolute top-1 right-1` on its host, or inline after a label with `gap-2`.

---

### 4.3 Selectable chip (filter / toggle pill) — PROPOSED (surfaced by `check:design` R4, 2026-09-11; not yet ratified)

Roughly a dozen pills are **buttons**, not labels: interest pickers (`OnboardingFlow.tsx:171-211`,
`AddTopicField.tsx:58`, `QuestionForm.tsx:1057`), the daily-summary filter row
(`daily/summary/page.tsx:903-927`, `min-h-9`), knowledge-map filters
(`KnowledgePeaksView.tsx:461,1034,1062`, `KnowledgeNodeCard.tsx:267`), `InviteCategoryChips`.
They share `rounded-full border px-3 py-1(.5) text-sm|text-xs` and hand-roll a selected state.
Neither `Chip` (a `span`) nor any button type in §3 covers them. Proposed: a `selectable`
variant on `Chip` rendered as a `<button type="button" aria-pressed>` — `md` geometry,
`min-h-9` visual with a 44px hit area via padding, selected state carried by ink fill
(`bg-foreground text-background`) **and** `aria-pressed`, never by hue alone. Until ratified,
the R4 count includes them; new filter pills should copy `daily/summary/page.tsx:910`.

## 5. Cards and containers

### 5.1 The card recipe — RATIFIED (Phase 2 ruling 1; `globals.css:484-486`; `FeedCardShell.tsx`)

```
rounded-[var(--radius-card)] border bg-card text-card-foreground shadow-[var(--shadow-card)]
```

That is `.card`. `FeedCardShell` is the same recipe with a configurable 2px category accent
bar and an `elevated` variant on `--shadow-card-strong` over `--feed-card-elevated`. Section
cards on friends/profile/settings were migrated onto it by commit `5b873477`. Border colour is
`--brand-border` (hairline) resting, `--brand-rule` for dividers.

- **Chromes that survive:** exactly one. The "four coexisting chromes" of the June audit
  (feed 4px / `.card` 10px / section 16px / 24px) are collapsed; `D-CONSISTENCY-AUDIT-DISPOSITION-01`
  items #2/#4 ("card unification is NOT-APPLICABLE, deferred") are **superseded for
  geometry** by ruling 1. Card *tiers* (which cards are louder, and by what colour) remain
  deferred to the palette pass.
- **Section cards** are cards. A settings group, a friends block, an invite panel all take
  the recipe. The old `rounded-2xl + shadow-sm` section chrome is gone.
- **A sheet is not a card** (§1.3). **A full-bleed editorial band is not a card**
  (`--editorial-*` washes, `--interlude-*` grounds, ceremony rooms) — no border, no radius,
  no shadow.

### 5.2 Category accent bar — canon-watch, carried from the June audit §2

`FeedCardShell.tsx:70-78` renders a 2px hue bar whose only variable is category colour. Where
no category text accompanies it, that is a colour-alone signal. Out of scope here (colour), but
any new card that shows the bar must also show the category as text.

### 5.3 Exemptions — RATIFIED (disposition doc §"Canon guardrails"; NEXT-STEPS items 1–2)

Bespoke primitives that are *not* cards and are not to be swept: `LoadingScreen` (triangle
loader), `OverlapMap` (letterpress, radius 0 by agreed scope), `ShareCard` and
`SharePortraitCard` (share surfaces; the latter is a raster), ceremony rooms, `TerritorySetup`.

---

## 6. Lists and rows

### 6.1 The list rule — RATIFIED (Phase 4, 2026-09-11)

A list of like items is a `divide-y divide-border` (or `border-[var(--brand-rule)]`) stack of
rows with **no per-row chrome** — the rule separates them. Rows are `py-3`/`py-4`, `gap-3`,
and if tappable use §3.6. This is what the authored tab of `/questions` already does
(`MyQuestionCard.tsx:40` inside `questions/page.tsx:451-464`).

### 6.2 The `/questions` two-layout problem (Q-1) — RATIFIED (Phase 4, 2026-09-11)

`AnsweredQuestionsList.tsx:68,83` renders a 5-column `sm:grid` table; the authored tab renders
`divide-y` rows. Ratified (Phase 4): **the answered tab adopts the row layout** (one row primitive, both
tabs), and the grid header goes. Grid tables are admin-only chrome (`/admin/*`), never a
player surface. Correctness stays paired with strikethrough/italic (audit Q-2, already
compliant).

---

## 7. Loading and skeletons

### 7.1 Skeleton — RATIFIED (Phase 4, 2026-09-11; `src/components/ui/Skeleton.tsx`; commit `edf6dda6`)

`<Skeleton className="h-… w-…" />` is the one loading placeholder: `.skeleton` shimmer
(`globals.css:627-638`, muted base + light sweep from existing surface tokens, no colour
meaning, honours `prefers-reduced-motion`), default radius `--radius-card` so a block matches
the card it stands in for, `aria-hidden` with an sr-only status from the caller. Adopted on
for-you, from-friends, activities, home, knowledge. **`animate-pulse` outside `Skeleton` is
drift**: `/questions` (`questions/page.tsx:128-132,566`), `CreationSurface.tsx:233`, and the
admin loaders are codemod work.

Grep: `rg -n 'animate-pulse' src --glob '*.tsx' | rg -v 'ui/Skeleton|KnowledgeBubbleMap'`

### 7.2 Exemptions

`LoadingScreen` (the branded full-screen triangle loader and its `LoadingMoment` card) is a
bespoke primitive, not a skeleton; inline `Loader2 animate-spin` for in-button waits is fine.
Toasts sit **below** takeovers on the z-scale (`--z-toast` 70 < `--z-takeover` 80) — a toast
fired while `LoadingScreen` is `fullScreen` is painted behind it; gate the toast on the loading
state (CLAUDE.md, `check:zindex`).

---

## 8. Type — RATIFIED (`_docs/STYLE-GUIDE-TYPE.md`; `DECISIONS.md` Playfair entry; `globals.css:9-13,57,366,373`)

Not re-derived here. The rule set is the four voices on two faces:

| Voice | Face | Token | Treatment |
|---|---|---|---|
| Editorial | Cormorant Garamond | `--font-serif` | the content; sentence case; italic only as inline emphasis |
| System | Josefin Sans | `--font-mono` (resolves to the sans on purpose) | UPPERCASE + tracking, small, quiet; labels, stamps, counts |
| Interface | Josefin Sans | `--font-sans` | sentence case; everything with a tap target |
| Brand | Montserrat | `--font-wordmark` | the "Joshing" wordmark only |

Sizes: Tailwind scale plus **`text-quiet` (13px)**, the ratified secondary Interface size
(114 sites, zero `text-[13px]` remain). 9/10/11/15px stay arbitrary until a surface earns
them a name (§4.2 proposes the one 10px exception, inside `Badge`). The type-size ratchet
(`check:typesize`) counts raw `text-[Npx]`; the font ratchet (`check:fonts`) holds off-system
font-family declarations at zero. Two stale sentences still say "Montserrat" for the System
voice (`STYLE-GUIDE-TYPE.md:51`, `globals.css:361`); the header of the same guide is right.

---

## 9. Touch targets and focus

### 9.1 The 44px floor — RATIFIED (Phase 4, 2026-09-11) as a hard rule (grounded in `design-sweep-NEXT-STEPS` item 5, every `.btn-*` recipe, `FeedActionLink`)

Every tappable element has a **minimum 44×44px hit area**: `min-h-11` on buttons, rows and
inline actions; `size-11` on icon buttons; `min-h-11` on inputs. Visual size may be smaller
(a 20px glyph, a 13px link) inside a 44px box. The one exemption is §3.9. On `main`, 52 of the
369 non-`.btn-*` buttons declare a ≥44px dimension; the rest are the codemod's largest bucket.

### 9.2 The focus ring — RATIFIED (Phase 4, 2026-09-11) as universal (recipe RATIFIED for `.btn-*`, `globals.css:497-509`)

`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2` (`--ring` = navy) on **every** interactive element, not just the
recipes. The old `ring-3 ring-ring/50` idiom has zero uses and is withdrawn. Never remove the
ring without replacing it with an equally visible focus state; `LoginPanel.tsx:29` ships
without one and gains it when it folds into `.btn-primary` (§12).

Grep (button with no focus state): `rg -n '<button\b' -A6 src --glob '*.tsx' | rg -v 'focus-visible|btn-' | rg 'className'` — heuristic; 318 hits on `main`.

---

## 10. Colour — out of scope (Fork D1)

This document sets **no colour rule**. Colour authority is `_docs/STYLE-GUIDE-COLOR.md` (the
five jobs, grading reserved, gold once per view, category = top-level domain) and the token
block of `globals.css`. Two facts the reader needs: the de-collided palette **is** the live
default (`DECISIONS.md`, built 2026-06-13; `--game-wrong-strong #c1121f`, `--cat-literature
#7d2c3f`), and the remaining colour fix-list (one cream, one category scale for all five
systems, one gold, the triangle decision) is still open. Where a structural rule above touches a
fill (chip surface, skeleton fill, badge colour, accent bar), it says so and defers.

---

## 11. Exemptions register (consolidated)

| Surface | Exempt from | Source |
|---|---|---|
| `LoadingScreen` | cards, skeletons, radius | disposition #2; NEXT-STEPS |
| `OverlapMap`, `KnowledgeOverviewClient` | soft elevation (use stamp) | disposition register table |
| `ShareCard` | soft elevation (stamp; §2.3 proposes token) | NEXT-STEPS item 2 |
| `SharePortraitCard` | all tokens (html2canvas raster) | STYLE-GUIDE-TYPE §6; NEXT-STEPS |
| `GameplayChat` glow, ceremony gem | elevation registers | disposition |
| `TerritorySetupClient`, `PortraitCircles` "raised" | elevation registers, pending `--shadow-raised` | disposition §Deferred |
| Ceremony rooms, `--interlude-*`, `--editorial-*` bands | card recipe | §5.1 |
| `Nav.tsx` bottom tabs | §3.5 tab recipe | §3.5 |
| `/admin/*` | list rule (grid tables allowed), token lint scope | §6.2 |
| `data-flat` / `data-shadow` CSS, `PaletteToggle` | everything (testing chrome, unmounted) | `globals.css:720-762` |
| Scrim-tap button | 44px floor | §3.9 |

---

## 12. Pending edits this job may not make (for the next build)

`globals.css` and components are untouched by `B-FABLE-DESIGN-CANON-01`. The rulings imply:

| Edit | Where | Ruling |
|---|---|---|
| `.btn-primary` `min-h-12` → `min-h-11`; header comment "48px-tall" → "44px"; "brand-link fill" → "navy fill" | `globals.css:490-497` | 3.1, B-3 |
| Strip the 8 `min-h-11` overrides once the recipe changes | `invite/[token]`, `sms-consent`, `InviteLinksSection`, `Accept*Button`, dev page | 3.1 |
| `InviteLinksSection.tsx:501` → `.btn-danger` | component | 3.3 |
| `LoginPanel.tsx:29` `SUBMIT_CLASS` → `btn-primary w-full` (identical look at 44px; gains the focus ring) | component | ruling 3 |
| `OnboardingFlow.tsx:881` pill → `btn-primary`; `:880` input → `--radius-xs` | component | 1.4 |
| Stale comment "content cards use rounded-md" | `globals.css:185-186` | 1.2 |
| Duplicate `--radius-xs…lg` literal block | `globals.css:374-377` | 1.1 |
| Unused shadcn leftovers `--chart-1…5`, `--sidebar-*` (0 consumers) | `globals.css:212-225`, `.dark` | housekeeping, RATIFIED (Phase 4) |
| Four leftover `rounded-2xl` rows/tiles → `--radius-card` | §1.2 list | 1.2 |
| `FeedCardShell.tsx:16` `--radius-xs` → `--radius-card` (same value, canonical name) | component | 1.2 |
| Chip: drop `sm`; add `Badge`; migrate Nav/FeedList badges and `MyQuestionCard` label | `ui/` | 4.1–4.2 |
| `/questions` skeleton, `CreationSurface` → `<Skeleton>` | components | 7.1 |
| Sheet shadows → `--shadow-overlay`; FAB → `--shadow-card-strong`; menus `rounded-3xl` → `2xl` | components | 1.3, 2.2, 3.8 |

---

## 13. Enforcement map (built in Phase 5, 2026-09-11)

Two vehicles, both report-only for existing code and blocking for regressions:

- **`eslint.config.mjs` → `DESIGN_LINT_RULES`** — `no-restricted-syntax` selectors at `warn`
  over `src/**/*.tsx` (tests, `src/app/dev/`, `src/app/feed/debug/` excluded). They match
  string-literal `className`s only; template strings and `cn()` calls are covered by the script.
  `npm run lint` pins `--max-warnings` at the combined baseline of the colour lane and this lane;
  the number only goes down.
- **`scripts/audit-design-conformance.mjs`** (`npm run check:design`) — per-rule violation
  counts with a recorded baseline per rule; `--check` (the npm script) fails if any rule rises
  above its baseline, `--verbose` lists every offender. Lower a baseline after a cleanup; never
  raise one.

Existing CI ratchets (`npm run check:*`): fonts 0 · colours 41 · spacing · radius 0 · z-index 0
· type-size 213. Existing lint: `no-restricted-syntax` on palette colours / `bg-white` /
`[#hex]` in `className` under `src/components/**`, 12 grandfathered files at `warn`,
`--max-warnings 16`. **Do not add to the grandfather list.**

| Rule | Check | Vehicle |
|---|---|---|
| Rule | Script id · baseline (2026-09-11) | Lint selector |
|---|---|---|
| 1.2 card radius | R3 · 41 | — |
| 1.4 no pill buttons/inputs | R8 · 34 | yes |
| 2.1 no Tailwind shadow utilities | R1 · 35 | yes |
| 3 no `.btn-*` overrides | R2 · 15 (11 are `min-h-11`, moot once §3.1's recipe edit lands) | yes |
| 3.4 hand-rolled icon buttons | R6 · 23 | yes |
| 4.1 Chip geometry overrides / hand-rolled chips | R5 · 1 / R4 · 31 (≈12 are §4.3 selectable pills) | yes / — |
| 7.1 `animate-pulse` outside Skeleton | R7 · 11 | yes |
| 9.1 / 9.2 touch floor and focus ring | R10 · 321 / R9 · 333 (heuristic, count only) | — |

Lint lane baseline: **98** `canon/restricted-syntax` warnings (29 shadow · 28 pill · 15
btn-override · 11 icon · 11 animate-pulse · 4 Chip); `--max-warnings 103` = 5 pre-existing
(4 colour-lane + 1 unused-var; the old ceiling of 16 had slack) + 98.

---

## 14. Carried inventory (verified 2026-09-11)

### 14.1 Custom domain icons — `src/components/icons/domain-icons.tsx`

All share `viewBox="0 0 24 24"`, `fill: none`, `stroke-width: 1.8`, round caps and joins,
stroke parameterised via `color` (defaults `currentColor`). Exports on `main`:
`ClassicalMusicIcon`, `FilmTvIcon`, `HistoryCampaignsIcon`, `HistoryGeneralIcon`,
`LanguageIcon`, `LiteratureNovelIcon`, `LiteraturePoetryIcon`, `OperaIcon`, `PhilosophyIcon`,
`PopCultureIcon`, `ScienceIcon`, `SportIcon`, and `DomainInitialIcon` (letter-in-circle
fallback). UI icons are lucide (`components.json`), default `size-4` (16px) in text, `size-5`
(20px) in icon buttons.

### 14.2 Breakpoints

Tailwind defaults, mobile-first: `sm` 640 · `md` 768 (the common one) · `lg` 1024 · `xl` 1280.

### 14.3 Z-scale — RATIFIED (`globals.css:408-421`; CLAUDE.md)

`--z-nav` 40 < `--z-sheet` 50 < `--z-modal` 60 < `--z-toast` 70 < `--z-takeover` 80. Raw
`z-[N]` is held at zero by `check:zindex`.

### 14.4 Dropped from the old inventory

§1.5 chart scale and §1.6 sidebar tokens (shadcn leftovers, 0 consumers — §12 proposes
removal); §1.1/§1.2 semantic-token hex tables (all repointed to brand tokens, read
`globals.css:194-211`); §2.1 font table (superseded by §8); §6.1–6.2 `<Button>` matrix
(component deleted); §6.3–6.4 card and button recipes (wrong on every value; see §3, §5).

---

*Read alongside: `_docs/DESIGN-CANON-CONFLICTS.md` (why each rule says what it says),
`_docs/STYLE-GUIDE-TYPE.md`, `_docs/STYLE-GUIDE-COLOR.md`, `D-CONSISTENCY-AUDIT-DISPOSITION-01.md`,
`D-DESIGN-DEBT-STRUCTURAL-AUDIT-01-FINDINGS.md` (stale on cards/chips/skeletons — the register
says where).*
