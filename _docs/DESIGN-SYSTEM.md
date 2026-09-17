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
  **Closed 2026-09-13.** The Phase 2 migration (`5b873477`) had covered only the
  friends/profile/invite section cards; the conformance script (R3) then found ~40 more — the
  daily summary and catch-up panels, `ExpandDomainOfferCard`, `FirstSessionPanel`,
  `knowledge/[domain]`, every settings form section (`NotificationsForm`, `PrivacyForm`,
  `AccountActions`, the LLM readouts), `BlockedList` rows, the
  `InlineEditableField`/`InlineHandleField` card variants, `SendQuestionDrawer`, `DomainList`,
  `AskFriendForDomain`, `unsubscribe`, `verify-email`. All 38 moved onto `--radius-card`;
  **R3 is enforced at 0.**
- **One value, one name.** Twelve cards spelled the same 4px as `--radius-xs` (including
  `FeedCardShell`, `TodaysFiveCard`, `MissedQuestionsCard`, the welcome-tour cards); they were
  renamed to `--radius-card` on 2026-09-13, so every remaining `--radius-xs` site is a control
  (three inputs, five buttons) and the card rule is greppable by its own token.
- **Not cards, and not R3's business:** a bottom sheet that paints `bg-card` keeps its 18px
  corner (§1.3) — `rounded-t-*` is excluded from the rule for that reason. Inputs take
  `--radius-xs` (§1.5); `NotificationsForm`'s SMS-code field was also below the touch floor at
  `h-10` and moved to `min-h-11` in the same pass.

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
- **RATIFIED (Phase 4):** inputs are never pills either. **Landed 2026-09-13:** `AddTopicField`'s
  shared `DEFAULT_INPUT_CLASS` moved to `--radius-xs` — which reaches all five consumers — and
  onboarding's two overrides went with it: its pill input took the same radius, and its navy
  pill "Add" button became `.btn-ghost`, since Continue is that screen's primary and Add is
  secondary (§3.1, one per view).
