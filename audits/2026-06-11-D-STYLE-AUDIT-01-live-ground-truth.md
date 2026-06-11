# D-STYLE-AUDIT-01 — Live Style Ground-Truth Audit

**Date:** 2026-06-11
**Scope:** Read-only inventory of every color and font *actually in use in live code*, mapped to job, with collisions flagged.
**Method:** All values read from live source. The PRD and the prototype `.jsx` were NOT consulted for any value — where they disagree with code, code wins.
**No files were modified by this audit.** This report is the only artifact.

---

## Findings summary (top drifts)

1. **GRADING ↔ CATEGORY COLLISION IS REAL in the shipping (default) palette — YES.**
   - WRONG grading `--game-wrong-strong: #c33d14` (`globals.css:104`) sits essentially on top of category **Literature `--cat-literature: #c0392b`** (`globals.css:114`) — R/G/B delta of only ~(3,4,23). To the eye these are the same red.
   - WRONG `--game-wrong: #c96b4a` (terracotta) and the brand/solid-triangle orange `--brand-orange/--tri-orange: #d15e36` (`globals.css:65,80`) are the same burnt-orange family as category **Sports `--cat-sports: #c06b1a`** (`globals.css:126`).
   - CORRECT grading `--game-correct: #366045` (`globals.css:102`) shares the muted-forest-green family with categories **Language `#4a7a5a`**, **Science `#5a7a2e`**, **Food `#2e8b57`** (`globals.css:136,130,122`).
   - **Net:** a category triangle/circle CAN render in a hue indistinguishable from "you got it wrong" today. This is the thesis-critical collision, and it is present in the default theme.

2. **A fix exists in code but is OFF by default and marked "remove before shipping."** The `:root[data-palette="proposed"]` block (`globals.css:283–309`) moves WRONG to a true red `#c1121f`, Literature to bordeaux `#7d2c3f`, and Language to teal `#2e6e7e` — explicitly to de-collide. It is gated behind a `<PaletteToggle>` dev control (`layout.tsx:5–7,70–75`) and the file header says "Remove this block and the component before merging to a shipping branch" (`globals.css:281`). So the de-collision is a *preview*, not the live default.

3. **The category scale is defined TWICE with the same hex, one tokenized and one hardcoded.** `--cat-*` tokens (`globals.css:114–137`) and `PortraitCircles.tsx:62–75` route through the tokens, but `SharePortraitCard.tsx:25–41` hardcodes the identical hex literals (`#c0392b`, `#1a6b8a`, …) because it renders an OG/share image. The palette toggle cannot flip the share card, and any future hue change must be made in two places.

4. **F4.2 is RESOLVED; F4.3 is PARTIAL.** `--font-sans` and `--font-neutral` both resolve to Montserrat (via `--font-sans-body`). INK/CREAM/HILITE all resolve to real brand tokens (navy ink, content-card cream, gold-mix highlight) — but "CREAM" is overloaded across three near-white values and HILITE/gold has multiple registers (see §2/§3).

5. **`--font-script` does not exist in live code, and the "mono" voice is a sans.** No `--font-script` token, no Caveat/script face is loaded anywhere (`grep`: 0 hits). `--font-mono` resolves to the Montserrat sans stack (`globals.css:261`); the only surviving literal `'Courier New'` is in the share-card canvas (`SharePortraitCard.tsx:21`). Orphan faces (Georgia, Times) survive only as fallback tails inside the serif var.

---

## Section 1 — Color: actual values

All tokens defined in `src/app/globals.css`. Hex is the literal where given; otherwise the var it resolves to.

