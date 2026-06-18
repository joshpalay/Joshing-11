# Joshing Style Guide — Type (Part 1 of 2)

**Status:** architecture locked; faces resolved by `D-STYLE-AUDIT-01`. Confirmed: Editorial = Cormorant Garamond (the serif), System + Interface = Montserrat (the sans), differentiated by treatment not by face. The typewriter face (Courier New) that once carried the System voice has been **retired app-wide** — see §2 and §6. The role architecture is stable and safe to build against.

-----

## The core idea: type roles are voices, not locations

Every piece of text in Joshing belongs to exactly one voice. You never ask “where does this text appear?” You ask “**who is speaking, and about what?**” Location-based rules (“names are always X”) break the product, because the same string can do different jobs. Voice-based rules hold.

There are four voices — but only **two faces** carry them. Editorial gets the serif; everything else lives in the sans, separated by *casing and treatment*, not by a third or fourth font file.

|Voice        |Face                          |What it is                                  |The feeling                                             |
|-------------|------------------------------|--------------------------------------------|--------------------------------------------------------|
|**Editorial**|the serif                     |The content — the thing the product is *for*|Warm, considered, literary. The loud voice.             |
|**System**   |the sans — UPPERCASE + tracking|The machine labeling and structuring itself |Mechanical, quiet, precise. Never competes with content.|
|**Interface**|the sans — sentence case       |Text you *act on* rather than read          |Tappable, clear, functional.                            |
|**Brand**    |the script                    |Logo and brand moments only                 |Special — and stays special by being rare.              |

This maps directly onto the product thesis: **the content is loud, the interface is quiet.** The serif-vs-sans split is the warmth-vs-precision distinction made visible. The System and Interface voices share the sans on purpose — the *machine* reading of a System label is carried by its caps + letterspacing, not by a typewriter face. (The earlier monospace, Courier New, was retired app-wide; see §2 and §6.) If the warm/quiet split ever stops reading as intentional, the type system has failed.

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

## 2. SYSTEM — the sans, set as a label

**The machine voice.** The interface labeling, tagging, and structuring itself. Deliberately mechanical so it never competes with the content.

**The face is the sans (Montserrat), not a monospace.** The typewriter face (Courier New) that used to carry this voice was retired app-wide — it read as costume, not signal, and it crept onto content (the friend-activity category lists) where it didn’t belong. What makes a string read as *the machine talking* is its **treatment**, not a separate font file: UPPERCASE + positive letterspacing, small, quiet color. That signature is carried in the sans now. The token is still `--font-mono` (kept so its ~40 consumers route from one place), but it resolves to the sans stack — see §6.

**Used for**

- Caps labels: “TODAY’S FIVE,” “FROM FRIENDS,” “BETWEEN US!,” “NEW TERRITORY ·”
- Tags, provenance stamps (“FROM GREG”), “ANSWERED” / progress markers
- Timestamps, scores, counts
- A person’s name **when the name is a system datum** (an author tag, a provenance stamp)

**Casing:** UPPERCASE with positive letterspacing. This is the *whole* signature of the System voice now — caps + tracking = “this is the machine talking.” Without the caps treatment, sans text reads as Interface, not System.
**Weight:** regular. Don’t bold it; the caps + tracking already separate it.

**Note — category names are NOT System anymore.** The category lists under a friend’s activity (“Shakespearean Tragedy,” “Plant Biology & Taxonomy”) moved to the **Editorial serif** (see §5). They’re *which territory the warmth touched*, and they now read as content, in their stored title case — not as a caps label.

**Never use the System treatment for:** anything the player reads for pleasure or meaning. It’s the label on the drawer, not what’s inside.

-----

## 3. INTERFACE — the sans

**The action voice.** Text you operate, not text you read.

**Used for**

- Buttons (“Play now,” “Play (4) Missed Questions”)
- Bottom nav (Home / Questions / Knowledge / Friends)
- Inputs, form fields, settings controls
- Account / avatar labels (“JP”)

**Casing:** sentence case or caps per the component, but consistent within a component class. Buttons pick one rule and hold it.

**Inline action links — one recipe.** The underlined inline actions (the “Answer →” / “Try again →” / “Recheck →” family, the editorial-feature CTA, “Play → ” on the Missed card, the activity-stream play affordance) are Interface, so they take the **sans, never the serif**. They all share the **Today’s Five card** recipe — `text-sm font-medium`, the link slate (`--brand-link`), `underline underline-offset-4`, no letter-spacing (`TodaysFiveCard`’s “See today’s recap” link). The canonical implementation is `FeedActionLink` (size `lg`); satellites match it by hand. This is a *link*, not a heading — it stays at the quiet 14px register, never the old 18px serif primary it was hand-copied from. (A person’s name rendered as a link inside an editorial feature is the §5 exception — that’s content-as-subject and keeps the serif.)

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
|**category names inside the line** (“John Milton’s Paradise Lost”, “Plant Biology & Taxonomy”)|*Which territory* the warmth touched — read as content|**Editorial** (serif), title case                    |
|**The triangle markers** beside the row                                                       |Decorative texture + one bit of state  |System layer (visual, not type) — see note           |

