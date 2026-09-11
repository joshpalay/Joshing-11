# DESIGN-CANON-CONFLICTS — Phase 1 register for `B-FABLE-DESIGN-CANON-01`

**Type:** read-only conflict register. **No rules are proposed here.** No component, token, or
lint file was changed. This document is the input to the Phase 2 approval gate: Josh rules on
each entry ("4px wins"), and only then does Phase 3 write the canon (now `_docs/DESIGN-SYSTEM.md`,
rewritten in place per Fork B3 — see §4).
**Date:** 2026-09-10 (register) · 2026-09-11 (§4 rulings)
**Measured against:** `main` @ `07ff49be` (2026-09-09), via `git grep … main` so the numbers are
independent of the local working tree. The local branch (`codex/question-lifecycle-quality`)
carries unrelated friends/onboarding edits; none of the canon inputs listed in §1 differ between
it and `main` (`git diff --stat main -- <those files>` is empty).

How to read an entry:

- **Claim** — the thing the documents disagree about.
- **Sources** — every document asserting a value, with `file:line`.
- **Code** — what actually ships, with `file:line`.
- **Authority** — which source should win and why (recency → ratification → agreement with code).
- **Ruling needed** — the one-line decision Josh makes in Phase 2. Where a recommendation is
  obvious it is stated, but nothing here is resolved on this document's authority.

Severity: **HIGH** = a reader following the wrong source introduces drift; **MED** = docs disagree
but code is unambiguous; **LOW** = historical/bookkeeping, fix the text.

---

## 0. Ground truth — the prompt's measured table, re-verified on `main`

| Measure | Prompt | `main` now | Note |
|---|---|---|---|
| `<button>` elements | 504 | **504** | exact |
| `btn-*` class usages / files | 132 / 53 | **134 / 54** | +2 since measurement |
| `btn-primary` / `btn-ghost` / `btn-danger` / `btn-icon` | 84 / 42 / 5 / 1 | **84 / 43 / 6 / 1** | |
| Raw 6-digit hex literals in `.tsx` | 99 | **99** | exact (includes comments, tests, dev pages, OG raster) |
| `rounded-md` | 264 | **264** | exact; top consumers are admin screens + `QuestionForm`/`CreationSurface` (inputs), not cards |
| `rounded-full` | 160 | **157** | |
| `rounded-xl` | 70 | **71** | |
| `rounded-lg` | 43 | **43** | exact |
| `rounded-[var(--radius-card)]` | 22 | **22** | exact — **plus 18 `rounded-[var(--radius-xs)]`**, the same 4px spelled differently (see G-1c) |
| `rounded-2xl` | 21 | **21** | exact; `rounded-3xl` = 4 |
| eslint grandfather entries | 13 | **12** | `eslint.config.mjs:40-53`; `package.json:14` pins `--max-warnings 16`; `docs/design-sweep-NEXT-STEPS.md` said 23 (corrected 2026-09-11) |
| Primitives in `src/components/ui/` | Chip, Skeleton, Switch, auto-grow-textarea | **same** | `button.tsx` confirmed absent |

Extra measurements this pass added (all `main`, `src/**/*.tsx`):

| Measure | Value |
|---|---|
| `shadow-sm` | **11** (none on a section card — see E-1) |
| `shadow-[var(--shadow-card)]` | 24 |
| `var(--shadow-overlay)` | 30 |
| Tailwind `shadow-2xl/xl/lg` | 24 |
| `var(--shadow-stamp…)` | 3 |
| `.card` utility consumers (`className="card …"`) | 14 |
| `<Chip` / `<Skeleton` | 5 (3 files) / 17 (6 files) |
| `animate-pulse` remaining | 13 (4 in `/questions`, 6 in admin, 1 `CreationSurface`, 1 bubble-map pulse, 1 comment) |
| `focus-visible:ring-3 …/50` (the DESIGN-SYSTEM §5.2 idiom) | **0** |
| `focus-visible:ring-2` | 76 |
| `text-quiet` / `text-[13px]` | 114 / **0** (ratified register fully adopted) |
| `text-[9px]` / `[10px]` / `[11px]` / `[15px]` | 4 / 18 / 36 / 16 |
| `btn-primary` sites that override height to `min-h-11` | **8** (see B-2) |
| `--chart-*` / `--sidebar-*` consumers | **0 / 0** (shadcn leftovers) |

