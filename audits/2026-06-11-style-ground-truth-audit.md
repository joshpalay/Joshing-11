# D-STYLE-AUDIT-01 — Live Style Ground-Truth Audit

**Date:** 2026-06-11 · **Scope:** every color and font actually in use in `src/` (live code only; PRD and prototype `.jsx` deliberately ignored) · **Mode:** read-only — no source file was modified; this report is the only artifact.

---

## Findings summary (the 3–5 consequential drifts)

1. **Grading-vs-category collision: NO exact hex shared, but multiple near-hex collisions — and one semantic inversion.** No category palette reuses a grading hex byte-for-byte. But the feed/triangle category orange `#d15e36` (`--tri-orange`/`--brand-orange`, `src/app/globals.css:67,76`) sits in the same terracotta family as the WRONG tokens `--game-wrong #c96b4a` and `--game-wrong-strong #c33d14` (`globals.css:90–91`); the "Recently Expanding"/"Your World Is Expanding" territory accent `#c9564d` (`src/components/knowledge/RecentlyExpanding.tsx:26`, `src/components/feed/EditorialPromos.tsx:22`) is nearly indistinguishable from `--game-wrong #c96b4a`; and the knowledge greens (Language `#4a7a5a`, Science `#5a7a2e`, Food `#2e8b57`, `src/components/knowledge/PortraitCircles.tsx:79–118`) crowd the CORRECT greens (`--game-correct #366045`, `--game-correct-soft #5d6f5b`, `--success #178245`). Worse, the *meaning of fill* inverts across surfaces: in the activity bundle mark a **solid** orange triangle means "still to play" (`src/components/activity/ActivityIcon.tsx:11–12,193–230`), while everywhere else the orange family means "wrong." So yes — a category/progress triangle can render in (near) the WRONG color.
2. **The audit premise about the feed triangle markers is contradicted by live code: hue is NOT category.** Each triangle's fill is a deterministic hash of `rowId:position` over the 6-token triangle palette — explicitly decorative (`src/components/activity/ActivityIcon.tsx:19–23,138–140`). Fill solid/hollow = unanswered/answered (not "completion = filled"). The feed *card accent bar* is the only category-hued element, and it's hash-of-category-name over an 8-color list, not a stable category→hue map (`src/components/feed/visual.ts:30–35`).
3. **There are five separate category/domain color systems in live code** (feed hash palette, knowledge `DOMAIN_COLORS`, a duplicated literal copy in the share card, the position-based red/gold/blue "expanding" accents, and a vivid hash-based ceremony gradient palette). No two share values or assignment logic. Section 2 enumerates them.
4. **The serif story is not what any doc says.** The brand serif is **Cormorant Garamond** (not Source Serif, which appears nowhere; not Literata, which survives only as the misleading token name `--font-literata` that resolves to Cormorant, `globals.css:208`). Meanwhile the activity stream's editorial register is **hardcoded `'Georgia, serif'`** — raw Georgia as a primary face, bypassing every font token (`src/components/activity/ActivityStreamItem.tsx:65,336,574,618,669`). Caveat is loaded on every page but has **zero consumers** (`src/app/layout.tsx:43–47`; its only reference, `FH` in `src/components/lately/tokens.ts:19`, is never imported).
5. **The "gold" is at least six different values, not one token.** `--tri-amber #d9a82e` (token), `GOLD_INK` = `color-mix(tri-amber 50%, brand-ink)` **defined identically in three files**, `HILITE #e9c97a` (TS-only constant, one consumer), `--tri-darkyellow #deae5c`, `--warning #b45309`/`--warning-border #e6c15a`, plus stray `#f0c060` and `#d9b56c`. Section 2 details which job each does.
6. **Off-system starting count for the ratchet: ~390 occurrences** (235 hardcoded hex + 77 rgb()/rgba()/hsl() + 7 Tailwind arbitrary raw colors + 71 raw font-family declarations) in non-test app/component code. Section 5.

**TODO status against live code:** F4.2 **resolved** · F4.3 **partially resolved** (details in Section 3 / Section 1).

---

## Section 1 — Color: actual values

All app-wide tokens live in one file: `src/app/globals.css` (`:root`, lines 52–213). `tailwind.config.ts` is empty (Tailwind v4; theme comes from the CSS `@theme` block). Dark-mode overrides at `globals.css:215–254` exist but the app never sets `.dark`.

