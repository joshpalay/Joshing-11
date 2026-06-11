# Joshing Style Guide — Type (Part 1 of 2)

**Status:** architecture locked, faces pending `D-STYLE-AUDIT-01`. Face names below are generic (“the serif,” “the mono”) on purpose — the audit fills in the confirmed font-family per role and the retired-faces list. The role architecture does not depend on those values and is safe to build against now.

-----

## The core idea: type roles are voices, not locations

Every piece of text in Joshing belongs to exactly one voice. You never ask “where does this text appear?” You ask “**who is speaking, and about what?**” Location-based rules (“names are always X”) break the product, because the same string can do different jobs. Voice-based rules hold.

There are four voices. That’s the whole system.

|Voice        |Face      |What it is                                  |The feeling                                             |
|-------------|----------|--------------------------------------------|--------------------------------------------------------|
|**Editorial**|the serif |The content — the thing the product is *for*|Warm, considered, literary. The loud voice.             |
|**System**   |the mono  |The machine labeling and structuring itself |Mechanical, quiet, precise. Never competes with content.|
|**Interface**|the sans  |Text you *act on* rather than read          |Tappable, clear, functional.                            |
|**Brand**    |the script|Logo and brand moments only                 |Special — and stays special by being rare.              |

This maps directly onto the product thesis: **the content is loud, the interface is quiet.** The serif/mono split is the warmth-vs-precision distinction made visible. If that split ever stops reading as intentional, the type system has failed.

-----

## 1. EDITORIAL — the serif

**The content voice.** This is what the player is reading *for*.

**Used for**

- Question text
- The answer reveal (the large word — “Dino”)
- Explanation / “did you know” prose
- Section headings (“Today’s Five”)
- A person’s name **when the name is the subject you’re reading about** (see §5)

**The descriptor line.** The relational/emotional texture — the friend-activity descriptors (“keeps finding new corners,” “has been on a curious streak”) — is **Editorial content**, not a separate register. The warmth lives in the *words*, not in any slant. It is distinguished from the name above it by **weight and color, not italics**: the name is the heavier serif in full ink; the descriptor is regular-weight serif in a softened ink (INK2/INK3 register), so it sits a clear step below the name like a standfirst below a headline. No italic does this job.

**On italics generally:** there is no standing italic role. Italic is available only as plain inline emphasis within Editorial prose, used sparingly. A whole line set in italic is drift.

**Weights:** regular for body/prose; a heavier weight for headings and the answer reveal. (Exact weights from audit.)
**Casing:** sentence case. Never all-caps. (All-caps is the System voice’s job.)

**Never use the serif for:** buttons, nav, tags, timestamps, any control. If it’s tappable or it’s a label, it’s not Editorial.

-----

## 2. SYSTEM — the mono

**The machine voice.** The interface labeling, tagging, and structuring itself. Deliberately mechanical so it never competes with the content.

**Used for**

- Caps labels: “TODAY’S FIVE,” “FROM FRIENDS,” “BETWEEN US!,” “NEW TERRITORY ·”
- Tags, category chips, provenance stamps (“FROM GREG”)
- Timestamps, scores, counts
- **Structured metadata** — including the category lists under a friend’s activity (see §5)
- A person’s name **when the name is a system datum** (an author tag, a provenance stamp)

**Casing:** UPPERCASE with positive letterspacing for labels. This is the signature of the System voice — caps + tracking = “this is the machine talking.”
**Weight:** regular. The mono carries its own weight; don’t bold it.

**Never use the mono for:** anything the player reads for pleasure or meaning. It’s the label on the drawer, not what’s inside.

-----

## 3. INTERFACE — the sans

**The action voice.** Text you operate, not text you read.

**Used for**

- Buttons (“Play now,” “Play (4) Missed Questions”)
- Bottom nav (Home / Questions / Knowledge / Friends)
- Inputs, form fields, settings controls
- Account / avatar labels (“JP”)

**Casing:** sentence case or caps per the component, but consistent within a component class. Buttons pick one rule and hold it.

**Never use the sans for:** content (that’s Editorial) or labels/metadata (that’s System). The sans is for things with tap targets.

-----

## 4. BRAND — the script (Caveat)

**The brand voice.** Rare by design.

**Used for**

- The Joshing logo / wordmark
- Deliberate brand moments (a ceremony flourish, a hero beat) — sparingly

**Never use the script for:** body copy, any interactive element, any label, any name in a feed, anything functional. The instant Caveat does a job, it stops being a brand mark and becomes noise. If you’re reaching for it to solve a layout problem, you’ve found the wrong tool.