**The 132-vs-504 reading, verified.** A heuristic bucketing of every `<button` on `main`
(className text within six lines of the tag; 453 distinct blocks after adjacent-match merging):

| Bucket | Count |
|---|---|
| `btn-*` system | 84 |
| styled, none of the patterns below | 173 |
| no className within the window (mostly admin) | 60 |
| inline text link-button (`underline`) | 49 |
| round icon / pill with an explicit size | 26 |
| unsized `rounded-full` pill | 18 |
| list-row (`w-full text-left`) | 18 |
| invisible / overlay hit target | 14 |
| square icon (`size-N`) | 6 |
| tab (`role="tab"` / `aria-selected`) | 2 |

Of the 369 non-`btn-*` buttons, **52** declare an explicit ≥44px dimension in the window and
**318** carry no `focus-visible:` class in the window. Heuristic, not a lint result — but it
confirms the prompt's framing: the system covers CTAs; icon, row, pill, tab, link-style and
overlay buttons have no rule anywhere. That is a **gap** (canon §3), not a conflict, and is
listed once here so it is not mistaken for one.

---

## 1. Source inventory and corrections to the prompt's reading list

| Doc | Location on `main` | Role | Correction |
|---|---|---|---|
| `PRODUCT-CANON.md` | root | Tier 1 | Contains provenance honesty (§5.3) but **not** "color never the sole signal" (that is `_docs/STYLE-GUIDE-COLOR.md:38`) nor "interface quiet, content loud" (that is `_docs/STYLE-GUIDE-TYPE.md:20`). The canon cites those two tripwires to the style guides, not to PRODUCT-CANON. (The June audit §0 already made the same correction for the shadow phrasing.) |
| `DECISIONS.md` | root | Tier 1 | Had **no entry** for the card-radius / Chip / Skeleton work (X-4) and carried a stale palette entry (K-2). Both fixed 2026-09-11. |
| `D-DESIGN-DEBT-STRUCTURAL-AUDIT-01-FINDINGS.md` | root | Tier 2 | Most rigorous doc, but written 2026-06-16 **the same day** Phases 1–3 shipped (`9b9820b0`, `5b873477`, `edf6dda6`). Its §1b (`.card`), §2 (no Chip), §4 (`PaletteToggle` mounted), §5 (no Skeleton) and §6 B-1 (invite one-off) are all **stale on `main`**. |
| `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` | **root, not `_docs/`** | Tier 2 | Prompt path is wrong. Register-assignment table is authoritative for elevation; its "not tokenized" claim for letterpress is stale (E-2). |
| `_docs/STYLE-GUIDE-COLOR.md` | `_docs/` | Tier 2 | Rules locked; values partly landed (K-2). |
| `_docs/STYLE-GUIDE-TYPE.md` | `_docs/` | Tier 2 | Authoritative on voices; two stray "Montserrat" mentions (T-1). |
| `docs/design-sweep-NEXT-STEPS.md` | `docs/` | Tier 3 | Records the shadcn-button deletion. Cross-ref and counts were stale (X-1, X-7); fixed 2026-09-11. |
| `audits/design-audit-2026-05-30.md` | **was untracked, gitignored** (`.gitignore:34` ignores `audits/` wholesale; other audit files were force-added) — **force-added 2026-09-11** | Tier 3 | Existed only on this machine. The nearest tracked file, `design-review-2026-05-29.md`, is a **different document** (Figma-fidelity review), not a rename. See X-1. |
| `audits/2026-06-11-D-STYLE-AUDIT-01-live-ground-truth.md` and `audits/2026-06-11-style-ground-truth-audit.md` | `audits/` | Tier 3 | **Two same-titled, same-day audits that contradict each other** (K-3). Both superseded by the palette promotion. |
| `audits/2026-06-12-structural-audit.md` | `audits/` | — | **Not a design audit** (safety-vet, grading, proxy tests). Dropped from the reading list. |
| `audits/HEX-TEXTSIZE-WORKLIST-2026-06-07.md` | `audits/` | Tier 3 | Mechanical worklist; its "13px cluster wants a name" note was later ratified as `text-quiet`. |
| `_docs/DESIGN-SYSTEM.md` (the 2026-05-19 version) | `_docs/` | **was Tier 4 — stale** | Every section other than §7 (icons) and §3.2 (breakpoints) was contradicted by code or a Tier-2 doc. Itemised in G-1, G-2, E-1, E-4, E-6, B-1..B-4, T-1..T-3, K-1. **Rewritten in place as the canon on 2026-09-11 (Fork B3).** |
| `D-DESIGN-DEBT-STRUCTURAL-01` (the *decision*, not the audit) | **does not exist** | — | Cited as ratifying authority by `globals.css:378`, `Chip.tsx:5`, `Skeleton.tsx:5` and the build prompt. The only record was three commit messages (X-4); now recorded in `DECISIONS.md`. |
| `B-VISUAL-PALETTE-PROMOTE-01`, `B-VISUAL-CARD-TIERS-01`, `B-VISUAL-LITERAL-TO-TOKEN-01` | **do not exist as files** | — | Referenced as gates/prompts throughout. Only `B-VISUAL-TOKEN-BUDGET-01-bucket-B.md` exists. Palette-promote was **built** per `DECISIONS.md` (K-2). |

