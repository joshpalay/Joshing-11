# D-LOADING-MOMENT-SURFACE-01 — The Loading Moment

**Status:** Sub-questions resolved 2026-06-25 (see *Resolved sub-questions* below); copy strings and per-card budgets still TBD in build. Ready to seed `B-LOADING-MOMENT-*` — this doc still does **not** authorize a build.
**Type:** Decision / design doc (D- precedes B-)
**Owner:** Josh
**Relates to:** §8.27 (Two-Axis Knowledge Portrait), §8.33 (Knowledge Page Display Model), §8.18 (Group Knowledge Map / connection-not-ranking), §18 (Success Metrics — internal-only, never shown as rankings)

---

## What this resolves

When a screen has to wait (session generation, grading round-trip, portrait
hydration, ceremony assembly), the loading state is currently dead time. This doc
specifies a **Loading Moment**: a small rotating surface that fills wait time with a
single warm, true artifact drawn from the player's own knowledge portrait and social
graph — never a score, never a ranking, never a competitive callout.

This is a decision doc only. It defines the card taxonomy, data sources, copy
register, fallback ladder, and the hard constraints a build prompt must honor. It does
**not** authorize a build.

---

## Drift-risk callouts (read before proposing changes)

These are the canon rules most likely to be violated by a "make loading fun" feature.
Any proposal that trips one of these is out of scope by default.

- **No competition register.** Individual session scores, wrong-answer rates, and
  streak lengths are designated private (§8.18). A Loading Moment may never surface
  rank, "best," "#1," "top," "fastest," or a ranked friend list.
- **Wrong answers are connection events, not failures.** Any wrong-answer card frames
  the answer as something discovered or now-known, never as a miss.
- **Color alone never conveys meaning.** Every card carries a text label; no card
  relies on a category color to be legible.
- **Machine content never renders as a person.** No Loading Moment may attribute a
  fact to a friend that the friend did not actually generate.
- **Attribution copy is neutral and recency-based, not superlative.** "from {Name}'s
  knowledge," "{Name} just added," never "{Name}, your best friend."
- **No new query on the critical path.** The screen is slow *because something is
  loading*. The Loading Moment must read from already-cached / already-in-flight data,
  never issue a fresh blocking fetch. See Constraint C-3.

---

## Core principle