-----

## 5. THE HARD CASE — a person’s name

“A person’s name” is **not one thing.** It belongs to whichever voice matches the job the name is doing. This is the worked example that proves the whole frame.

A single friend-activity card spans **three voices**, and that is the system working correctly — not drift:

|Element on the card                                                                           |What it’s doing                        |Voice                                                |
|----------------------------------------------------------------------------------------------|---------------------------------------|-----------------------------------------------------|
|**“Robyn”** (the name, as headline)                                                           |The subject you’re reading about       |**Editorial** — Cormorant, heavier weight, full ink  |
|the descriptor sentence (”…has been on a streak”)                                             |Relational/emotional texture           |see note below                                       |
|**category names inside the line** (“John Milton’s Paradise Lost”, “Plant Biology & Taxonomy”)|Structured metadata — *which territory*|**System** (mono) → FIX (currently hardcoded Georgia)|
|**The triangle markers** beside the row                                                       |Decorative texture + one bit of state  |System layer (visual, not type) — see note           |

**What live code actually does (and what to fix):**

- The **descriptor sentence body** already renders in **Montserrat**, not a serif italic — so the “retire the italic serif” worry was aimed at a register that doesn’t exist. Leave the sentence body as-is; the warmth is carried by the *words*, and Montserrat here reads as quiet connective tissue around the two things that do carry voice (the serif name, the mono category).
- The **category names embedded in the line** are the real drift: hardcoded `'Georgia, serif'` (`ActivityStreamItem.tsx:64–68`). These are metadata — *which territory the activity touched* — so they belong to the **System voice (mono)**. → FIX: route through `--font-mono`, drop the Georgia literal.
- The **triangle hue is decorative**, not category — a deterministic hash of `rowId:position` over a 6-color palette. Don’t build meaning on its color. The one bit it *does* carry is **solid vs. hollow = unanswered vs. answered** — and that’s a color-half problem, not type: solid currently renders in near-WRONG orange, which Part 2 must de-collide.

**The reasoning still holds:** the name is the warm subject (Editorial/serif), the category is data (System/mono), and they read as distinct because the voices differ. The surprise from the audit is only that the connective sentence between them is already sans — which is fine, because it’s neither the subject nor the data; it’s the rigging that holds them together.

**The decision rule for any ambiguous string:**

> Is this the warm thing I’m reading *about* (Editorial), the machine labeling or structuring something (System), or a control I act on (Interface)?

Apply it to the name, not to “names” as a category. The same name can be Editorial in a headline, System in a provenance tag, and Interface in an avatar — all correct, all at once.

-----

## 6. Token shape (confirmed against live code)

|Role     |Token         |Face                  |Notes                                                                                                                                                                                                                                                             |
|---------|--------------|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Editorial|`--font-serif`|**Cormorant Garamond**|Rename `--font-literata` → `--font-serif` (it already resolves to Cormorant). Replace all hardcoded `'Georgia, serif'` with this token. Name vs. descriptor handled by weight + color, never italic. Display moments may use Cormorant display weight or Playfair.|
|System   |`--font-mono` |**Courier New**       |Point `--font-mono` at Courier New; route the `lately/tokens.ts` `FM` Courier literal and all its consumers through the token; retire the literal.                                                                                                                |
|Interface|`--font-sans` |**Montserrat**        |Confirmed (F4.2 resolved); `--font-neutral` aliases it. Clean the self-referential `--font-sans: var(--font-sans)` at `globals.css:9`. Fold the two stray Inter uses into Montserrat.                                                                             |

No `--font-script` token. Caveat removed; do not re-add a script face without a recurring job.

**The fix-list this produces (type only):**

1. Remove Caveat load + unused `FH` constant.
1. Rename `--font-literata` → `--font-serif`; repoint consumers.
1. Replace hardcoded `'Georgia, serif'` (6+ sites, incl. the descriptor-line category names) with `--font-serif` for Editorial — **except** the category names, which go to `--font-mono`.
1. Collapse the two mono registers into `--font-mono` (Courier New).
1. Fold the two Inter uses into Montserrat; clean the self-referential sans var.

These are the type half of the eventual `B-VISUAL-STYLE-GUIDE` build prompt. Each is a token-routing change, not a redesign — low risk, high drift-reduction.

-----

## What’s deferred to Part 2 (Color)

The triangle **hue** system, the WRONG/RIGHT grading-color quarantine, the category palette (shift vs. desaturate), and the ACCENT-vs-SURFACE-WARM split. Type and color share the friend card as their shared test surface — when both halves are drafted, that one card should be fully specified across both.