---

## 2. Conflict register

### GEOMETRY

**G-1 · Card radius — HIGH**
- **Claim:** what corner a content card has.
- **Sources:**
  - old `_docs/DESIGN-SYSTEM.md:306-313` — `.card` = `rounded-lg`, "Radius: 10px".
  - `src/app/globals.css:185-186` (conventions comment) — "content cards use `rounded-md`" (8px); "login cards use `rounded-[8px]`"; "envelope uses `rounded-[1.5rem]`".
  - `src/app/globals.css:378-385` — `--radius-card: var(--radius-xs)` (4px), "Canonical CARD radius (D-DESIGN-DEBT-STRUCTURAL-01, Phase 1)".
  - `D-DESIGN-DEBT-STRUCTURAL-AUDIT-01-FINDINGS.md:42` — `.card` utility = `rounded-lg` (10px) at "globals.css:363".
  - `audits/design-review-2026-05-29.md:23` — "design system's 4px content radius"; login card `rounded-2xl` is "intentional".
  - `docs/design-sweep-NEXT-STEPS.md:28` — FeedCardShell consolidation (C7) at 4px.
- **Code:** `.card` = `rounded-[var(--radius-card)]` (`globals.css:485`, changed by `5b873477` 2026-06-16, "Radius decision (4px) per the Phase 2 checkpoint"). `FeedCardShell.tsx:16` = `rounded-[var(--radius-xs)]`. 22 sites use `--radius-card`, 18 use `--radius-xs` for the same 4px. The June audit's "globals.css:363" line no longer exists in that form.
- **Authority:** `globals.css:385` + commit `5b873477`. DESIGN-SYSTEM §6.3 and the June audit §1b are both stale; the `globals.css:185` comment contradicts its own file 200 lines later.
- **Ruling needed:** (a) confirm **4px**; (b) which spelling is canonical for cards (`--radius-card` vs `--radius-xs`) — recommend `--radius-card` for anything that is a card, `--radius-xs` reserved for non-card 4px controls such as the login inputs at `LoginPanel.tsx:27`; (c) the stale comment at `globals.css:185-186` — record as a PROPOSED globals edit for a later build.

**G-2 · The radius scale itself — MED**
- **Claim:** what `rounded-xl/2xl/3xl` measure in this app.
- **Sources:** old `DESIGN-SYSTEM.md:229-242` lists `sm…4xl` as multiples of `--radius` (10px) and **omits `--radius-xs`**. The June audit labels `rounded-2xl` "16px" and `rounded-3xl` "24px" (`…FINDINGS.md:43-44`), i.e. Tailwind stock values.
- **Code:** `globals.css:45-52` (`@theme inline`) overrides the scale: xs 4 · sm 6 · md 8 · lg 10 · xl 14 · **2xl 18 · 3xl 22** · 4xl 26. `globals.css:374-377` then redefines `xs…lg` a second time as literal rem (same values). So `rounded-2xl` is 18px here, not 16.
- **Authority:** `globals.css:45-52`. The audit's px labels are wrong but harmless.
- **Ruling needed:** none on value. The canon prints the real scale. The duplicate `:root` redefinition (`374-377`) is a PROPOSED cleanup.