| Token | Value | Line |
|---|---|---|
| `--brand-ink` | `#0a1f3d` | 59 |
| `--brand-ink-950` | `#091729` | 60 |
| `--brand-ink-700` | `#3a4a5f` | 61 |
| `--brand-ink-400` | `#8a8a8a` | 62 |
| `--brand-navy` | `#1f3a5a` | 63 |
| `--brand-link` | `#4a5d75` | 64 |
| `--brand-orange` | `#d15e36` | 65 |
| `--brand-cream` | `#f8e6c7` | 66 |
| `--brand-cream-page` | `#fcf8f2` | 67 |
| `--brand-card` | `#fdfcfb` | 68 |
| `--brand-cream-card` | `#fbf5e9` | 69 |
| `--brand-border` | `#e9e2d2` | 70 |
| `--brand-rule` | `rgba(60,50,40,0.14)` | 71 |
| `--domain-language` | `#7a9eaa` | 72 |
| `--domain-science` | `#8aa68a` | 73 |
| `--tri-orange` | `#d15e36` | 80 |
| `--tri-cream` | `#f8e6c7` | 81 |
| `--tri-darkteal` | `#6d837f` | 82 |
| `--tri-lightteal` | `#adb19e` | 83 |
| `--tri-darkyellow` | `#deae5c` | 84 |
| `--tri-lighttan` | `#edd2a3` | 85 |
| `--tri-amber` | `#d9a82e` | 86 |
| `--accent-gold` | `#d9a82e` | 92 |
| `--accent-gold-ink` | `color-mix(accent-gold 50%, brand-ink)` | 95 |
| `--game-card-question` | `#faf4e9` | 100 |
| `--game-correct` | `#366045` | 102 |
| `--game-correct-soft` | `#5d6f5b` | 103 |
| `--game-wrong` | `#c96b4a` | 104 |
| `--game-wrong-strong` | `#c33d14` | 105 |
| `--cat-literature` / `-text` | `#c0392b` / `#8b1a0e` | 114–115 |
| `--cat-music` / `-text` | `#1a6b8a` / `#0e4060` | 116–117 |
| `--cat-film-tv` / `-text` | `#6b3fa0` / `#3d1f6b` | 118–119 |
| `--cat-architecture` / `-text` | `#b07d2e` / `#7a5010` | 120–121 |
| `--cat-food` / `-text` | `#2e8b57` / `#0e5c30` | 122–123 |
| `--cat-technology` / `-text` | `#3a6b8a` / `#1a3f5c` | 124–125 |
| `--cat-sports` / `-text` | `#c06b1a` / `#8b3e0e` | 126–127 |
| `--cat-history` / `-text` | `#5a6b7a` / `#2a3f50` | 128–129 |
| `--cat-science` / `-text` | `#5a7a2e` / `#2a4a0e` | 130–131 |
| `--cat-philosophy` / `-text` | `#7a5a8a` / `#4a2a5c` | 132–133 |
| `--cat-pop-culture` / `-text` | `#8a2a4a` / `#5c0e2a` | 134–135 |
| `--cat-language` / `-text` | `#4a7a5a` / `#1e4e30` | 136–137 |
| `--primary-foreground` | `#fbf4e3` | 168 |
| `--secondary` / `--muted` / `--accent` | `#f1ebdd` | 169,171,173 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | 175 |
| `--success` | `#178245` | 202 |
| `--danger` | → `--destructive` | 203 |
| `--warning` / `-surface` / `-border` | `#b45309` / `#fdf6e6` / `#e6c15a` | 214–216 |
| `--success-surface/-border` | color-mix of `--success` | 217–218 |
| `--destructive-surface/-border` | color-mix of `--destructive` | 219–220 |
| `--editorial-parchment/-sage/-slate` | color-mix washes | 226–228 |
| `--ink` (legacy alias) | → `--brand-ink` | 233 |
| `--cream` (legacy alias) | → `--brand-card` `#fdfcfb` | 234 |
| `--cream-warm` | → `--brand-cream-card` `#fbf5e9` | 235 |
| `--cream-accent` | → `--brand-cream` `#f8e6c7` | 236 |
| `--border-light` | `#eee7d8` | 238 |
| `--warm-ink` / `-700` / `-500` / `-400` | `#1a1208`/`#696257`/`#7d7568`/`#8a8070` | 246–249 |
| `--warm-border` / `-soft` | `#e8e2d6` / `#ddd6c7` | 250–251 |
| `--warm-paper` / `--warm-cream` | `#faf8f2` / `#f5f0e8` | 252–253 |
| `--user-bubble` / `-foreground` | `oklch(0.62 0.18 250)` / `oklch(0.99 0 0)` | 200–201 |