**What live code actually does:**

- The **descriptor sentence body** renders in **Montserrat**, not a serif italic. Leave it as-is; the warmth is carried by the *words*, and Montserrat here reads as quiet connective tissue around the two things that do carry voice (the serif name, the serif category).
- The **category names embedded in the line** render in the **Editorial serif** in their stored title case (`ActivityStreamItem.tsx`, the `category` branch of `Line`). They were briefly routed to the System mono register, but the typewriter look read as costume on what is really the warm answer to *which territory* — so they sit with the name in the serif now, a register apart from the sans sentence around them.
- The **triangle hue is decorative**, not category — a deterministic hash of `rowId:position` over a 6-color palette. Don’t build meaning on its color. The one bit it *does* carry is **solid vs. hollow = unanswered vs. answered** — and that’s a color-half problem, not type: solid currently renders in near-WRONG orange, which Part 2 must de-collide.

**The reasoning:** the name is the warm subject (Editorial/serif) and the category is the warm *territory* (Editorial/serif, a step quieter in color), so they read as kin; the connective sentence between them is sans — neither subject nor data, just the rigging that holds them together. The System voice still owns the structural chrome on the card (timestamps, the bundle’s “{n} of 5 questions” count) — caps + tracking in the sans, never the typewriter.

**The decision rule for any ambiguous string:**

> Is this the warm thing I’m reading *about* (Editorial), the machine labeling or structuring something (System), or a control I act on (Interface)?

Apply it to the name, not to “names” as a category. The same name can be Editorial in a headline, System in a provenance tag, and Interface in an avatar — all correct, all at once.

-----

## 6. Token shape (confirmed against live code)

|Role     |Token         |Face                  |Notes                                                                                                                                                                                                                                                             |
|---------|--------------|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Editorial|`--font-serif`|**Cormorant Garamond**|Rename `--font-literata` → `--font-serif` (it already resolves to Cormorant). Replace all hardcoded `'Georgia, serif'` with this token. Name vs. descriptor handled by weight + color, never italic. Display moments use Cormorant (display weight or its loaded italic) — this is the app's only editorial serif; the former second serif (Playfair Display) was retired by B-TYPE-SERIF-CONSOLIDATION-01.|
|System   |`--font-mono` |**Montserrat** (caps + tracking)|Typewriter face retired. `--font-mono` now resolves to the sans stack (`globals.css:240`), so every `var(--font-mono)` / `FM` consumer renders the System voice in the sans, carrying its label signature by caps + letterspacing. The token name is kept (not renamed) purely as the single routing point for its ~40 consumers; treat it as “the System-label register,” not a monospace.|
|Interface|`--font-sans` |**Montserrat**        |Confirmed (F4.2 resolved); `--font-neutral` aliases it. Same face as System now — the two are separated by casing/treatment, not by font. Clean the self-referential `--font-sans: var(--font-sans)` at `globals.css:9`. Fold the two stray Inter uses into Montserrat.|

No `--font-script` token. Caveat removed; do not re-add a script face without a recurring job. **No live monospace face** — the one deliberate exception is the share-receipt raster (`SharePortraitCard.tsx`), which hardcodes `'Courier New'` for its html2canvas snapshot aesthetic and is intentionally outside this token system.

**The fix-list this produces (type only):**

1. Remove Caveat load + unused `FH` constant.
1. Rename `--font-literata` → `--font-serif`; repoint consumers.
1. Replace hardcoded `'Georgia, serif'` (6+ sites) with `--font-serif` for Editorial — **including** the descriptor-line category names, which read as content (§5).
1. Retire the typewriter face: point `--font-mono` at the sans stack so the System voice is carried by caps + tracking, not a monospace; route any remaining Courier literals through the token (except the share-receipt raster).
1. Fold the two Inter uses into Montserrat; clean the self-referential sans var.

These are the type half of the eventual `B-VISUAL-STYLE-GUIDE` build prompt. Each is a token-routing change, not a redesign — low risk, high drift-reduction.

-----

## What’s deferred to Part 2 (Color)

The triangle **hue** system, the WRONG/RIGHT grading-color quarantine, the category palette (shift vs. desaturate), and the ACCENT-vs-SURFACE-WARM split. Type and color share the friend card as their shared test surface — when both halves are drafted, that one card should be fully specified across both.