**G-3 · Non-card radii have no rule — MED (gap)**
- **Code:** the 25 remaining `rounded-2xl/3xl/t-2xl` sites on `main` are almost all **sheets and modals** (`CreateChooser.tsx:65`, `AddAreaModal.tsx:47`, `AskFriendForDomain.tsx:215`, `InviteLinksSection.tsx:359,470`, `FeedActions.tsx:158`, `AnsweredRowActions.tsx:70`, `daily/summary/page.tsx:990`, `AnswerFeedbackSheet.tsx:421`) plus inputs (`ReportReasonSheet.tsx:189,202,257`), a sticky section (`daily/summary/page.tsx:328`), two rows (`NotForMeSheet.tsx:157`, `HiddenQuestions.tsx:69`), an avatar tile (`users/[id]/page.tsx:582`) and the login art placeholder (`login/page.tsx:86`). `rounded-lg` (43) is concentrated in `knowledge/[domain]` and `/questions` skeletons/rows.
- **Sources:** no document assigns a radius to sheets, modals, inputs, or rows.
- **Ruling needed:** none in Phase 2; canon §1.3–1.5 PROPOSED. Flagged so a "4px everywhere" reading of G-1 does not sweep sheets.

### ELEVATION

**E-1 · Card shadow — HIGH (docs) / RESOLVED (code)**
- **Sources:** old `DESIGN-SYSTEM.md:253,317` — `shadow-sm`. `D-CONSISTENCY-AUDIT-DISPOSITION-01.md:112-118` — `--shadow-card` / `-strong`. June audit C-2 (`:48`) — "`shadow-sm` is the de-facto card shadow on every non-feed card". Build prompt seed repeats C-2.
- **Code:** `.card` = `shadow-[var(--shadow-card)]` (`globals.css:485`); 24 direct consumers. The 11 surviving `shadow-sm` uses are **not cards**: 4 `<figure>` screenshots on `sms-consent/page.tsx:48-116`, 3 chips/circles in `TerritorySetupClient.tsx:738,980,998`, 1 hover state (`PeopleYouInvited.tsx:311`), 3 knowledge pills (`KnowledgeBubbleMap.tsx:318`, `KnowledgePeaksView.tsx:1034,1062`).
- **Authority:** disposition doc + `globals.css:392` + commit `5b873477`. C-2 is done; DESIGN-SYSTEM was wrong.
- **Ruling needed:** confirm `--shadow-card` (formality). Chips/pills have no elevation rule and three carry `shadow-sm` — canon slot.

**E-2 · Letterpress register is now tokenised — LOW**
- **Sources:** disposition `:114` — "literal `Npx Npx 0 <ink>` (not tokenized)". June audit §1d — `KnowledgeOverviewClient.tsx:310` raw `#3a3a3a` → DEFER.
- **Code:** `globals.css:398-399` defines `--shadow-stamp` / `--shadow-stamp-sm`; `OverlapMap.tsx:34,298` and `KnowledgeOverviewClient.tsx:320` consume them (the `#3a3a3a` is gone). `ShareCard.tsx:134` still literal; `SharePortraitCard` exempt raster.
- **Ruling needed:** (a) stamp tokens canonical; (b) `ShareCard.tsx:134` token or literal.

**E-3 · Sheet / overlay shadows — MED (partially migrated)**
- **Sources:** disposition `:118` assigns `--shadow-overlay` to the two centered modals only. June audit C-3 lists ten action sheets on `shadow-2xl/xl`.
- **Code:** 30 `--shadow-overlay` consumers now; 24 Tailwind `shadow-2xl/xl/lg` remain (`FeedActions.tsx:158`, `AnsweredRowActions.tsx:70`, `daily/summary/page.tsx:990`, `AddAreaModal.tsx:47`, Nav FAB `Nav.tsx:225`, …).
- **Ruling needed:** one overlay register for every floating surface, FAB decided explicitly.