### 1a. CSS custom properties (single source: `src/app/globals.css`)

| Token | Value | Defined at |
|---|---|---|
| `--brand-ink` | `#0a1f3d` | globals.css:61 |
| `--brand-ink-950` | `#091729` | globals.css:62 |
| `--brand-ink-700` | `#3a4a5f` | globals.css:63 |
| `--brand-ink-400` | `#8a8a8a` | globals.css:64 |
| `--brand-navy` | `#1f3a5a` | globals.css:65 |
| `--brand-link` | `#4a5d75` | globals.css:66 |
| `--brand-orange` | `#d15e36` | globals.css:67 |
| `--brand-cream` | `#f8e6c7` | globals.css:68 |
| `--brand-cream-page` | `#fcf8f2` | globals.css:69 |
| `--brand-card` | `#fdfcfb` | globals.css:70 |
| `--brand-cream-card` | `#fbf5e9` | globals.css:71 |
| `--brand-border` | `#e9e2d2` | globals.css:72 |
| `--brand-rule` | `rgba(60,50,40,0.14)` | globals.css:73 |
| `--domain-language` | `#7a9eaa` | globals.css:74 |
| `--domain-science` | `#8aa68a` | globals.css:75 |
| `--tri-orange` | `#d15e36` (≡ `--brand-orange`) | globals.css:76 |
| `--tri-cream` | `#f8e6c7` (≡ `--brand-cream`) | globals.css:77 |
| `--tri-darkteal` | `#6d837f` | globals.css:78 |
| `--tri-lightteal` | `#adb19e` | globals.css:79 |
| `--tri-darkyellow` | `#deae5c` | globals.css:80 |
| `--tri-lighttan` | `#edd2a3` | globals.css:81 |
| `--tri-amber` | `#d9a82e` | globals.css:82 |
| `--game-card-question` | `#faf4e9` | globals.css:87 |
| `--game-correct` | `#366045` | globals.css:88 |
| `--game-correct-soft` | `#5d6f5b` | globals.css:89 |
| `--game-wrong` | `#c96b4a` | globals.css:90 |
| `--game-wrong-strong` | `#c33d14` | globals.css:91 |
| `--primary-foreground` | `#fbf4e3` | globals.css:119 |
| `--secondary` / `--muted` / `--accent` | `#f1ebdd` | globals.css:120,122,124 |
| `--destructive` | `oklch(0.577 0.245 27.325)` (≈ vivid red) | globals.css:126 |
| `--success` | `#178245` | globals.css:153 |
| `--warning` | `#b45309` | globals.css:163 |
| `--warning-surface` | `#fdf6e6` | globals.css:164 |
| `--warning-border` | `#e6c15a` | globals.css:165 |
| `--success-surface/-border`, `--destructive-surface/-border` | `color-mix(…)` off `--success`/`--destructive` | globals.css:166–169 |
| `--editorial-parchment` / `-sage` / `-slate` | `color-mix(…)` off border/success/link | globals.css:175–177 |
| `--ink` | `var(--brand-ink)` → `#0a1f3d` | globals.css:182 |
| `--cream` | `var(--brand-card)` → `#fdfcfb` | globals.css:183 |
| `--cream-warm` | `var(--brand-cream-card)` → `#fbf5e9` | globals.css:184 |
| `--cream-accent` | `var(--brand-cream)` → `#f8e6c7` | globals.css:185 |
| `--border-warm` | `var(--brand-border)` → `#e9e2d2` | globals.css:186 |
| `--border-light` | `#eee7d8` | globals.css:187 |
| `--warm-ink` | `#1a1208` | globals.css:195 |
| `--warm-ink-700` | `#696257` | globals.css:196 |
| `--warm-ink-500` | `#7d7568` | globals.css:197 |
| `--warm-ink-400` | `#8a8070` | globals.css:198 |
| `--warm-border` | `#e8e2d6` | globals.css:199 |
| `--warm-border-soft` | `#ddd6c7` | globals.css:200 |
| `--warm-paper` | `#faf8f2` | globals.css:201 |
| `--warm-cream` | `#f5f0e8` | globals.css:202 |
| `--user-bubble` | `oklch(0.62 0.18 250)` | globals.css:151 |
| shadcn semantics (`--background`, `--foreground`, `--card`, `--primary`, `--border`, `--ring`, …) | re-pointed at the brand tokens above | globals.css:112–129 |

