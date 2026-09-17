# Joshing Style Guide — Color (Part 2 of 2)

**Status:** frame and rules locked against live code via `D-STYLE-AUDIT-01` (2026-06-11) and the gold-density study. Specific hex values for the category scale and the new WRONG-red are marked _(set)_ where a value still needs to be chosen against the real domain list — the *rules* are build-ready now. Corrective calls vs. live code are flagged → FIX. Pairs with `STYLE-GUIDE-TYPE.md`; the friend card is the shared test surface across both halves.

---

## The core idea: color sorts by job, and the jobs don't share values

Type had three voices. Color has **five jobs**, and the whole discipline is that a value does exactly one job. The live code drifted because one job's color leaked into another's (warm-red doing wrong *and* link *and* category-adjacent; gold doing six things). The guide fixes that by naming the jobs and reserving values to them.

| Job | What it is | Reserved? |
|---|---|---|
| **Grading** | Correct / wrong on an answer | **Reserved** — used nowhere else, ever |
| **Neutrals** | Ink, cream, surfaces, borders — the editorial ground | Shared, but one value per token |
| **Category** | Which top-level domain a thing belongs to | A small fixed scale, designed off grading |
| **Accent (gold)** | Highlight the single most notable thing in view | One value, scarcity-bound |
| **Link / brand** | Interactive text + brand orange | One value (orange), freed by moving wrong off it |

The thesis test for the whole system: **nothing that isn't a graded answer may render in a grading color.** If a category triangle, a link, or a decorative mark ever reads as "wrong," the color system has betrayed the product promise.

---

## 1. GRADING — reserved, and WRONG moves to a true red

**The most important rule in the document.** Correct and wrong are sacred signals. They appear only on answer results — never on a category, a link, a marker, a surface, or decoration.

**The change:** WRONG moves **out of the orange/terracotta family into a true red.** Live code has WRONG as `--game-wrong #c96b4a` / `--game-wrong-strong #c33d14` — both terracotta, sitting in the same family as the brand/link orange `#d15e36` and the territory accent `#c9564d`. That overload is why orange feels like it's doing too much. Pulling WRONG to a clear red:
- removes every near-hex collision the audit found in one move,
- frees orange to be cleanly **link + brand**,
- makes the solid-orange "still to play" triangle stop reading as failure — *without* having to touch the triangle, because the failure color is simply no longer orange.

| Token | Current | Target |
|---|---|---|
| `--game-wrong` | `#c96b4a` (terracotta) | **`#a93b3b`** — muted brick, the wash/fill base (result-card backgrounds at 8–12%) |
| `--game-wrong-strong` | `#c33d14` | **`#c1121f`** — the signal: rail + label text, a clear true red |
| `--game-correct` | `#366045` | keep — but **confirm it clears the knowledge greens** (`#5a7a2e`, `#4a7a5a`, `#2e8b57`); if any crowd it, the *category* green moves, not the grading green |

**Per the existing WCAG note:** correct/wrong must never be carried by color alone — always paired with a label or mark. The new red doesn't change that; it just makes the color half unambiguous.

→ FIX: retire `--destructive` (`oklch(...)`, a third red) and `--success #178245` (a second green) as grading signals — consolidate to `--game-wrong` / `--game-correct` so there is exactly one wrong and one correct value.

---

## 2. NEUTRALS — one value per token

The editorial ground: ink, cream, card surfaces, borders. These are shared across everything (that's fine — they're the paper, not a signal), but each token must resolve to **one** value.

→ FIX (from audit): `CREAM` has a name/value conflict — the TS constant `CREAM #fcf8f2` (matches `--brand-cream-page`) collides with the CSS `--cream #fdfcfb`. Pick one, point both names at it. Reconcile the parallel TS token system (`lately/tokens.ts`) against the CSS tokens generally — they should not be two sources of truth.