**E-4 · DESIGN-SYSTEM sanctioned Tailwind `shadow-lg/xl/2xl` — MED.** Old `:254-256`. Replaced by the four-token register (`globals.css:386-394`). Superseded.

**E-5 · "Raised" register — carried forward, no conflict.** `TerritorySetupClient`, `PortraitCircles` stay deferred per disposition `:129-131`.

**E-6 · Focus ring idiom — MED**
- **Sources:** old `DESIGN-SYSTEM.md:262` — `focus-visible:ring-3 focus-visible:ring-ring/50`. Disposition `:119` — selection ring `0 0 0 2px` (a *selection* idiom, distinct).
- **Code:** the DESIGN-SYSTEM idiom has **0** uses; `.btn-*` use `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (`globals.css:497-509`), 76 sites match; 92 use `focus-visible:outline-*`.
- **Ruling needed:** confirm the `ring-2` recipe for every interactive element (318/369 non-system buttons show none).

### BUTTONS

**B-1 · A `<Button>` component that does not exist — HIGH.** Old `DESIGN-SYSTEM.md:10,164,207-210,276-302,351,408` documented `src/components/ui/button.tsx`. Deleted in `8df528f8` (2026-05-30, C6); `globals.css:494-495` records it; `9b9820b0` says "not reintroducing a React Button"; NEXT-STEPS `:13-14` confirms. Nothing in `DECISIONS.md` recorded it (fixed 2026-09-11). **Ruling needed:** ratify.

**B-2 · `.btn-primary` geometry — HIGH + a live leak.** Old `DESIGN-SYSTEM.md:211,322-326` — `min-h-10`, `rounded-md`, `text-sm font-medium`. Code `globals.css:496-498` — `min-h-12 rounded-[4px] text-base font-bold tracking-[0.04em]` (since `e68aebde`). **8 call sites** write `btn-primary min-h-11` (`invite/[token]/page.tsx:39,60`, `sms-consent/page.tsx:159`, `InviteLinksSection.tsx:436,501`, `AcceptFriendInvitationButton.tsx:51`, `AcceptInviteLinkButton.tsx:56`, `dev/invite-redesign/recipient/page.tsx:19`). **Ruling needed:** 48 only, or 44 as a variant.

**B-3 · `.btn-primary` fill comment — LOW.** `globals.css:490` and `e68aebde` say "brand-link fill"; `--btn-primary-bg: var(--brand-navy)` (`:82`). Renders navy. Comment fix is a PROPOSED globals edit.

**B-4 · `.btn-ghost` — HIGH (doc).** Old doc `min-h-10 rounded-md`; code `min-h-11 rounded-[4px]` (`globals.css:500-502`).

**B-5 · June audit one-offs, re-checked — MED.** `invite/[token]:71` → folded (now `:39,60` with the B-2 override). `OnboardingFlow.tsx:797` → still a pill at `:881`. `LoginPanel.tsx:26` → still parallel at `:29`, `h-11` vs the 48px recipe, no focus ring. `Nav.tsx:203` → FAB at `:225`, intentional. **Ruling needed:** fold or exempt each.

**B-6 · Non-CTA buttons — GAP.** See §0. `.btn-icon` has one consumer while ~30 icon buttons hand-roll `size-11 rounded-full`.

### PRIMITIVES

**P-1 · Chip — MED.** June audit §2 "no shared Chip primitive". `ui/Chip.tsx` landed in `9b9820b0` (same day). Two sizes, label required. **Adoption: 5 usages in 3 files**; Phase 1 promised a fold that Phase 2 never ran (cards only). Still inline: `MyQuestionCard.tsx:65`, `Nav.tsx:201,300`, `FeedList.tsx:733`, `TerritorySetupClient.tsx:738,980,998`, `KnowledgePeaksView.tsx:1034,1062`. `ReplaySummary` gone (`/replay` deleted). **Ruling needed:** ratify Chip; badges chip-or-separate; 10px named or arbitrary.

**P-2 · Skeleton — LOW.** June audit §5 "no shared Skeleton". `ui/Skeleton.tsx` landed in `edf6dda6`, adopted in 6 files (17 uses); `/questions` intentionally left; `CreationSurface.tsx:233` and admin loaders remain. **Ruling needed:** confirm.

**P-3 · `Switch`, `auto-grow-textarea` — GAP.** Undocumented.

### CARDS AND LISTS

**C-1 · "Four coexisting card chromes" — RESOLVED for the audit's named sites; NOT resolved app-wide.** The audit's section-card table (`…FINDINGS.md:43-44`) was migrated by `5b873477`. Residual on `rounded-2xl`: `NotForMeSheet.tsx:157`, `HiddenQuestions.tsx:69`, `daily/summary/page.tsx:328`, `users/[id]/page.tsx:582`. **Correction (Phase 5, 2026-09-11):** the register's first draft called this "largely resolved" from the `rounded-2xl/3xl` count alone; the conformance script's R3 (card fill + non-card radius) finds **~40 further card containers on `rounded-lg`/`rounded-xl`** — daily summary/catch-up panels, every settings form section, `knowledge/[domain]`, the inline-field card variants. The June audit's "`.card` = 10px" row was stale, but its *pattern* (cards on `rounded-lg`) is still the most common drift in the app. Listed in canon §1.2; codemod scope.

**C-2 · `/questions` two-layout problem (Q-1) — OPEN.** `AnsweredQuestionsList.tsx:68,83` grid still renders.

**C-3 · Deferred or done? — MED.** Disposition `:46,48,95` + `DECISIONS.md:76`: card unification NOT-APPLICABLE, deferred to `B-VISUAL-CARD-TIERS-01` (no such file). Three days later the June audit recommends C-1/C-2 and `5b873477` ships them. **Ruling needed:** superseded for geometry; tiers still deferred.

### TYPE

**T-1 · Font families — HIGH (doc).** Old `DESIGN-SYSTEM.md:140-146,390-393` — Montserrat body, Caveat, Playfair, system mono. `STYLE-GUIDE-TYPE.md:3,134-141` + `globals.css:9,13,61,66,366,373` + `DECISIONS.md` Playfair entry — Josefin Sans body, Cormorant serif, Montserrat wordmark only, no Caveat, Playfair retired, `--font-mono` → sans. Stale wobble: STYLE-GUIDE-TYPE `:51` and `globals.css:361` still say "Montserrat" for the System voice.

**T-2 · Type scale — LOW.** Old §2.2 + `text-[0.8rem]` from the deleted button. Live: `text-quiet` 13px ratified and fully adopted; 9/10/11/15px arbitrary per `STYLE-GUIDE-TYPE.md:84`. 11px has 36 uses.

**T-3 · "Three registers" vs "four voices" — LOW.** Superseded.

### COLOUR — context only (Fork D1: no colour rules in the canon)

**K-1 · Old DESIGN-SYSTEM token tables — HIGH (doc).** §1.1 semantic hex all repointed (`globals.css:194-211`); §1.3 `--ink` now navy alias (`:282`); §1.4 `--wrong` retired (`:237-239`); `--success` = system state only (`:187-191`).

**K-2 · Is the palette gate open or closed? — HIGH.** `DECISIONS.md` line 74 "[decided, NOT built] … collision still live"; Open item "Land the palette promotion [highest priority]"; **versus** the `[built]` entry "de-collided palette is the default … built 2026-06-13 in `B-VISUAL-PALETTE-PROMOTE-01`". Code: `globals.css:135-136,146,168` hold the de-collided values; no `data-palette` block. But `globals.css:143-145` says the other category systems are "still hardcoded — fix-list step 3, in progress"; `STYLE-GUIDE-COLOR:121` lists values "still to set". **Ruling needed:** what the gate now means.

**K-3 · Two contradictory 2026-06-11 style audits — LOW.** "direct collision" (`D-STYLE-AUDIT-01-live-ground-truth.md:13`) vs "NO exact hex shared" (`style-ground-truth-audit.md:10`). Baselines quoted: ~90–110, ~390, 62, ≈312; today 99 raw hex, colour ratchet ceiling 41. Record only.

**K-4 · `PaletteToggle` — LOW.** June audit §4 says mounted for every visitor. On `main` the import is commented out (`layout.tsx:10`); remaining mentions are inside a JSX comment — **unmounted**. `TESTING ONLY` CSS blocks (`globals.css:720-762`) remain.

### PROCESS AND CROSS-REFERENCES

**X-1 · `design-audit-2026-05-30.md` — MED.** NEXT-STEPS `:3` cites it; gitignored (`.gitignore:34`). Origin of C1–C8 and C6. `design-review-2026-05-29.md` is not a substitute. **Ruling needed:** force-add.

**X-2 · `2026-06-12-structural-audit.md` is not a design audit.** Dropped.

**X-3 · Disposition doc path.** Root, not `_docs/`.

**X-4 · "Ratified" card canon had no decision record — HIGH.** `globals.css:378`, `Chip.tsx:5`, `Skeleton.tsx:5`, the prompt cite `D-DESIGN-DEBT-STRUCTURAL-01`; no such doc; the 4px decision lived only in `5b873477`'s message. **Ruling needed:** confirm G-1/P-1/P-2; record in `DECISIONS.md`.

**X-5 · Mis-attributed tripwires.** §1 row 1.

**X-6 · `DECISIONS.md:76` summarised the disposition as keeping "flat letterpress is intentional".** The disposition removed that guardrail (`:97`). Fixed 2026-09-11.

**X-7 · Grandfather list counts.** NEXT-STEPS said 23; prompt 13; `eslint.config.mjs:40-53` has **12**; `--max-warnings 16`.

**X-8 · Enforcement already exceeds what Fork C describes.** Six CI ratchets (`scripts/check-{font,color,spacing,radius,zindex,typesize}-ratchet.mjs`; ceilings font 0, colour 41, radius 0, z-index 0, type-size 213). A conformance script sits beside these.

**X-9 · Old DESIGN-SYSTEM §1.5 chart, §1.6 sidebar, §7 icons.** Verified 2026-09-11: chart/sidebar tokens have **0 consumers** (dropped, PROPOSED removal from `globals.css`); §7's 13 icon exports confirmed and carried across.

---

## 3. What Phase 2 had to rule on — the short list

| # | One-line decision | Entry |
|---|---|---|
| 1 | Card radius is 4px, expressed as `--radius-card` (cards) with `--radius-xs` reserved for non-card 4px controls | G-1 |
| 2 | Card shadow is `--shadow-card` / `--shadow-card-strong`; Tailwind `shadow-*` is off-register | E-1, E-4 |
| 3 | Letterpress register = `--shadow-stamp` / `-sm`; `ShareCard.tsx:134` migrates or is exempt | E-2 |
| 4 | Every sheet / drawer / popover sits on `--shadow-overlay`; the FAB is decided explicitly | E-3 |
| 5 | Focus ring = `focus-visible:ring-2 ring-ring ring-offset-2` for **all** interactive elements | E-6 |
| 6 | No React `<Button>`; `.btn-*` is the primitive (ratify in DECISIONS.md) | B-1, X-4 |
| 7 | Primary CTA is 48px only, **or** a 44px compact primary is a named variant | B-2 |
| 8 | Login CTA (`LoginPanel.tsx:29`) and onboarding pill (`OnboardingFlow.tsx:881`): fold or exempt | B-5 |
| 9 | `Chip` is the chip primitive; count badges are chips **or** a separate badge type | P-1 |
| 10 | `Skeleton` is the skeleton primitive; `/questions` is codemod work | P-2 |
| 11 | Disposition #2/#4 superseded for geometry; card *tiers* still deferred | C-3 |
| 12 | What the colour gate now means after the `[built]` entry | K-2 |
| 13 | Force-add `audits/design-audit-2026-05-30.md` or accept the commit as the record | X-1 |
| 14 | Fork A / B / C / D from the build prompt | — |

---

## 4. Phase 2 rulings — Josh, 2026-09-11

These are the sources cited as "Phase 2 ruling N" in `_docs/DESIGN-SYSTEM.md`. Josh saw the
seven decisions rendered at true size (artifact "Design Canon Rulings") before ruling.

| # | Ruling | Resolves |
|---|---|---|
| 1 | **4px, as shipped.** `--radius-card` for cards, `--radius-xs` for non-card controls (recommendation accepted). Leftover 18px rows are codemod work, not exceptions (recommendation accepted). | G-1, C-1, C-3, X-4 |
| 2 | **44px is the primary height overall** — the invite-screen override wins over the 48px recipe. `.btn-danger`: the red-painted primary at `InviteLinksSection.tsx:501` uses `.btn-danger`. | B-2, B-4 |
| 3 | **Login stays as it ships** (at 44px it now equals the recipe; folds onto `.btn-primary`, gaining the focus ring). **Onboarding pill becomes a normal button, not a pill.** **FAB is its own button type.** | B-5 |
| 4 | **Chip is one primitive; `md` is the chip.** Count badges are a **separate type**. On 10px: Fable to suggest → canon §4.2 `Badge` proposal (10px lives only inside the primitive). | P-1, T-2 |
| 5 | **Do what the code says** — palette promotion is done; `DECISIONS.md` lines 74 and 92 corrected. | K-2 |
| 6 | **Force-add** `audits/design-audit-2026-05-30.md`. Done (`git add -f`, secret-scanned clean). | X-1 |
| 7 | **A2 · B3 · C3 · D1.** Propose where silent; rewrite `DESIGN-SYSTEM.md` in place; lint + conformance script; structural only, no colour section. | forks |

By implication of rulings 2–3: **no React `<Button>`; `.btn-*` is the primitive** (list #6) is
treated as ratified and recorded in `DECISIONS.md`.

Not ruled on in Phase 2 — carried to Phase 4: list #3 (stamp tokens canonical, E-2), #4 (sheets
and FAB on `--shadow-overlay`, E-3), #5 (focus ring universal, E-6), #10 (Skeleton, P-2), plus
every rule the canon marked PROPOSED in §1.3–1.5, §3.4–3.6, §3.8–3.9, §4.1 (sm retirement and
no-repad), §4.2, §6, §7.1, §9.

---

## 5. Phase 4 ratification — Josh, 2026-09-11

All fifteen proposals were put to Josh as one list with a recommendation on each; ruling:
**"all looks good — I am fine with the small primitive."** One amendment, from the
recommendation itself: **the FAB takes `--shadow-card-strong`, not `--shadow-overlay`** (items
4 and 8). Everything in `_docs/DESIGN-SYSTEM.md` is therefore RATIFIED as of this date.

| # | Rule | Canon § |
|---|---|---|
| 1 | Sheets/modals `rounded-2xl` (18px); action menus 22 → 18 | 1.3 |
| 2 | Inputs never pills; `min-h-11`, `--radius-xs`, `--brand-field` | 1.4, 1.5 |
| 3 | Stamp tokens canonical; `ShareCard` migrates; raster exempt | 2.3 |
| 4 | Every floating surface on `--shadow-overlay`; Tailwind `shadow-*` banned in components; **FAB on `--shadow-card-strong`** | 2.1, 2.2 |
| 5 | Icon buttons use `.btn-icon`; round only for close + FAB; `aria-label` mandatory | 3.4 |
| 6 | Tab recipe; selected state never by hue alone | 3.5 |
| 7 | List-row recipe | 3.6 |
| 8 | FAB spec (one per app, `--z-nav`, card-strong shadow) | 3.8 |
| 9 | Invisible backdrop button contract | 3.9 |
| 10 | Chip `sm` retired; callers may not re-pad or re-size | 4.1 |
| 11 | `Badge` primitive at 10px — the only sanctioned 10px | 4.2 |
| 12 | Divided rows, no per-row chrome; `/questions` answered tab drops its grid | 6 |
| 13 | Skeleton is the only loading placeholder | 7.1 |
| 14 | 44px hit floor and universal focus ring | 9 |
| 15 | Housekeeping: unused chart/sidebar tokens and the duplicate radius block leave `globals.css` in a later build | 12 |

Phase 5 (enforcement) built the same day: `DESIGN_LINT_RULES` in `eslint.config.mjs` and
`scripts/audit-design-conformance.mjs` (`npm run check:design`).
