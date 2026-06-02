# Decisions & Docs Index

A short index of the durable restructure (D-1 / D-2 / D-3 / D-4) documentation, and — critically — a
pointer to what is **settled** vs. **still open**, so the next reader doesn't re-litigate closed
decisions or miss the live thread.

The `PRD-D-*` series **is the current product canon** (the "v12 line") and supersedes the v11.x PRDs.
The older specs are archived under `_docs/archive/` for history: `PRD-v11.2.md` (the last v11 diff, with
v11.3 / v11.4 / v11.5 folded in place — there is no standalone v11.3+ file), `PRD-v11.1.md`, `PRD11.md`,
and `Joshing_PRD_v10_25 (1).md`.

Last updated: 2026-06-02.

## Durable docs

| Doc | What it is |
|-----|------------|
| [`PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md`](./PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md) | Canonical "what the product is and why": target capabilities, deferred items, open hypotheses, **amended decisions**. |
| [`PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md`](./PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md) | Spec — directional follow + Feed/Daily split. |
| [`PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md`](./PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md) | Spec — niche-match discovery engine. |
| [`PRD-D-3-HOUSE-EDITORIAL-AUTHOR-SPEC.md`](./PRD-D-3-HOUSE-EDITORIAL-AUTHOR-SPEC.md) | Spec — house / editorial author (**unbuilt**). |
| [`PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md`](./PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md) | Spec — Lately skill milestones + the +2 reframe (fresh questions from friend territory ∪ activity). |
| [`audits/2026-06-02-restructure-conformance-audit.md`](./audits/2026-06-02-restructure-conformance-audit.md) | Read-only conformance audit of the shipped code against the specs (D-1 / D-2 / D-3). |
| [`audits/2026-06-02-d4-plus2-reframe-reaudit-findings.md`](./audits/2026-06-02-d4-plus2-reframe-reaudit-findings.md) | Read-only re-audit of the D-4 +2 reframe against shipped code. |

Execution scaffolding (kept separate, not product spec): [`docs/build-prompts/`](./docs/build-prompts/).

## Settled decisions (don't re-open without cause)

- **Directional follow is the primitive.** Symmetric friendship replaced; "friend" = mutual follow. (`PRD-D-1` Decision 1.)
- **Authored-vs-curated provenance is honest.** Forwarded LLM questions get `creatorId: null`, `source: 'curated_sent'`; credit never accrues to the forwarder. (Conformance audit §2.1.)
- **Send difficulty travels with the question.** The forwarded question keeps its own `difficultyEstimate`. (`PRD-D-0` §4.1.)
- **Broadcast rolls off after unfollow — won't fix.** Already-surfaced broadcasts are not retroactively purged on unfollow. (`PRD-D-0` §4.2.)

## Open — pick these up

- **Option B (live thread): should the aside amplify a human's `creatorNote` when one exists?** Aside and creator note are independent surfaces today; no code merges them. (`PRD-D-0` §5.)
- **Niche-match production default.** Ships `false`, test-phase `true`; production default is an open decision to revisit after the test. (`PRD-D-2`; `PRD-D-0` §3.)
- **Thumbs-up → surface priority.** No effect on feed ordering yet; computation model and weighting formula undecided. (`PRD-D-0` §3.)
- **House author (Capability 23) + Invariant H-1 guard.** D-3 is spec-only; when built, replace the `'A friend'` fallback for house-origin questions and lock H-1 with a regression test. (Conformance audit §3.1, §5.)
- **Feed verb `'wrote this'` on broadcast.** The `authored_shared` branch claims authorship unconditionally; resolve before D-3. (Conformance audit §3.2.)