A Loading Moment is a **description, not a score** — the same stance as the portrait
itself (§8.27: "The portrait is not a gamification layer… a description, not a
score"). It answers "here's something true about your world" while the player waits.
If we cannot show something true and warm from cached data, we show the quiet default
and nothing else.

---

## Card taxonomy

Six card types. Each has a data source already in the model, a copy register, and an
eligibility gate. Cards are selected by the fallback ladder (below), not shown all at
once — one Loading Moment shows exactly one card.

### 1. Deepest territory
- **Says:** "Your deepest territory right now — {canonical_subcategory}."
- **Source:** `PLAYER_MASTERY` — highest `mastery_points` subcategory for the user.
- **Register:** identity, present tense. Optionally append the tier line in canon
  voice (Versed / Fluent / Master), never a numeric point total.
- **Gate:** user has ≥1 subcategory past the minimum-3-questions portrait threshold.

### 2. Rare knowledge (tribe-size / rarity)
- **Says:** "You're one of the few here who knows {subcategory}."
- **Source:** rarity signal — how few players share this territory (same family as the
  public-game tribe-size signal, §8.25). Computed offline, cached.
- **Register:** belonging, not superiority. "one of the few," never "the only" unless
  literally true and even then handled gently.
- **Gate:** subcategory rarity below a set threshold AND user has proven territory there.

### 3. A wrong answer you turned around
- **Says:** "Something you once got wrong, you now know cold — {subcategory}."
- **Source:** `MASTERY_EVENTS` / `ANSWERS` — a question previously answered wrong, later
  answered correctly (or practiced) in the same territory.
- **Register:** discovery. This is the north-star thesis rendered as a moment. Never
  "you failed this before."
- **Gate:** a wrong→right (or wrong→practiced) transition exists for the user. **A raw,
  still-unresolved wrong answer never qualifies** (resolved Q2) — the card requires a
  completed turnaround, so it always reads as discovery, never as a callout.

### 4. The deepest cut you've answered
- **Says:** "The deepest cut you've answered — {question stem}."
- **Source:** `QUESTIONS.calibrated_difficulty` / `correct_rate` — a low-correct-rate
  Specialist question the user answered correctly.
- **Register:** "deepest cut" (matches Creator's Summary language), framed as a thing
  discovered, not a thing beaten. No difficulty number shown.
- **Gate:** user has ≥1 **correct** answer on a Specialist-tier question. Correct-only by
  design (resolved Q5) — the user has already seen and solved the stem, so re-showing it
  is not a spoiler. This card sits **lowest in the ladder** (step 4), so it surfaces only
  when richer cards have no data.

### 5. Who shares this with you (overlap, single warm callout)
- **Says:** "{Name} gets {subcategory} the way you do."
- **Source:** overlap-by-category (§8.27 friend-view overlap; §8.18 alignment), the
  per-category overlap, **not** a ranked alignment list.
- **Register:** neutral, recency- or category-anchored. **Single** callout only — a
  ranked "closest friends" list is explicitly out of scope (competition register).
- **Gate:** a real shared-and-proven territory exists with at least one friend.

### 6. Waiting discovery (a question added for you)
- **Says:** "{Name} just added a question about {subcategory} — only you'd get it."
- **Source:** recently authored question in a territory the user is strong in;
  honest pre-answer provenance (real author, real recency).
- **Register:** teaser, neutral provenance. Never implies the friend said anything they
  didn't.
- **Gate:** an unanswered, recently-authored question exists matching user strength.

---

## Copy register (locked stance, exact strings TBD in build)

- Editorial voice (Cormorant Garamond) for the artifact line; System voice (Josefin
  Sans) for the small label above it.
- Every card has a quiet text label (e.g. "YOUR KNOWLEDGE," "FROM YOUR FRIENDS,"
  "A DISCOVERY") so meaning never rests on color.
- Banned in this surface: rank, score, streak, "best/top/#1/fastest/most," any
  leaderboard framing, any superlative attribution to a person.
- Wrong-answer cards always use discovery framing.

---

## Fallback ladder (selection order)

The Loading Moment must always resolve to *something*, degrading gracefully:

1. If a **wrong-answer-turned-around** (card 3) is available and fresh → prefer it
   (it's the north-star moment). Rotate so it doesn't repeat every load.
2. Else a **rare knowledge** (2) or **deepest territory** (1) card, whichever has data.
3. Else **overlap** (5) or **waiting discovery** (6) if social data is cached. Overlap is
   deliberately weighted **below** the discovery cards (resolved Q3) so a high-traffic
   surface doesn't over-promote alignment and feed the §18 performance-game drift risk.
4. Else **deepest cut** (4).
5. **Sparse-portrait / cold-start fallback:** a player with too little history gets a
   quiet, non-personalized line in brand voice (e.g. an invitation to keep playing) —
   never a fabricated stat, never an empty templated slot.
6. **Hard floor:** if nothing is cached in time, show the plain loading state with no
   card. The Loading Moment is additive; it never delays the screen to populate itself.

---

## Constraints a build prompt must honor

- **C-1 — Read-only, cached-only.** No card issues a blocking query on the loading
  path. Sources are last-known-good cached values (portrait, mastery, overlap, recent
  authored questions), refreshed off the critical path.
- **C-2 — Truth gate.** A card renders only if its underlying fact is real and current.
  No placeholder, no "approximately," no fabricated attribution. Fail to the quiet
  default instead.
- **C-3 — No latency added.** If card data isn't ready within the budget, render the
  plain state and let the card appear next load. Never hold the screen for the card.
- **C-4 — Canon copy gates.** Competition-register language banned; color-alone banned;
  bonus/score framing banned. Attribution neutral and provenance honest.
- **C-5 — Rotation / anti-repeat.** Don't show the same card two loads running where
  alternatives exist; a stat that repeats every load reads as a banner, not a moment.
  **Anti-repeat state lives in client session only** (resolved Q4) — no write on the
  loading path (honors C-1/C-3); resetting on a fresh session is acceptable.
- **C-7 — Long-waits-only surface scope.** The Loading Moment is gated to waits long
  enough to earn a moment (resolved Q1): session generation, ceremony assembly, portrait
  hydration, etc. Short waits (e.g. a ~200ms grading blip) never trigger one. Gate on a
  measured duration threshold (~800ms–1s, exact value set in build) rather than a hard
  surface allowlist, so it adapts as surfaces change.
- **C-6 — Sparse-state coverage.** New / low-history players are a first-class case, not
  an afterthought — they hit the cold-start fallback, never an empty card.

---

## Resolved sub-questions (2026-06-25)

All five drafting-stage sub-questions are resolved. The resolutions are folded into the
card gates, fallback ladder, and constraints above; restated here as the decision record.

1. **Surface scope → long waits only.** The Loading Moment appears only on waits long
   enough to earn a moment (session generation, ceremony assembly, portrait hydration),
   gated on a measured duration threshold (~800ms–1s, exact value set in build). A short
   wait such as a ~200ms grading blip never triggers one — it would read as noise, not a
   moment. A duration threshold is preferred over a hard surface allowlist so the rule
   adapts as surfaces change. (See Constraint C-7.)
2. **Wrong-answer-card sensitivity → wrong→right/practiced only.** Card 3 surfaces a past
   wrong answer *only* once it has been turned around (answered correctly or practiced) in
   the same territory. A raw, still-unresolved wrong never qualifies, so the card always
   reads as discovery and never as a callout of a failure — consistent with "fail toward
   the player." (See Card 3 gate.)
3. **Overlap card and the tension flag → keep below discovery.** Card 5 (overlap) stays
   weighted *below* the discovery cards in the ladder. §18 flags a performance-game drift
   risk if alignment engagement runs high while wrong-answer reaction runs low; keeping
   overlap beneath the discovery cards on this high-traffic surface avoids over-promoting
   alignment and feeding that drift. (See fallback ladder step 3.)
4. **Rotation memory → client session only.** Anti-repeat state lives in client session
   state, not persisted server-side. This is the simplest option and, critically, adds no
   write on the loading path (honors C-1/C-3). Anti-repeat resetting on a fresh session is
   acceptable. (See Constraint C-5.)
5. **Difficulty-card exposure → keep, lowest priority, correct-only.** Card 4 is retained
   but sits at the bottom of the ladder (step 4) and surfaces only questions the user
   answered *correctly*. Because the user has already seen and solved the stem, re-showing
   it is not a spoiler; its low ladder position keeps it rare and special. (See Card 4
   gate.)

---

## Done-when (for the eventual build prompt, not this doc)

- [ ] Card taxonomy implemented as a typed set with per-card eligibility gates.
- [ ] All sources read from cached values; grep confirms no new blocking fetch on the
      loading path.
- [ ] Fallback ladder resolves to a quiet default for sparse / cold-start users.
- [ ] No competition-register strings in the surface (grep-checkable banned-word list).
- [ ] Every card renders a text label independent of color.
- [ ] Anti-repeat rotation verified across consecutive loads.

---

## Not in scope

- Any ranked list (friends, scores, streaks).
- Any new metric computation on the critical path.
- Any fabricated or "approximate" stat.
- Build prompt itself — this doc precedes `B-LOADING-MOMENT-*`.