### Tokens defined more than once

| Token | Definitions | Differ? |
|---|---|---|
| `--font-serif` | `@theme` `globals.css:9` and `:root` `:266` | No — identical value (intentional mirror so inline `var(--font-serif)` resolves). |
| `--cat-literature`, `--cat-literature-text`, `--cat-language`, `--cat-language-text` | `:root` `114/115/136/137` and `:root[data-palette="proposed"]` `305–308` | **Yes, by design** — the proposed-palette override changes them when the dev toggle is on. Not a bug; a gated preview. |
| Category hex (`#c0392b`, `#1a6b8a`, etc.) | `:root --cat-*` and `SharePortraitCard.tsx:25–41` (raw literals) | **Yes — duplicated source of truth.** Same values today; will silently drift. |
| `.dark` overrides for editorial washes | `globals.css:347–349` | Expected dark-mode variant. |

---

## Section 2 — Color: actual usage → job

### Grading (RIGHT / WRONG) — the reserved scale

| Result | Token(s) | Value | Where used | Job |
|---|---|---|---|---|
| RIGHT | `--game-correct` | `#366045` | `AnswerFeedbackSheet.tsx:210,212,220,227,250,331–333`; `GameplayChat.tsx` result rails | label text, rail, success wash base |
| RIGHT (muted) | `--game-correct-soft` | `#5d6f5b` | muted correct labels | secondary correct |
| WRONG (signal) | `--game-wrong-strong` | `#c33d14` | `AnswerFeedbackSheet.tsx:211,212,220,345,378` | wrong label + rail |
| WRONG (wash) | `--game-wrong` | `#c96b4a` | result-card background mixes | incorrect-card fill base |

Grading is consistently tokenized in the answer-reveal surface — no raw hex for RIGHT/WRONG in `AnswerFeedbackSheet.tsx`. Good.

### Category hues — actual usage

