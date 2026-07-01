# docs/thinking — session records & design thinking-in-progress

**What this folder is:** a home for *thinking artifacts* and *session records* — snapshots of a design direction while it settles. **Nothing here is ratified or a build instruction.** Live code is the source of truth; treat every doc below as a record to react to, not a spec to build from. Ratified decisions live in `DECISIONS.md` and the `PRD-D-*` series.

## Latest summary — read this first

- **`SESSION-SUMMARY-quality-cost-human-authored.md`** — the most recent, data-grounded record of the arc: cost is modest and located (concentrated in deep niche domains), the pivot is justified by quality/anti-fabrication (not cost), and the last real unknown is the offline "Robyn test." **This supersedes some earlier framing below** — notably: reactions are RETIRED (the `QuestionReaction` residue is dead, not a bug to fix), reaction-rate is NOT the north star (a daily-play → invite → author funnel is), and the "curation is 90× cheaper" cost argument is retired. Includes the one shipped change (the `DAILY_TOPUP_CARRYFORWARD_ENABLED` flip).

## The human-authored pivot (2026 session) — reading order

Read top to bottom: the summary is the map, then the model, then the test suite, then the first proposed build, then the validation gate. (Where this earlier record and the latest summary above disagree, the latest summary wins.)

1. **`SESSION-SUMMARY-human-authored-pivot.md`** — START HERE. The map of the whole session: how it traveled (cost spike → human-authored pivot), what was decided (un-ratified), the open questions, and the critical caveat (mostly design, little evidence — validate before building).
2. **`CONCEPT-master-authored-canonical-sets.md`** — the full model: the authority inversion (human authors, LLM is staff), finite sets, performance-based mastery, the contribution→mastery→evaluation loop, the optional domain tree, the authorship-exclusion invariant. Thinking-in-progress; not a decision record.
3. **`PROBLEM-CASES.md`** — the test suite: three named player situations (Ari / deep exhaustion, the never-deep niche domain, the shared-popular domain) to hold every design choice against.
4. **`D-FLAG-DASHBOARD-01.md`** — the first proposed Phase-1 build: a two-panel crafter admin (flag queue + "where your craft is wanted"). PROPOSED, not ratified.
5. **`PRE-BUILD-VALIDATION.md`** — the gate: the queries and the one offline test to run before any build prompt. Updated with V1–V4 results.
6. **`PRE-BUILD-VALIDATION-PROMPTS.md`** — the read-only investigation prompts behind the gate (V1 hit-rate, V2 north-star, V3 recurring cost, V4 floor cost).

## Mockups (static, illustrative)

- **`crafter-admin-two-panel.html`** — the two-panel admin from `D-FLAG-DASHBOARD-01` (Panel A flag queue, Panel B demand).
- **`crafter-workbench-mockup.html`** — the deep-tree crafter workbench (four-level domain tree, per-node coverage, commission control).

---

**Status reminder:** the supply pause (`CC-SUPPLY-HALT-01`) still holds. Nothing in this folder unpauses it, flips a flag, or authorizes a build. See `DECISIONS.md` for the ratified state.