- **R8 closed at 0, 2026-09-14.** The remaining 21 hand-rolled pills: 3 inputs onto
  `--radius-xs`; 4 undersized `aria-label="Close"`/breadcrumb-nav icon buttons (size-7/8, below
  R6's size-9 sweep) onto `.btn-icon rounded-full`; 4 secondary action pills (`BubblePageChrome`'s
  Add/Tidy/Share, `KnowledgeBubbleMap`'s List/Bubble toggle) onto `<Chip>`; 4 segmented-toggle
  sites (`AskFriendForDomain`, `DomainVisibilityToggle`, `SectionVisibilityToggle`) onto
  `--radius-xs` on *both* the pill container and its buttons — a nested segment can't round
  less than its container without a visible gap. **7 stay exempt** (`RULE_EXEMPT`, not fixed):
  `ReminderInterstitial`'s three CTAs take `roomTheme()` colour, the same bespoke takeover
  system R6 already exempts (ceremony rooms); three inline chip-dismiss "×" glyphs (size-5/6 —
  `OnboardingFlow`, `InviteLinksSection`, `QuestionForm`) are genuine circular icon hit-areas,
  just smaller than `.btn-icon`'s fixed 44px; `KnowledgeBubbleMap`'s "zoom out one level" sits
  inline in a `min-h-6` breadcrumb row that `.btn-icon` would overwhelm.

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

Grep (Tailwind shadow utility in a component): `rg -n '(?<![\w-])shadow-(sm|md|lg|xl|2xl)\b' src --glob '*.tsx'`
— 35 at the Phase 5 build, **6 after 2026-09-13**, and all six are chips (see §2.2a). The
lookbehind matters: `drop-shadow-*` is a filter, not an elevation register, and is not drift.

### 2.2 Sheets, drawers, popovers and the FAB sit on `--shadow-overlay` — RATIFIED (Phase 4, 2026-09-11)

The disposition doc assigned `--shadow-overlay` to the two centered modals only; 30 sites now
use it, including bottom sheets. Ratified: **one overlay register** for every floating surface
(sheet, drawer, anchored menu, toast). **Landed 2026-09-13**: ten toasts and floating pills,
four anchored menus (the responsive `sm:shadow-xl` step dropped with them — one register means
one value at every width), three sheets, and the three knowledge cards that float over the
bubble map all read `--shadow-overlay`. The four `sms-consent` screenshot figures are resting
cards and took `--shadow-card`, as did `PeopleYouInvited`'s hover lift.
**Exception, by Phase 4 amendment:** the FAB (`Nav.tsx`) took **`--shadow-card-strong`**, not
overlay — a 12px/28px blur under a 56px circle reads as a stain.

### 2.2a Chips and pills carry no elevation — RATIFIED (Josh, 2026-09-13)

The shadow sweep left exactly six `shadow-sm` sites and every one is a chip or pill:
`KnowledgeBubbleMap.tsx:318`, `KnowledgePeaksView.tsx:1034,1062` (a `hover:shadow-sm` lift), and
three on `TerritorySetupClient` (`:738` label chip, `:980,:998` the size-14 territory circles).
§2.1 named this gap — "chips/pills currently have no elevation rule" — and never filled it.

**A chip is a label, not a surface. It sits on the page and casts nothing.** The `Chip`
primitive already shipped with no shadow, so this ratifies what the primitive does and holds
the hand-rolled ones to it. Applied the same day: the territory label chip and its two
selector circles, the bubble-map filter pill, and the two peaks-view filter pills all dropped
`shadow-sm` / `hover:shadow-sm`. **R1 closed at 0.** `TerritorySetupClient`'s deferred "raised"
register (§11) is a separate question about its drag surface, untouched here.

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

- **Landed 2026-09-13.** `globals.css` now reads `min-h-11`; the header comment is corrected;
  all fifteen call-site overrides are stripped (eleven redundant heights, the red
  `.btn-primary` that became `.btn-danger`, and login's parallel definition, which now reads
  `btn-primary w-full`). Conformance rule **R2 is closed at 0** — a new override is a
  regression, not a backlog item.
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
that may be red.** (`InviteLinksSection.tsx:501`, a `.btn-primary` repainted
`bg-[var(--destructive)]`, was corrected to `.btn-danger` on 2026-09-13.) Always paired
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

`Nav.tsx`: `size-14 rounded-full bg-primary text-primary-foreground grid place-items-center`,
fixed at `bottom-24`. **One FAB in the app** (the composer). Its shadow moves from `shadow-lg`
to `var(--shadow-card-strong)` (§2.2, Phase 4 amendment); its z-index is `--z-nav` (it is
chrome). Never a second FAB, never a FAB inside a sheet.

**Amended 2026-09-11 (horizontal anchor).** The spec previously read `fixed right-5`, pinning
the FAB to the right edge of the *window*. That was written while the FAB was mobile-only
(`md:hidden`), where window edge and column edge coincide; the dedicated add-a-question FAB
shows on every viewport, and on desktop `right-5` stranded it far outside the `max-w-2xl`
column it acts on. The FAB is now right-aligned inside that same column (a
`pointer-events-none` fixed strip wrapping a `max-w-2xl px-5` row), which resolves to exactly
`right-5` below the column's width — the ratified mobile rendering is unchanged. **Rule: app
chrome aligns to the content column, not the viewport.**

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
- **RATIFIED (Phase 4):** callers may **not re-pad or re-size** a Chip. Colour overrides
  remain allowed until the palette pass. `PeopleYouInvited.tsx:299`'s `className="px-3"`
  was the one live offender — dropped 2026-09-14, **R5 closed at 0**.

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

### 4.3 Interactive chip (filter / toggle / pick pill) — RATIFIED (Josh, 2026-09-13; landed 2026-09-14)

Roughly a dozen pills were **buttons**, not labels — interest pickers (`OnboardingFlow.tsx`),
the daily-summary reaction row (`daily/summary/page.tsx`), knowledge-map filters and sibling
pickers (`KnowledgePeaksView.tsx`, `KnowledgeNodeCard.tsx`, `KnowledgeBubbleMap.tsx`),
`InviteCategoryChips`, `InviteLinksSection`'s suggested-topic and category chips,
`AddTopicField`'s candidate/convergence chips, one-shot actions styled as chips (archive's
filter-clear, TerritorySetupClient's toast Undo, HiddenQuestions' restore, InvitedClient's
broader-domain pick) and one chip-shaped nav tag (`MutualFriendsSection`'s friend-name pill).
`Chip` (a `span`) covered none of them. **Landed:** `href`/`onClick` on `Chip` render a
`<Link>`/`<button type="button">` instead of a `span` — `md` geometry, the real §9.1 44px
floor (`min-h-11`, not a padded hit box), the §9.2 focus ring. `selected` is for a genuine
toggle (a filter, a friend picker) — it drives `aria-pressed` **and** the ink-fill selected
state (`bg-foreground text-background`), never hue alone; a one-shot pick/nav chip (a
suggestion, "+ topic", "restore") omits it. Two components that render their own `<button>`
and can't wrap in `<Chip>` (`AddToBankAction`, `SendQuestionAction`) take the exported
`chipButtonClassName` helper instead of hand-copying the recipe — the geometry stays defined
in exactly one place. **R4 closed at 0** (all 31); **R5 closed at 0** (the one Chip override).

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

**Landed 2026-09-13.** `/questions` (both loaders), `CreationSurface`'s drafting cards and the
admin rerun bars now render `<Skeleton>`; R7 is closed at 0. `CreationSurface` keeps its card
shell — border, padding, the card radius — so the wait holds the real layout, and only the bars
inside shimmer. The shell itself no longer pulses: nesting a pulse inside a shimmer double-
animates the same wait.

**A pulsing text label is not a skeleton.** "Loading questions…", "Asking Wikidata and the
LLM…", a rotating status phrase — that is real text breathing while it waits, with nothing for
`<Skeleton>` to stand in for. §7.1 governs *placeholder blocks*, the empty boxes that stand in
for content. The rule separates the two on `text-` and no longer reports the four text pulses.

Grep: `rg -n 'animate-pulse' src --glob '*.tsx' | rg -v 'ui/Skeleton|KnowledgeBubbleMap|text-'`

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

**Scope — RATIFIED (Josh, 2026-09-15): this is a PLAYER-surface rule.** The floor exists for
thumbs on phones. The admin console (`src/app/admin/**`) and the dev palette toggle
(`src/components/dev/**`) are desktop, mouse-driven, single-operator tools whose dense data
tables would get *worse* if every row action were padded to 44px. They are `RULE_EXEMPT` from
R10 by directory prefix, so a new admin screen is covered without editing the list. This
scoping took R10 from 295 to **190** on 2026-09-15 without changing a single component.

**R10 is a trend line, not a rule to close at 0.** Unlike R1–R9, the heuristic cannot tell a
genuine miss from a control that is compact by design, and it reads only the 7 lines after the
tag (so a size class living in a shared constant reads as absent — 14 such false positives were
confirmed by hand). Treat a *rise* as the regression signal; do not pad components to drive it
to zero. Where the 295 went:

| bucket | count | disposition |
|---|---|---|
| Admin / dev tooling | 105 | **exempt 2026-09-15** — scoping, above |
| Inline text actions missing §3.7's `min-h-11` | 43 | **fixed 2026-09-16** — `inline-flex min-h-11 items-center`; type size unchanged, only the hit box grew |
| List-rows / tabs missing §3.5 / §3.6's `min-h-11` | 11 | **fixed 2026-09-16** — both sections already mandated it |
| Heuristic false positives (class in a shared const) | 14 | left alone — the component is already compliant |
| Controls declaring an explicit 32–40px height | 26 | **fixed 2026-09-16** — raised to `min-h-11` / `size-11` |
| Transparent controls whose height came from padding | 20 | **fixed 2026-09-16** — box grows, visual unchanged |
| Bordered / filled buttons that had to get fatter | 17 | **fixed 2026-09-16** — the "chunky" ruling, below |
| Read and deliberately left | 79 | see the disposition below |

**"Chunky" — RATIFIED (Josh, 2026-09-16).** The last open question on R10 was what to do with a
button whose box *is* its visual. A transparent control — a text action, an icon-only glyph, a
tab, a menu row — can grow to 44px with nothing on screen changing. A bordered or filled button
cannot: `min-h-11` on a `border px-3 py-1 text-xs` tertiary button makes it visibly fatter.
**The ruling is that it gets fatter.** The thumb wins over the silhouette.

The recipe is `.btn-ghost`'s geometry — `inline-flex min-h-11 items-center justify-center` with
`px-4` — applied at the call site while the site keeps its own radius and colour. It is not a
fold onto `.btn-ghost` itself, because that would also swap the radius (`rounded-md` → 4px) and
paint `bg-background` on controls that are currently transparent over a card. Those are
separate changes and were not made here. `px-3` → `px-4` goes with the height: a 44px-tall box
with 12px side padding reads as a stubby tall pill, and every `.btn-*` recipe pairs `min-h-11`
with `px-4`.

**Two controls could not take the floor by min-height — both now clear it another way
(2026-09-16).** They are the two idioms worth copying when `min-h-11` is not available:

- **The underline belongs to the label, not the button.** `InlineAnswerFlow`'s "ANSWER →" drew
  its rule as a `border-bottom` on the `<button>`, so a 44px box dropped the rule 27px below
  the text. The border moved to an inner `<span>`; the button is now a 44px flex box and the
  underline still sits against the words.
- **A mid-sentence link grows its hit area with `::after`, never with height.**
  `EditorialPromos`' "Undo" sits inside flowing prose, where `min-h-11` would stretch the whole
  line box. Instead: `relative after:absolute after:inset-x-0 after:top-1/2 after:h-11
  after:-translate-y-1/2 after:content-['']` — a 44px invisible target centred on the text and
  outside layout, so the paragraph is untouched. **Use this for any inline link inside prose.**

**Where the remaining 74 are.** 38 the heuristic cannot see (the class lives in a shared
constant or outside its 7-line window — confirmed by hand); 11 whose size is owned by a
caller's `className` prop, so there is nothing to fix in the component; ~14 already over the
floor via padding or inline style the heuristic cannot add up; and the ratified small controls
— chip-dismiss `×` glyphs (§1.4), the `Switch` track (a switch is not a button box), and the
`KnowledgeBubbleMap` breadcrumb (already R8-exempt for the same reason).

**The Joshing Games components are exempt, NOT deleted (2026-09-16).** `FirstGamePanel`,
`game-details-mode-sections` and `interpretive-sections` render to no player — `/games/[id]`
redirects home — so they are not player surface and are `RULE_EXEMPT` from R10 (4 sites). They
are kept because a static import scan calls them dead and the decision record does not: B-10.1
was a **soft** sunset that deliberately preserved the API routes and tables so a revival is a
git restore, and `D-AREA-EXPANSION-01` (SETTLED, ready for `B-AREA-EXPANSION-01`) names
`CompletedRecapHeader` in `game-details-mode-sections.tsx` as built infrastructure it plans to
reuse. If Games is ever hard-sunset, delete the files and the exemption together.
`games/QuestionRatingButtons.tsx` is **not** exempt — `/archive` renders it, so it is live
player surface and stays in the count.

**Landed 2026-09-16 (295 → 74).** The inline-text-action pass is the one worth understanding:
§3.7's own recipe (`FeedActionLink`) *starts* with `inline-flex min-h-11 items-center`, so a
14px link keeps its type size and simply sits in a 44px-tall invisible box — which is what §9.1
means by "visual size may be smaller … inside a 44px box". Three `block`-display links
(`knowledge/[domain]`, `DomainList`, `QuestionForm`'s reformulation option) took `min-h-11`
without a display swap: they wrap already-tall content, so the min-height is inert there and
only guards the empty case. `LoginPanel`'s shared `SUBTLE_LINK_CLASS` moved `block` → `flex
w-fit` so `mx-auto` still centres it while the label centres inside the taller box.

The second pass (142 → 116) raised the 26 controls that already *declared* a height of 32–40px
(or a 34px square icon button): those state an intended tap target and land a few pixels short,
so the raise is mechanical, not a design change. It was applied by matching each site's exact
resolved class string rather than scanning the lines after `<button` — a window scan mis-hit
`<h3>`/`<p>` elements twice during this work. Note that four of the 26 live in a shared class
constant, so one edit moved a whole family of buttons.

The third pass (116 → 96) came from re-reading the sites that had been parked as "no declared
height". Twenty of them had a perfectly readable height once you added up padding and
line-height, and were transparent — so they were the *same* fix as the first pass, just hidden
from a class-string rule. That is the general lesson here: the heuristic reads classes, but the
question §9.1 actually asks is about rendered pixels, so a parked site is worth re-reading with
the computed box in hand rather than trusting the first triage.

Grep (a button with no declared 44px dimension): `npm run check:design -- --rule=R10 --verbose`

### 9.2 The focus ring — RATIFIED (Phase 4, 2026-09-11) as universal (recipe RATIFIED for `.btn-*`, `globals.css:497-509`)

**The app has one focus indicator and every element inherits it.** `globals.css`'s base layer
gives `:focus-visible` a `2px solid var(--ring)` outline at a `2px` offset — the same weight and
colour the `.btn-*` recipes draw as a ring. A component needs its own focus styles **only when
it wants something different**.

**The one real defect is killing it.** `outline-none` with nothing put back leaves an element
with no focus indicator at all. Where a component does want its own treatment, the correct
idiom is kill *and* replace on the same element:
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
— which is what all 77 ring sites already do. The old `ring-3 ring-ring/50` idiom has zero uses
and is withdrawn.

**Corrected 2026-09-13 — the old reading of this rule was wrong.** It said "every interactive
element must carry the ring classes", and the conformance rule counted 333 buttons that didn't.
That measured nothing: `globals.css`'s `*` rule set only outline *colour*, and with no
outline-style of its own the browser went on drawing **its** default focus ring, merely tinted.
Focus was never missing app-wide — it was just never ours, and it varied by engine. Meanwhile
the actual gap was the opposite and far smaller: **43 elements, almost all form fields, killed
the outline and substituted a 1px border tint**, which is not an equally visible state. The base
rule now supplies the ring, those 43 dropped their `outline-none`, and **R9 counts focus-killers
and is closed at 0**.

Outline rather than a ring, deliberately: `ring-*` compiles to `box-shadow`, which collides with
the elevation tokens on any element that also casts a shadow.

Grep (focus killed with no replacement): `rg -n 'outline-none' src --glob '*.tsx' | rg -v 'ring-'`

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
| Ceremony rooms — **and their chrome** (the Exit control takes its colour from the beat's theme and hovers on `white/10`; the neutral `.btn-icon` ink would be invisible on a saturated ground) | button recipes | §3.4, added 2026-09-13 |
| `Nav.tsx` bottom tabs | §3.5 tab recipe | §3.5 |
| `/admin/*` | list rule (grid tables allowed), token lint scope | §6.2 |
| `/admin/**`, `components/dev/**` | 44px floor (R10) — desktop, mouse, one operator | §9.1, added 2026-09-15 |
| `data-flat` / `data-shadow` CSS, `PaletteToggle` | everything (testing chrome, unmounted) | `globals.css:720-762` |
| Scrim-tap button | 44px floor | §3.9 |

---

## 12. Pending edits this job may not make (for the next build)

`globals.css` and components are untouched by `B-FABLE-DESIGN-CANON-01`. The rulings imply:

**Done 2026-09-13 — buttons (R2 closed at 0):** the `.btn-primary` recipe is `min-h-11` with
its comment corrected; all fifteen call-site overrides stripped;
`InviteLinksSection.tsx:501` → `.btn-danger`; `LoginPanel.tsx` `SUBMIT_CLASS` →
`btn-primary w-full`.

**Done 2026-09-13 — cards (R3 closed at 0):** 38 containers onto `--radius-card`, 12 cards
renamed off `--radius-xs`, the SMS-code input onto `--radius-xs` + `min-h-11`, and the stale
"content cards use `rounded-md`" convention comment in `globals.css` corrected.

**Done 2026-09-14 — chips (R4 closed at 0, R5 closed at 0):** `Chip` grew the §4.3
interactive form (`href`/`onClick`/`selected`) plus an exported `chipButtonClassName`
helper for the two components that render their own `<button>`; all 31 hand-rolled
pills — labels and interactive alike — moved onto it, and `PeopleYouInvited`'s padding
override was dropped.

| Edit | Where | Ruling |
|---|---|---|
| Duplicate `--radius-xs…lg` literal block | `globals.css:374-377` | 1.1 |
| Unused shadcn leftovers `--chart-1…5`, `--sidebar-*` (0 consumers) | `globals.css:212-225`, `.dark` | housekeeping, RATIFIED (Phase 4) |
| Chip: drop `sm`; add `Badge`; migrate Nav/FeedList badges and `MyQuestionCard` label | `ui/` | 4.1–4.2 |
| `/questions` skeleton, `CreationSurface` → `<Skeleton>` | components | 7.1 |
| Anchored menus `rounded-3xl` → `rounded-2xl` (`FeedActions`, `AnsweredRowActions`, `daily/summary`) — their *shadows* landed 2026-09-13, the radius did not | components | 1.3 |
| Ratify §2.2a (chips carry no elevation), then strip the last 6 `shadow-sm` | components | 2.2a |
| `HiddenQuestions.tsx:69` (row) and `users/[id]/page.tsx:582` (avatar tile) — the two `rounded-2xl` sites R3 never flagged because neither paints a card fill; decide row-vs-avatar per §3.6 / §1.4 | components | 1.2, 1.4 |

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

Existing CI ratchets (`npm run check:*`): fonts 0 · colours 41 · spacing 0 · radius 0 · z-index 0
· type-size 207. Existing lint: `no-restricted-syntax` on palette colours / `bg-white` /
`[#hex]` in `className` under **`src/**`** (widened from `src/components/**` on 2026-09-17 —
see below), 13 grandfathered files at `warn`, `--max-warnings 23`. **Do not add to the
grandfather list** except when the rule's own scope widens, which is the only reason it grew.

**The folder boundary was a hole (closed 2026-09-17).** The colour rule only ever read
`src/components/**`, so anything under `src/app/**` — every page and route segment — could
paint raw Tailwind palette colours and nothing complained. That is how `knowledge/[domain]`
came to render grading as `text-green-700` against `text-destructive`, breaking
`STYLE-GUIDE-COLOR` §1's "exactly one correct and one wrong value" for months. Scope is now
`src/**`, sharing the design-canon lane's exemption list (tests, `app/dev/`, `feed/debug/`,
the ceremony rooms) — before this, those four were exempt from every design lane *except* this
one, purely because this one never reached them.

Widening it surfaced **30** pre-existing violations in three clusters. Two were cleaned the same
day — `LoginPanel` (the most-seen screen in the app) and `share/ceremony/[token]` — leaving one
parked and named in `eslint.config.mjs`: `TerritorySetupClient` (4 — scrims on the drag surface
whose "raised" register is separately deferred).

### There is no dark mode — RATIFIED (Josh, 2026-09-17)

**Joshing has one ground and it is cream.** This was the answer to "the share page needs a
dark-surface token set": it does not, because there is no dark surface to build a set for.

`share/ceremony/[token]` was never a dark *theme*. It was an unconverted `bg-stone-950` default
wrapped around a **light** card — `<ShareCard>` paints a `PAPER → CREAM` gradient on warm ink —
so the page was fighting the one thing it exists to show, on the one surface a stranger sees.
Both pages moved onto `--brand-cream-page` / `--brand-ink`, and their hand-rolled
`h-12 rounded-md bg-stone-100` CTA became `.btn-primary`, which also brings it to the §9.1 floor.

**The dead scaffold came out with it.** `globals.css` carried a 40-line `.dark { … }` block and
an `@custom-variant dark`. Nothing ever added the class — no theme provider, no `next-themes`,
no `dark` on `<html>`, and **zero `dark:` variants anywhere in `src/`** — so every declaration
in it was inert. Its real cost was readability: it gave `--card`, `--primary-foreground`,
`--destructive` and a dozen more a **second definition**, so reading a token value out of the
file meant first working out which block won. Dropping the `@custom-variant` matters too: while
it was declared, a stray `dark:` class compiled silently into a rule that could never fire.
Now it is a build-time error.

**If a surface needs to be dark, it is an immersive room (§11), which themes itself — not a
mode.** The ceremony rooms are the only such surface, and they are already exempt by name.

**The login clean-up is the pattern to copy (2026-09-17).** All 21 sites moved onto
`--warm-ink` / `--brand-card` keeping **every opacity step exactly as it was** —
`text-black/75` became `text-[var(--warm-ink)]/75`, not a jump to the nearest named ink step.
Mapping varied opacities (`/45 /55 /60 /70 /75 /80`) onto the three ink steps would have been a
re-design; preserving them changes the *hue* onto the system and nothing else. The result is
close to invisible, because the login screen's own ink token is `--warm-ink #1a1208`, a
brown-black — `login/page.tsx` was already on it and only the panel had been left behind.

Note 21, not 19: **two of the sites lived in shared class constants**, which the lint's
`JSXAttribute` selector never reads — the same blind spot R10 has. Fixing only what the linter
can see would have left the file half-converted.

Five more were fixed outright: two `text-emerald-600` handle-availability labels onto
`--success`, one `text-white` avatar initial and one `text-white` badge onto
`--primary-foreground`, and three `ring-black/5` card hairlines onto `--brand-ink`/5. Those
last three had never been flagged at all — see the regex note below.

**Second hole, closed with it: the white/black rule was missing prefixes.** `TOKEN_LINT_REGEX`
banned palette colours across thirteen prefixes (`bg|text|border|ring|from|to|via|fill|stroke|
decoration|divide|accent|caret|outline`) but banned `white`/`black` across only five, so
`ring-black/5`, `divide-white`, `from-black` and friends were legal everywhere. The two lists
are now identical — **keep them that way.**

**A raise is legitimate only when the net gets wider, never when the code gets worse** — and
the new ceiling must be the measured count on the day, not a round number with headroom.

**Trap for the next person:** a grandfather entry for a **dynamic route** must be a directory
glob (`src/app/share/ceremony/**`), not the literal path. ESLint runs these through minimatch,
where `[token]` is a character class matching one of `t`/`o`/`k`/`e`/`n` — so the literal path
silently never matches and the file stays at `error`.

| Rule | Check | Vehicle |
|---|---|---|
| Rule | Script id · baseline (2026-09-11) | Lint selector |
|---|---|---|
| 1.2 card radius | R3 · **0 — closed 2026-09-13** | — |
| 1.4 no pill buttons/inputs | R8 · **0 — closed 2026-09-14** (7 exempt, `RULE_EXEMPT`) | yes |
| 2.1 no Tailwind shadow utilities | R1 · **0 — closed 2026-09-13** (35 → 6 → 0, the last 6 by ratifying §2.2a) | yes |
| 3 no `.btn-*` overrides | R2 · **0 — closed 2026-09-13** | yes |
| 3.4 hand-rolled icon buttons | R6 · **0 — closed 2026-09-13** | yes |
| 4.1 Chip geometry overrides / hand-rolled chips | R5 · **0 — closed 2026-09-14** / R4 · **0 — closed 2026-09-14** (all 31, via §4.3) | yes / — |
| 7.1 `animate-pulse` outside Skeleton | R7 · **0 — closed 2026-09-13** | yes |
| 9.1 / 9.2 touch floor and focus ring | R10 · 74 (heuristic, **trend line — never close at 0**; 295 → 190 scoped to player surfaces, → 142 by the §3.7/§3.5/§3.6 pass, → 116 by raising declared 32–40px heights, → 96 by raising transparent controls sized from padding, → 79 by the **chunky** ruling, → 74 by exempting the unreachable Joshing Games components and reworking the two text actions that could not take a min-height. No open design call remains.) / R9 · **0 — closed 2026-09-13** | — |

Lint lane baseline: **23** `canon/restricted-syntax` + `no-restricted-syntax` warnings
combined (`package.json`'s `lint` script pins `--max-warnings 23`). Trajectory: **103** at
the Phase 5 build → 88 (buttons) → 63 (shadows) → 52 (icon buttons) → 41 (skeletons) →
37 (focus/chips-flat/skeletons stack landed on `main`, #1686) → 27 (R4/R5 chip cleanup) →
18 (R8 cleanup, 2026-09-14) → **48 (2026-09-17, the colour rule's scope widened to `src/**` —
the count went up because the net did, not because the code did; see above)** → **30 (same
day — LoginPanel cleaned rather than parked)** → **23 (same day — no dark mode, so share/ceremony moved to the cream ground)**. Every closure
ratchets the ceiling down the same day, and the 4 still-parked warnings are a backlog to
work off, not a new normal. The lint
selectors still flag 2 of R8's 7 `RULE_EXEMPT` sites (`InviteLinksSection`,
`KnowledgeBubbleMap`) since the eslint lane has no per-rule file exemption, only a whole-lane
one (§13's "where the two lanes disagree" note) — real drift, not a regression, if this
number doesn't move on its own.

**Where the two lanes disagree, and why that is fine.** The script reads whole lines and
7-line `<button>` blocks; the lint selectors read one string literal. So a shadow inside a
template string is counted by R1 and invisible to lint, and `check:design` can exempt a file
per-rule (`RULE_EXEMPT`) where lint can only exempt a file from the whole lane. Keep the two
exemption lists in step by hand — `src/app/ceremony/**` is in both.

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