Ink ramp (`--brand-ink` `#0a1f3d` and its 700/400 steps) and the cream/border ramp stay as-is once deduplicated. Descriptor text uses the softened ink step (ink-700 `#3a4a5f`), per the type guide.

---

## 3. CATEGORY — color = top-level domain

**The rule:** color attaches to the **top-level domain**, not the leaf interest. Literature is one hue whether the question is T.S. Eliot or Cervantes. Plant Biology and Chemistry are both "Science" green. This is the architectural simplification that makes the category scale tractable: it needs one color per top-level domain (≈7–9 values), not one per hyper-specific interest.

**Construction rules:**
- The scale is a **small fixed set**, defined once, named `--cat-literature`, `--cat-science`, etc.
- Every hue is **designed to clear the grading colors** — no category red near the new WRONG-red, no category green near CORRECT. (With WRONG moved to true red, the existing purple/teal/tan/orange category hues are mostly already clear; the greens are the ones to check.)
- Leaf categories **inherit the parent domain's hue** — no per-leaf color, no hashing.

→ FIX (big one): live code has **five separate category/domain color systems** (feed hash palette, knowledge `DOMAIN_COLORS`, the duplicated share-card copy, the position-based "expanding" accents, the ceremony gradient palette), none sharing values or logic. Collapse to **one** `--cat-*` scale keyed on top-level domain. This is the largest single source of the color sprawl.

> **On the triangle hue:** the audit found triangle fill color is a *decorative* hash, not category-bearing. Two options once the `--cat-*` scale exists: (a) make the triangle actually use the category hue (color now means something), or (b) keep it decorative but draw from the muted category family so it can't collide with anything. Decide at build time; both are defensible. The one bit the triangle *does* encode — solid/hollow = unplayed/played — is safe the moment WRONG leaves orange.

---

## 4. ACCENT (gold) — one value, once per view

Gold is the highlight. It behaves like emphasis, not decoration — the same discipline the type guide put on italics.

**The rule (locked):** **gold marks the single most notable moment in view. At most one gold element per viewport/section. If two compete, the time-bound one (the ceremony countdown) wins.** "Once per page" is interpreted as once per logical section / viewport, not once per entire scrollable feed — so a long feed gets a gold standout per section, never a speck at the top and nothing after, and never one-per-row.

**What gold is for:** the ceremony / "weekly reflection in N days" countdown; a single convergence or milestone standout card. **What gold is not:** a standing register for the descriptor line (the gold-density study ruled this out — gold serif under every name is too much), a per-row accent, a decorative tint.

**One value.** → FIX (from audit): the "gold" is currently at least six values — `--tri-amber #d9a82e`, a thrice-duplicated `GOLD_INK` mix, the TS-only `HILITE #e9c97a`, `--tri-darkyellow #deae5c`, `--warning #b45309`/`--warning-border #e6c15a`, plus strays `#f0c060` / `#d9b56c`. Collapse the *accent* uses to one token (`--accent-gold`, value `#d9a82e` from `--tri-amber`). **Exception:** `--warning` is a distinct semantic (system warning state), not the editorial accent — keep it separate and named as such, don't fold it into the accent gold.

---

## 5. LINK / BRAND — orange, freed

With WRONG off the orange family, **orange `#d15e36` is cleanly link + brand** (`--brand-orange` / `--tri-orange`, already one value). No further collision once §1 lands. Keep it; just stop sharing it with grading.

---

## 6. THE SHARED TEST SURFACE — the friend card, fully specified

This card is specified across both guides. Type from Part 1, color here:

| Element | Type voice | Color |
|---|---|---|
| **"Robyn"** (name) | Editorial / Cormorant | ink `#0a1f3d` |
| descriptor sentence | Montserrat (per type guide) | ink-700 `#3a4a5f` |
| category names | mono (→ FIX from Georgia) | ink-700 |
| triangle marker | — (visual) | category hue (muted family); solid/hollow = unplayed/played; **never grading-red** |
| "Play these" | mono | ink, underline ink |
| **standout card only** (one per view) | — | gold accent: tint surface + rule + link, per §4 |