| Surface | Source | Notes |
|---|---|---|
| Knowledge map circles / dividers | `PortraitCircles.tsx:62–75` `DOMAIN_COLORS` → `var(--cat-*)` | Routed through tokens; palette toggle flips them. |
| Feed category accent / triangles | `feed/visual.ts:37–47` `colorForCategory()` → `getPortraitDomainColor(broad).primary` | Resolved categories ride the `--cat-*` scale via PortraitCircles. |
| Feed fallback hash palette | `feed/visual.ts:7–16` `CATEGORY_COLORS` (8 raw hex) | **Off-token literals** — only the fallback for items with no resolved broad category; includes `#d15e36`, `#d9a82e`, `#6d837f`, etc. |
| Avatar colors | `feed/visual.ts:18–25` `AVATAR_COLORS` (6 raw hex) | Off-token literals. |
| Share / OG card | `SharePortraitCard.tsx:25–41` | **Duplicate hardcoded category hex** (canvas render, can't read CSS vars). |
| Activity icon triangles | `ActivityIcon.tsx:30–49` | Tokenized (`var(--tri-*)`); the `#…` after each are explanatory comments, not literals. |

### Grading ↔ category collision — answered with hex

**YES, present in the default palette.**

| Grading value | Nearest category value | Verdict |
|---|---|---|
| WRONG-strong `#c33d14` (105) | Literature `#c0392b` (114) | Near-identical red — direct collision |
| WRONG `#c96b4a` / orange `#d15e36` (104/65) | Sports `#c06b1a` (126) | Same burnt-orange family |
| CORRECT `#366045` (102) | Language `#4a7a5a` (136), Food `#2e8b57` (122), Science `#5a7a2e` (130) | Same muted-green family |

The `data-palette="proposed"` block (283–309) is the *only* place this is resolved, and it is dev-gated + flagged for removal before ship.

### Warm accent / "BETWEEN US!" / "NEW TERRITORY" gold vs. HILITE — one token or several?

**Several registers off one base value.** The base gold is `--accent-gold: #d9a82e` (92), which is the *same hex* as `--tri-amber` (86) but a deliberately separate JOB token.

| Use | Declaration | Where |
|---|---|---|
| "New territory" eyebrow text | `--accent-gold-ink` = `color-mix(accent-gold 50%, ink)` (AA-darkened) | `globals.css:95`; consumed as `GOLD_INK` in `AnswerFeedbackSheet.tsx:16,167,288`, `NewTerritoryUndo.tsx:15`, `GameplayChat.tsx:182` |
| Gold rails / fills / rings | raw `var(--accent-gold)` + color-mix tints | `AnswerFeedbackSheet.tsx:161,282,283`; `NewTerritoryUndo.tsx:72–74,125,128`; `GameplayChat.tsx:452,466,479,487,515,1243,1244`; `CeremonyPin.tsx:15`; `DomainCircle.tsx:120` |
| HILITE reading-surface highlighter ("Lately." swipe) | `color-mix(accent-gold 55%, brand-cream-page)` | `lately/tokens.ts:17` |
| Loader / login accent bar | `var(--tri-amber)` / `var(--accent-gold)` | `LoadingScreen.tsx:196`; `login/page.tsx:29` |

So: **one base gold value (`#d9a82e`), surfaced as three distinct jobs** — accent (`--accent-gold`), AA text-on-cream (`--accent-gold-ink`), decorative triangle (`--tri-amber`) — plus a per-call `color-mix` for the reading-surface HILITE tint. The text eyebrow and the reading-surface tint are NOT the same token.

---

## Section 3 — Type: actual stack

Fonts loaded via `next/font/google` in `layout.tsx:2,15–43`: **Montserrat**, **Playfair Display** (italic only), **Cormorant Garamond**. Applied on `<html>` at `layout.tsx:67`.

| Role / var | Resolves to | Defined | Consumers |
|---|---|---|---|
| `--font-sans` | `--font-sans-body` → **Montserrat**, then ui-sans-serif/system-ui | `globals.css:51`; var from `layout.tsx:17` | app-wide body (`html { @apply font-sans }` `:360`) |
| `--font-neutral` | `--font-sans-body` → **Montserrat** | `globals.css:254` | `RefineYourGame.tsx:12`, `OverlapMap.tsx:175`, `knowledge/page.tsx` |
| `--font-mono` | `--font-sans-body` → **Montserrat** (typewriter retired) | `globals.css:261` | ~40 `FM` / `var(--font-mono)` System-voice labels (caps + letterspacing) |
| `--font-serif` | `--font-cormorant` → **Cormorant Garamond**, then Georgia/Times fallback | `globals.css:9,266` | feed/answer question + explanation text, activity headline names + category names |
| `--font-display` | **Playfair Display** italic | `layout.tsx:27` | editorial italic register — `PortraitCircles`, `OverlapMap.tsx:62`, `games/[id]/summary/page.tsx:96`, `lately FS` |
| `--font-heading` | `var(--font-sans)` → Montserrat | `globals.css:8` | alias; little/no direct use |
| `--font-script` | **DOES NOT EXIST** | — | No definition, no consumer, no Caveat/script face loaded |

### Orphaned / fallback faces

| Face | Status |
|---|---|
| **Georgia / "Times New Roman"** | Only as fallback tails inside `--font-serif` / `--font-display` (`globals.css:9,266`; `OverlapMap.tsx:62`). Not loaded; harmless fallbacks. |
| **'Courier New'** | Live literal only in `SharePortraitCard.tsx:21` (`FM`, canvas OG render). The app-wide System/mono voice no longer uses it (`globals.css:255–261`). |
| **Inter, Instrument Sans, Literata** | **None present** — 0 hits in `src/`. (PRD spec'd Inter; live code uses Montserrat — see `layout.tsx:13–14` intentional comment.) |
| **Playfair Display** | Loaded, italic-only, intentional editorial register (`layout.tsx:24–29`). Not orphaned. |

### F4.2 / F4.3 status against live code

- **F4.2 (`--font-sans` / `--font-neutral` → Montserrat): RESOLVED.** Both resolve to `--font-sans-body` = Montserrat (`globals.css:51,254`; `layout.tsx:15–19`). The intentional swap away from the PRD's Inter is documented at `layout.tsx:13–14`.
- **F4.3 (INK / CREAM / HILITE values): PARTIAL.**
  - INK = `--brand-ink` = **`#0a1f3d`** (navy) (`globals.css:233,59`). Resolved/consistent.
  - CREAM is **overloaded**: `--cream` → `--brand-card` `#fdfcfb` (content card), `--cream-warm` → `#fbf5e9` (entry surfaces), `--cream-accent` → `#f8e6c7`, and `--brand-cream-page` `#fcf8f2` (page). Four near-white values, three of them called "cream" (`globals.css:234–236,67`; `lately/tokens.ts:4–8`). Disambiguated by job but still a single overloaded word.
  - HILITE is **not a token** — it's an inline `color-mix(accent-gold 55%, cream-page)` in `lately/tokens.ts:17`, derived from the gold. Resolved in value, but lives outside the token block.

---

## Section 4 — The descriptor voice

The friend-activity descriptor lines (the live templates are e.g. `' has been on a tear through '`, `' has been on a streak — '` — `activity-stream.ts:784–800`; the prompt's "keeps finding new corners" phrasing is intent, not a live string) render as follows:

| Part | Declaration | File:line | Voice |
|---|---|---|---|
| Connective descriptor text ("has been on a tear through") | plain `<span>{part.v}</span>` — **no fontFamily**, inherits body | `ActivityStreamItem.tsx:114` | **Sans (Montserrat)** — the surrounding body voice |
| Per-person rolled-up SubLine | `fontFamily: FF` (= `var(--font-sans-body)`) | `PersonActivityCard.tsx:70`; `lately/tokens.ts:22` | **Sans (Montserrat)** |
| Embedded category name within the line | `fontFamily: 'var(--font-serif)'` (Cormorant), `fontSize: 1.05em`, **not italic** | `ActivityStreamItem.tsx:104–108` | Editorial serif, upright |
| Headline actor name | `fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 22` | `ActivityStreamItem.tsx:80–87` | Editorial serif, upright |
| Quoted question text (in expansions) | `fontFamily: 'var(--font-serif)', fontStyle: 'italic'` | `ActivityStreamItem.tsx:786–787, 837–838` | **Serif italic** |

**Conclusion:** The descriptor sentence itself is **the sans body voice (Montserrat via `FF`/inherited), not a separate face and not an italic.** The only serif italic in this surface is reserved for *quoted question text*, not the descriptor. Category names embedded in the descriptor are upright Cormorant serif. So there is **no undocumented descriptor register** — it is the existing Interface-sans voice with serif category tokens spliced in.

---

## Section 5 — Off-system inventory (drift surface)

Raw grep `#[0-9a-fA-F]{3,6}` across `src/**/*.{ts,tsx}` returns **209 matches** — but a meaningful fraction are **hex inside comments documenting a `var(--token)`** (e.g. `ActivityIcon.tsx:30–49`), not live color literals. The ratchet should count *executed* literals. The real drift, by area:

### Legitimately exempt (cannot read CSS vars)
| File | ~count | Why |
|---|---|---|
| `components/knowledge/SharePortraitCard.tsx` | 19 (`:16–22,25–41`) | OG/canvas share image — also the duplicate `--cat-*` scale + `'Courier New'` + `'Playfair Display'` literals |
| `server/email/templates/*.ts` | ~18 (`daily-reminder.ts` 11, `verify-email.ts` 7) | HTML email — no CSS var support |

### Non-shipping (dev/debug)
| File | ~count |
|---|---|
| `app/feed/debug/friend-coverage/page.tsx` | 22 |
| `app/dev/points-diagnostic/PointsDiagnosticTable.tsx` + `page.tsx` | 26 |
| `components/dev/PaletteToggle.tsx` | 8 |
| `feed/__tests__/FeedCards.test.tsx` | 4 |

### Real production-surface drift (the ratchet target)
| File:line | Literal(s) | Job |
|---|---|---|
| `feed/visual.ts:7–16` | 8 hex `CATEGORY_COLORS` | feed fallback category hash palette |
| `feed/visual.ts:18–25` | 6 hex `AVATAR_COLORS` | avatar colors |
| `feed/visual.ts:43,50` | `#9ca3af` | gray fallback |
| `knowledge/PortraitCircles.tsx` | 12 hits (`hashColor` hsl + fallbacks) | unknown-domain hash |
| `knowledge/DomainCircle.tsx:58,60,61,85,88,123,158,166,181,186` | `#f5f0e8`,`#0a1f3d`,`#d4cfc7`,`#c8c0b0`,`#8a8a8a` | **duplicates of navy ink / warm cream / borders that already have tokens** |
| `knowledge/KnowledgeOverviewClient.tsx` | 6 | knowledge surface |
| `knowledge/RecentlyExpanding.tsx` | 4 |  |
| `app/knowledge/page.tsx:541,631,635,793,868` | `text-[#111111]`, `text-[#8b1a0e]`, `border-[#c0392b]`, `bg-[#0e0e0e]`, `border-[#c8c0b0]` | **Tailwind arbitrary values** — near-black + literal category red bypassing `--cat-literature` |
| `LoadingScreen.tsx:142` | `bg-[#E8DCC0]` | Tailwind arbitrary value |
| `components/home/FeedEmptyArt.tsx` | 5 |  |
| `components/profile/RecentlyExploringSection.tsx` | 6 |  |
| `activity/ActivityIcon.tsx` | tokenized (comments only) | not real drift |

### Off-token font-family literals
| File:line | Literal |
|---|---|
| `knowledge/SharePortraitCard.tsx:21–22` | `'Courier New', monospace` / `'Playfair Display', Georgia, serif` |
| `OverlapMap.tsx:62`, `games/[id]/summary/page.tsx:96` | `'Playfair Display'` inside `var(--font-display, …)` fallback (acceptable) |
| `app/knowledge/page.tsx:541` | `font-[var(--font-neutral)]` (Tailwind arbitrary — token-backed but bypasses utility) |

**Starting number for the ratchet:** ~209 raw hex matches total; subtract comment-documentation hits (~10–15) and legitimately-exempt email/OG/dev surfaces (~70) and the **shippable-component drift to drive toward zero is on the order of ~90–110 literals**, concentrated in `feed/visual.ts`, the `knowledge/*` components, and `app/knowledge/page.tsx` Tailwind arbitrary values. Font-family drift is essentially **one file** (`SharePortraitCard.tsx`).

---

## Done-when checklist

- [x] All five sections complete with file+line citations from live code.
- [x] F4.2 reported: **RESOLVED**. F4.3 reported: **PARTIAL** (INK resolved; CREAM overloaded; HILITE is an inline mix, not a token).
- [x] Grading-vs-category collision answered with actual hex: **YES** — `--game-wrong-strong #c33d14` ≈ `--cat-literature #c0392b`; CORRECT `#366045` shares the green family with Language/Food/Science; the fix exists only in the dev-gated `data-palette="proposed"` block.
- [x] No files modified (besides writing this report).