### 1b. TS-constant "shadow palettes" (tokens defined outside CSS)

| Constant(s) | Values | Defined at | Relation to CSS tokens |
|---|---|---|---|
| `INK / INK2 / INK3 / CREAM / PAPER / RULE / HILITE` | `#0a1f3d / #3a4a5f / #8a8a8a / #fcf8f2 / #fdfcfb / #e9e2d2 / #e9c97a` | `src/components/lately/tokens.ts:4–10` | First six duplicate brand tokens by value; **HILITE has no CSS counterpart** |
| `INK / INK2 / INK3 / CREAM / RULE` (share card) | `#0e0e0e / #3a3a3a / #8a8a8a / #faf8f2 / #e0dbd0` | `src/components/knowledge/SharePortraitCard.tsx:16–20` | **Intentionally literal** (html2canvas raster path; documented at lines 4–14) — but the INK/CREAM/RULE *values differ* from the lately constants of the same names |
| `CATEGORY_COLORS` / `AVATAR_COLORS` | 8 / 6 literal hexes incl. `#1f3a5a, #d15e36, #6d837f, #7a9eaa, #8aa68a, #d9a82e, #9a6a4e, #adb19e` | `src/components/feed/visual.ts:4–22` | Duplicates brand/tri/domain token values as literals; adds `#9a6a4e` (warm tan, no token) and fallback `#9ca3af` (Tailwind gray-400, off-brand) at visual.ts:31,38 |
| `PALETTE` (loading screen) | `#D15E36, #6D837F, #ADB19E, #F8E6C7, #DEAE5C, #EDD2A3` | `src/components/LoadingScreen.tsx:16–23` | Literal duplicates of the six `--tri-*` fills (globals.css:60 says the CSS tokens "intentionally mirror" this file — i.e. the duplication is acknowledged, in both directions) |
| `GOLD_INK` | `color-mix(in srgb, var(--tri-amber) 50%, var(--brand-ink))` | defined 3×: `src/components/feed/AnswerFeedbackSheet.tsx:16`, `src/components/feed/NewTerritoryUndo.tsx:15`, `src/components/play/GameplayChat.tsx:182` | Identical formula, copy-pasted — a token in waiting |
| `DOMAIN_COLORS` | 12 named category hexes (see §2b) | defined 2×: `src/components/knowledge/PortraitCircles.tsx:58–119` and `src/components/knowledge/SharePortraitCard.tsx:25–41` | Values currently match; two sources of truth |

### 1c. Tokens defined in more than one place with differing values (flag list)