The ordinary cards carry **zero gold and zero grading color.** Only the single most-notable card in view earns the gold treatment. That is the whole rule, visible in one surface.

---

## 7. The fix-list (color half of `B-VISUAL-STYLE-GUIDE-COLOR-01`)

In dependency order, same define → route → de-collide shape as the type prompt:

1. **Grading:** move WRONG to true red _(set value)_; consolidate `--destructive` and `--success` into the two grading tokens; confirm CORRECT clears knowledge greens.
2. **Neutrals:** resolve the CREAM name/value conflict; reconcile the TS token system against CSS tokens (one source of truth).
3. **Category:** define the one `--cat-*` scale keyed on top-level domain (off grading hues); collapse the five existing systems onto it; route all consumers.
4. **Gold:** collapse the six golds to one `--accent-gold`; keep `--warning` separate; route consumers; enforce once-per-viewport in the standout components.
5. **Triangle:** decide category-hued vs. muted-decorative; ensure solid fill is never grading-red.
6. **Ratchet:** add a color ratchet (hardcoded hex + rgb/hsl count) alongside the type ratchet, baseline ≈312 color occurrences (235 hex + 77 rgb/hsl); propose the dev/debug exemption rather than deciding it.

**Each step leaves the app working.** Grading first because it's thesis-critical and unblocks the triangle. Category third because it's the biggest sprawl. Gold's once-per-view rule is the one behavioral (not just token) change — it needs a component-level check, not just a value swap.

---

## What's settled vs. what still needs a value

**Reconciled against `globals.css` on 2026-09-16.** This section had said three values were
still open. All three had in fact been set in the CSS, and the canon's own rule is that where
this document and `globals.css` disagree, the CSS is right and the document has the bug. The
values, so the doc stops asking a question the code has answered:

- **The WRONG red — SET.** `--game-wrong #a93b3b` (the muted brick used as the wash/fill base
  at 8–12%) and `--game-wrong-strong #c1121f` (the signal: rail and label text). Both are
  clearly out of the terracotta family and away from the link orange `#d15e36`, which is what
  §1 asked for.
- **The category hues — SET.** Twelve `--cat-*` pairs (fill + text) keyed on top-level domain:
  literature, music, film-tv, architecture, food, technology, sports, history, science,
  philosophy, pop-culture, language. Two were deliberately moved to clear grading —
  `--cat-literature` to bordeaux `#7d2c3f` off the grading red, `--cat-language` to teal
  `#2e6e7e` off the CORRECT green.
- **The triangle — DECIDED: option (b), decorative.** Triangle fill is a deterministic hash
  over the six muted `--tri-*` values and carries no category meaning. The one bit a triangle
  encodes is solid/hollow = unplayed/played, which is safe now that WRONG has left orange.
  Recorded at `globals.css:93-98`. Moving to option (a) — hue = `--cat-*` category — is a
  deliberate product change, not a cleanup.

**The one thing that was genuinely still open, and is now closed.** §1's fix-list says there
must be exactly one correct and one wrong value. Every grading site in the app used
`--game-correct` / `--game-wrong*` — except `knowledge/[domain]`'s answer-history ✓/✗, which
rendered `text-green-700` (a raw Tailwind palette green) against `text-destructive` (a third
red). It survived because the palette-colour lint selector only covers `src/components/**`,
and this file is under `src/app/**`. Moved onto the grading tokens 2026-09-16.

**Still standing, and deliberately so:** `--destructive` and `--success` remain in the token
set. They are NOT retired outright — only retired *as grading signals*. `--destructive` is the
colour of a destructive **action** (a Delete control), and `--success` backs the status-banner
surfaces. Neither may be used to say an answer was right or wrong.