| Name | Place A | Place B | Conflict |
|---|---|---|---|
| `CREAM` | lately/tokens.ts:7 → `#fcf8f2` (page cream) | CSS `--cream` globals.css:183 → `#fdfcfb` (card) | **Same name, two different creams.** SharePortraitCard.tsx:19 adds a third (`#faf8f2`) |
| `INK` | lately/tokens.ts:4 → `#0a1f3d` (navy) | SharePortraitCard.tsx:16 → `#0e0e0e` (near-black) | Share-card divergence is documented as intentional, but the name collision invites mistakes |
| `RULE` | lately/tokens.ts:9 → `#e9e2d2` | SharePortraitCard.tsx:20 → `#e0dbd0` | As above |
| `--font-sans` | globals.css:9 (`@theme inline`) → `var(--font-sans)` (self-referential) | globals.css:53 (`:root`) → `var(--font-sans-body, …)` | Works (theme reads the root var) but the self-reference at line 9 is a trap for the next editor |
| correct/wrong convention | globals.css:108 comment prescribes `--success` (#178245) + `#b42318` | actual gameplay/feed reveals use `--game-correct`/`--game-wrong(-strong)` | `#b42318` appears **nowhere** in live component code — the convention comment is stale (see §2a) |

---

## Section 2 — Color: actual usage → job

### 2a. WRONG and RIGHT grading results — exact live values

There are **two grading color systems in production**, not one:

| Surface | RIGHT | WRONG | Citations |
|---|---|---|---|
| Play thread result card (rail/label/fill) | `var(--game-correct)` `#366045` | rail+text `var(--game-wrong-strong)` `#c33d14`; border/fill mixes of `var(--game-wrong)` `#c96b4a` | `src/components/play/GameplayChat.tsx:1007–1020,1042,1095` |
| Feed answer-reveal sheet ("Correct!" / "Not quite", badge, +pts pill) | `var(--game-correct)` | `var(--game-wrong-strong)` | `src/components/feed/AnswerFeedbackSheet.tsx:209–227` |
| Activity-stream answered history ("Correct" / "Not this time") | `var(--game-correct)` | `var(--game-wrong-strong)` | `src/components/activity/ActivityStreamItem.tsx:547` |
| Daily summary / catch-up tiles | `var(--game-correct)` (+ mixes) | mixes of `var(--game-wrong)` | `src/app/daily/summary/page.tsx:361–366,565–582`; `src/app/daily/catchup/page.tsx:273–325` |
| **Today's Five result dots (home card)** | **`var(--success)` `#178245`** | **`var(--destructive)` `oklch(0.577 0.245 27.325)`** | `src/components/TodaysFiveCard.tsx:235–242` |
| Game summary / replay "share" chips | mixes of `var(--success)` *and* `var(--game-correct)` in the same files | — | `src/app/games/[id]/summary/page.tsx:251–252,318–342`; `src/components/replay/ReplaySummary.tsx:65–66,89` |

So the same day's results render forest-green/terracotta in the reveal surfaces but vivid green/red in the Today's Five dots. The conventions comment at `globals.css:100–110` ("use `--success` (#178245) and #b42318") matches neither: `#b42318` is referenced only in that comment and inside one rgba in `src/app/daily/setup/TerritorySetupClient.tsx:1066` (`rgba(180,35,24,0.32)` — `#b42318` in disguise).

### 2b. Category hues — every live system

**System 1 — feed accent bars + avatars** (`src/components/feed/visual.ts:4–35`): 8 colors assigned by *hash of the category name* (`#1f3a5a` navy, `#d15e36` orange, `#6d837f` dark teal, `#7a9eaa` language-blue, `#8aa68a` science-sage, `#d9a82e` amber, `#9a6a4e` warm tan, `#adb19e` light teal). Job: the 2px top/left accent bar on every feed card (`src/components/feed/FeedCardShell.tsx:62–71` via `FeedCard.tsx:70,79,112`; `AnsweredByYouCard.tsx:239–252`) and avatar disc fills. There is **no stable Literature/Philosophy/… mapping** here — hue follows the hash, so renames reshuffle colors.

**System 2 — knowledge map / portrait** (`src/components/knowledge/PortraitCircles.tsx:58–119`, fallback hsl-hash at 121–132): the only true per-category map in the app:

| Category | primary | light | text |
|---|---|---|---|
| Literature | `#c0392b` | `rgba(192,57,43,0.12)` | `#8b1a0e` |
| Music | `#1a6b8a` | rgba(...,0.12) | `#0e4060` |
| Film & Television | `#6b3fa0` | ″ | `#3d1f6b` |
| Architecture & Design | `#b07d2e` | ″ | `#7a5010` |
| Food & Cuisine | `#2e8b57` | ″ | `#0e5c30` |
| Technology | `#3a6b8a` | ″ | `#1a3f5c` |
| Sports | `#c06b1a` | ″ | `#8b3e0e` |
| History | `#5a6b7a` | ″ | `#2a3f50` |
| Science | `#5a7a2e` | ″ | `#2a4a0e` |
| Philosophy | `#7a5a8a` | ″ | `#4a2a5c` |
| Pop Culture | `#8a2a4a` | ″ | `#5c0e2a` |
| Language | `#4a7a5a` | ″ | `#1e4e30` |

Consumed by `DomainCircle.tsx:51–61` (interest-circle fills/borders on the knowledge map), `CategoryCircles.tsx:91,191` (game/round summary circles, and the **"New territory" eyebrow rendered in the domain color** at `CategoryCircles.tsx:221–226`), `OverlapMap.tsx:250–260`, and re-exported as `getDomainColor` (`CategoryCircles.tsx:30–32`) into `src/components/games/interpretive-sections.tsx:55,85`.

**System 3 — share-card duplicate** (`src/components/knowledge/SharePortraitCard.tsx:25–41`): the same 12 hexes re-declared literally (documented as load-bearing for the html2canvas raster path), plus alias keys (`'Film & TV'`, `'Sport'`) the canonical map doesn't have.

**System 4 — "expanding territory" accents** (`src/components/knowledge/RecentlyExpanding.tsx:25–31`; trimmed copy at `src/components/feed/EditorialPromos.tsx:21–25`): red/gold/blue accents (`#c9564d`, `#a98a4c`, `#65a8bb` + text variants) assigned **by row position, not category**.

**System 5 — ceremony circles** (`src/app/ceremony/[ceremonyId]/page.tsx:83–99`): eight vivid 4-stop gradient palettes (`#ffe6a3/#f6b94a/#c96f1e`, `#c6f4ff/#56c7e8/#137ca7`, …) assigned by hash of domain name. Unrelated to systems 1–4.

Only two domains ever got CSS tokens: `--domain-language #7a9eaa` and `--domain-science #8aa68a` (globals.css:74–75) — and `--domain-science` is consumed not as a category hue but as the fill of the Today's Five catch-up button, with `--game-correct` text (`src/components/TodaysFiveCard.tsx:298–301`): a category token and a grading token deliberately blended in one control.

### 2c. The grading-vs-category collision (thesis question)

**Exact hex shared: NO.** The grading set {`#366045`, `#5d6f5b`, `#c96b4a`, `#c33d14`, `#178245`, `--destructive` oklch} intersects none of the five category palettes byte-for-byte.

**Near-hex: YES, repeatedly, in both directions:**

| Category-side value | Grading-side value | Verdict |
|---|---|---|
| `#c9564d` (expanding-territory red, RecentlyExpanding.tsx:26 / EditorialPromos.tsx:22) | `--game-wrong #c96b4a` | nearly identical terracottas — a *territory growth* accent reads as *wrong* |
| `#d15e36` (`--tri-orange`/`--brand-orange`; feed accent + triangle marks) | `--game-wrong #c96b4a` / `--game-wrong-strong #c33d14` | same orange-terracotta family |
| Literature `#c0392b` (PortraitCircles.tsx:60) | `--game-wrong-strong #c33d14` | close strong reds — a Literature circle/eyebrow reads as an error accent |
| Sports `#c06b1a` (PortraitCircles.tsx:90) | `--game-wrong #c96b4a` | close oranges |
| Language `#4a7a5a` / Science `#5a7a2e` / Food `#2e8b57` | `--game-correct #366045` / `-soft #5d6f5b` / `--success #178245` | category greens crowd the CORRECT greens |

And the semantic inversion noted in the summary: in the bundle/question triangle marks, **solid** (palette-colored, possibly `#d15e36`) = *unanswered/still to play* and **hollow gray** = *answered* (`src/components/activity/ActivityIcon.tsx:11–12,40,193–257`), while in every grading surface the filled orange family = *wrong*. A solid orange triangle therefore renders in (near) the WRONG color while meaning something else entirely.

### 2d. The warm gold(s): "BETWEEN US!", "NEW TERRITORY ·", HILITE

These are **several values, not one token**:

| Value | Job | Citations |
|---|---|---|
| `--tri-amber #d9a82e` | base gold: NEW TERRITORY ring (`55%` mix), inside-joke card wash (`12%`)/border (`40%`), NewTerritoryUndo rail/fill/chips, login underline/input border, ceremony pin, gameplay bonus card chrome | AnswerFeedbackSheet.tsx:161,282–283; NewTerritoryUndo.tsx:72–74,125–128; login/page.tsx:29, LoginPanel.tsx:19; CeremonyPin.tsx:15; GameplayChat.tsx:452–517,1243–1244 |
| `GOLD_INK` = mix(tri-amber 50%, brand-ink) | the **text** of "NEW TERRITORY ·" and the "Between us!" eyebrow (AA-darkened gold) — defined 3× (see §1b) | AnswerFeedbackSheet.tsx:167,288; NewTerritoryUndo.tsx:86,123; GameplayChat.tsx:517,1251 |
| `HILITE #e9c97a` | the highlighter swipe under the "Lately." headline — **its only use in the app** | lately/tokens.ts:10; app/activities/page.tsx:59 |
| `--tri-darkyellow #deae5c` | triangle-palette fill (activity marks, loading screen) | globals.css:80; ActivityIcon.tsx:34,49 |
| `--warning #b45309` / `--warning-border #e6c15a` / `--warning-surface #fdf6e6` | caution banners/chips | globals.css:163–165 |
| `#f0c060` | highlighted DomainCircle glow | DomainCircle.tsx:120 |
| `#d9b56c` / `#fff7e8` | knowledge-page caution chip | app/knowledge/page.tsx:645 |

Also inconsistent across surfaces: the feed reveal renders "New territory" in GOLD_INK, but the knowledge/game-summary surfaces render the same words in the **per-domain category color** (`CategoryCircles.tsx:221–226`; `interpretive-sections.tsx:79–91`).

---

## Section 3 — Type: actual stack

Fonts loaded via `next/font` in `src/app/layout.tsx`: Montserrat (`--font-sans-body`, lines 12–16, also `montserrat.className` on `<body>`, line 82), Playfair Display *italic only* (`--font-display`, 21–26), Cormorant Garamond 500/600/700 (`--font-cormorant`, 32–40), Caveat (`--font-caveat`, 43–47), Inter (`--font-inter`, 52–56).

| Role/var | Actual value | Defined at | Consumers |
|---|---|---|---|
| `--font-sans` | `var(--font-sans-body, ui-sans-serif, …)` → **Montserrat** | globals.css:53 (and self-referential `@theme` alias at :9) | `html` via `font-sans` (globals.css:263–265), body className; effectively the whole app |
| `--font-heading` | `var(--font-sans)` → Montserrat | globals.css:8 | **No consumers found** — orphaned alias |
| `--font-serif` | `var(--font-cormorant, Georgia, "Times New Roman", serif)` → **Cormorant Garamond** | globals.css:10 | every `font-serif` class: feed card category/question (`FeedCard.tsx:32,43`), Today's Five headline (`TodaysFiveCard.tsx:221–222`), reveal question/explanation (`AnswerFeedbackSheet.tsx:241,272,292`), etc. |
| `--font-literata` | `var(--font-cormorant, Georgia), "Times New Roman", serif` → **Cormorant** (the name is a fossil; Literata is not loaded) | globals.css:208 | ~20 inline `fontFamily` sites: GameplayChat (380,626,883,1094,…), knowledge/page (647,661,716,…), AnsweredByYouCard (183,266,304), CategoryCircles (232,328), QuickAddQuestionModal:138, etc. |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, …` — **no Courier New** | globals.css:204 | NewTerritoryUndo:81, CategoryCircles:219/244/259, interpretive-sections:8 |
| `--font-display` | **Playfair Display italic** | layout.tsx:21–26 | games summary:96, OverlapMap:62, Hero.tsx:15, RecentActivitySection.tsx:19, lately `FS` (tokens.ts:17 → activities/page.tsx:40,70); hand-loaded for the share raster (SharePortraitModal.tsx:10–51) |
| `--font-caveat` | Caveat | layout.tsx:43–47 | **None.** Only reference is `FH` (lately/tokens.ts:19), which no file imports — Caveat is downloaded on every page and never rendered |
| `--font-inter` | Inter | layout.tsx:52–56; surfaced at globals.css:11 | exactly two: login subtitle (`app/login/page.tsx:30`), LoadingScreen label (`LoadingScreen.tsx:155`) |
| `--font-neutral` | `var(--font-sans-body, …)` → **Montserrat** (alias of sans) | globals.css:203 | game summary (35), RoundReminderCard:16, daily summary:40, knowledge/page (541,591,592,646,674,675), KnowledgeOverviewClient (263,276,286), ProgressionLandscape (288,306,326), ReplaySummary (31,50), OverlapMap:175, interpretive/game-details sections |
| `--font-script` | **does not exist** — no such var anywhere in `src/` | — | — |

**Orphaned / off-set faces** (vs. the intended Montserrat / Source Serif / Courier / Caveat set):

- **Source Serif: absent entirely.** The live serif is Cormorant Garamond. Where a doc or token name says Literata, it also resolves to Cormorant (globals.css:205–208).
- **Georgia as a primary face** (not a fallback): hardcoded `'Georgia, serif'` in ActivityStreamItem.tsx:65,336,574,618,669; InlineAnswerFlow.tsx:95; `'Georgia', serif` as `G_FF` in interpretive-sections.tsx:34; `Georgia, "Times New Roman", serif` in GameplayChat.tsx:507. Also `FI = 'Georgia, var(--font-display), serif'` (lately/tokens.ts:18) — **defined, never imported**.
- **Courier New as a literal**, bypassing `--font-mono`: `FM = '"Courier New", ui-monospace, monospace'` (lately/tokens.ts:16) used across the activity stream (ActivityStreamItem.tsx:118,353,433,521,631,710; ActivityStream.tsx:81; DirectQuestionAnswer.tsx:87,101; InlineAnswerFlow.tsx:115; DayDivider.tsx:17); `"'Courier New', monospace"` again in SharePortraitCard.tsx:21 (intentional raster) and KnowledgeOverviewClient.tsx:305; Tailwind arbitrary `font-['Courier_New',monospace]` at app/knowledge/page.tsx:635. So the app has **two mono registers**: the tokened ui-monospace stack and a literal Courier New family.
- **Caveat: loaded, unused** (above). **Inter: loaded for two small uses.** **Playfair: real but tiny** (5 consumers + the raster path).

**F4.2 (`--font-sans`/`--font-neutral` → Montserrat): RESOLVED in live code.** Both resolve to `var(--font-sans-body)` = Montserrat (globals.css:53,203; layout.tsx:12–16). Residual wart: the self-referential `--font-sans: var(--font-sans)` at globals.css:9.

**F4.3 (INK / CREAM / HILITE values): PARTIALLY RESOLVED.** Live values: `INK = #0a1f3d` (lately/tokens.ts:4, matches `--brand-ink`), `CREAM = #fcf8f2` (tokens.ts:7, matches `--brand-cream-page` but **collides with the CSS `--cream` = #fdfcfb**, globals.css:183), `HILITE = #e9c97a` (tokens.ts:10 — TS-only, no CSS token, one consumer). The constants are brand-aligned (the F4.3 ask) but remain a parallel TS token system with one name/value conflict.

**F5.4:** ignored per the brief.

---

## Section 4 — Type: the descriptor voice

The prototype's descriptor phrases ("keeps finding new corners", "has been on a curious streak") **do not exist in live code**. The live equivalents are the milestone breadth line `" has been on a streak — "` (`src/lib/activity-stream.ts:810–817`) and the convergence caption pool (e.g. `'You and {Name} keep meeting in the same corners'`, `src/lib/lately.ts:98`).

**Exact live declaration:** these lines are *not* an italic serif register. The sentence body is emitted as plain `text` parts and rendered with **no fontFamily of its own** — it inherits Montserrat (the row `<p>` at `ActivityStreamItem.tsx:321–331`; in the per-person cluster, `SubLine` explicitly sets `fontFamily: FF` = Montserrat, `PersonActivityCard.tsx:68–74`). Only the **domain/category names inside the line** are emitted as `category` parts and rendered as:

```tsx
// src/components/activity/ActivityStreamItem.tsx:64–68
<span key={i} style={{ fontFamily: 'Georgia, serif', color: INK2 }}>
```

— upright (non-italic) **hardcoded Georgia**, ink-700 `#3a4a5f`. The `secondLine` under feed rows is the same upright Georgia at 14px (`ActivityStreamItem.tsx:336–347`). Italic Georgia appears only for *quoted question text* in reveals (`ActivityStreamItem.tsx:574–582,618–625,669–676`).

**Conclusion:** the descriptor voice is a **separately specified face, not an italic of an existing role** — raw Georgia, bypassing both `--font-serif` (Cormorant) and `--font-display` (Playfair). It is an undocumented register: the constant meant to express it (`FI = 'Georgia, var(--font-display), serif'`, lately/tokens.ts:18) exists but is never used; the components hardcode the string instead. This contradicts any doc that calls the descriptor line "the serif italic."

---

## Section 5 — Off-system inventory (the ratchet baseline)

Sweep of `src/` excluding tests, `globals.css`, and `lately/tokens.ts` (the definition files). Full per-line listing gathered during the audit; condensed here to the files that matter. **Baseline total: ≈390 off-system occurrences.**

| Bucket | Count | Where it concentrates |
|---|---|---|
| Hardcoded hex in app/component code | **235** | PortraitCircles.tsx (36 — the domain map), SharePortraitCard.tsx (19 — intentional raster), feed/visual.ts (16), LoadingScreen.tsx (10), DomainCircle.tsx (11 — `#f5f0e8`, `#0a1f3d`, `#d4cfc7`, `#c8c0b0`, `#f0c060`), ActivityIcon.tsx (10, comments only), RecentlyExpanding.tsx (9), ceremony page (24 gradient hexes across 9 lines), EditorialPromos.tsx (4), common-ground-circles.tsx (2), FeedEmptyArt.tsx (5 SVG fills), KnowledgeOverviewClient.tsx (6), knowledge/page.tsx (6), ReplaySummary.tsx (2 × `#111111`), debug/dev pages (~50: app/dev/points-diagnostic/*, app/feed/debug/*) |
| Raw `rgb()/rgba()/hsl()` in .ts/.tsx | **77** | mostly warm-ink shadow/stroke tuples `rgba(40,32,30,…)` (FeedCardShell.tsx:17,28,29; TodaysFiveCard.tsx:204; ActivityStreamItem.tsx:266–268; knowledge/page.tsx ×6; KnowledgeCard.tsx:145), modal scrims `rgba(0,0,0,0.4)` (AnswerFeedbackSheet.tsx:394, ReportReasonSheet.tsx:109, AddFriendRequestModal.tsx:130, QuickAddQuestionModal.tsx:111,131), TerritorySetupClient.tsx ×6 (`rgba(26,18,8,…)`, `rgba(180,35,24,0.32)`), PortraitCircles light-variant tuples ×17, dynamic `hsl()` generators (PortraitCircles.tsx:128–130, SharePortraitCard.tsx:48–49) |
| Tailwind arbitrary **raw-color** values | **7** | LoadingScreen.tsx:101,150,154,155 (`bg-[#E8DCC0]`, `bg-[#F5EBD3]`, `bg-[#1a1208]/20`, `text-[#1a1208]/70`); app/knowledge/page.tsx:631,645,793 (`text-[#8b1a0e]`, `border-[#c0392b]/40`, `bg-[#fff7e8]`, `border-[#d9b56c]`) — note `text-[var(--…)]` arbitrary values are tokenized and were not counted |
| Raw font-family declarations (no `--font-*` first) | **71** | `'Georgia, serif'` ×6 (ActivityStreamItem ×5, InlineAnswerFlow:95); Courier-New constants (lately/tokens.ts FM consumers ×~12, SharePortraitCard FM ×7, interpretive-sections G_FM ×5, KnowledgeOverviewClient:305); bare `monospace`/`system-ui` in dev/debug pages (~27: points-diagnostic ×15, feed/debug ×13); `font-['Courier_New',monospace]` (knowledge/page.tsx:635) |
| Email templates (separate — inline CSS required, vars impossible) | 18 hex | `src/server/email/templates/verify-email.ts:26–57` (7), `daily-reminder.ts:45–90` (11) — note the email palette (`#f7f5f0`, `#e5e1d8`, `#111111`, `#6b6760`, `#8a857b`) is *yet another* warm ramp matching no app token |
| Test fixtures (excluded from baseline) | 4 | `feed/__tests__/FeedCards.test.tsx` (`#abc123`) |

Notable inside the count: the entire five-way category-color sprawl of §2b is hex-literal (only 2 of ~30 category hues have tokens); the warm shadow `rgba(40,32,30,…)` recurs in ≥8 files at 3 opacities and is the most ratchet-able single value in the codebase; the debug/dev pages (~80 of the 390) could be carved out of any ratchet target if they're considered internal tooling.

---

## Where live code contradicts the PRD / prototype (explicit)

1. PRD typography spec'd **Inter**; live body font is **Montserrat** — already documented as an intentional product choice (`src/app/layout.tsx:10–11`).
2. The intended serif of the "Montserrat / Source Serif / Courier / Caveat" set: **Source Serif ships nowhere**; the live serif is Cormorant Garamond, and the descriptor register is raw Georgia (§3, §4).
3. **Caveat is part of the intended set but is dead weight in live code** — loaded, zero renders (§3).
4. The prototype's feed triangle premise ("hue = category") is false in live code — hue is a decorative deterministic hash; only solid/hollow carries meaning, and it means *unanswered/answered*, not completion-filled (§2c).
5. "BETWEEN US!" / "NEW TERRITORY" gold is not one token: tri-amber + a thrice-duplicated GOLD_INK mix + the unrelated HILITE constant + per-domain color on knowledge surfaces (§2d).

## Done-when checklist

- [x] Sections 1–5 complete with file+line citations from live code.
- [x] F4.2: **resolved** in live code. F4.3: **partially resolved** (TS constants brand-aligned; CREAM name/value conflict and TS-only HILITE remain).
- [x] Grading-vs-category collision answered with hexes: **no exact match; multiple near-hex collisions** (`#c9564d`↔`#c96b4a`, `#d15e36`↔`#c96b4a/#c33d14`, `#c0392b`↔`#c33d14`, knowledge greens ↔ correct greens) plus a solid-triangle semantic inversion.
- [x] No source files modified; this report is the only artifact.
