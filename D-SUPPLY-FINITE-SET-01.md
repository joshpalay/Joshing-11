# D-SUPPLY-FINITE-SET-01 — Finite completable sets, cost-routed curation

**Status:** ✅ **RATIFIED** 2026-07-05 (Josh, in chat). Supersedes
`docs/decisions-pending/D-SUPPLY-FINITE-SET-01-PENDING.md` (now resolved).
Unblocks the `D-SUPPLY-LADDER-UNIFY-01` rework and forces a revision of
`D-AREA-EXPANSION-01` (graduation valence). Does not, by itself, un-pause the
paid refill run — see §6.

## The decision (two answers + two additions)

### 1. Topics are FINITE COMPLETABLE SETS, and completion invites authorship.
A knowledge domain is a **bounded body of ~15–30 fan-salient questions** — the
ones a real fan of that topic would genuinely enjoy — not an infinite top-up
pool. A player **completes** the set, earns a **designation** (a durable badge),
and is then **invited to graduate** (a neighbor/parent topic) *and* **to author
their own questions** for the topic they just mastered.

- **Completion is a trophy, not a failure.** "Running out" — today an awkward
  state the guard hides — becomes the intended arc: master → badge → branch out.
  This directly answers the driving feedback ("answering ever deeper into one
  play leads to weirdness, frustration and boredom"): we stop mining a topic past
  its fan-salient core.
- **Completion → contribution (Josh's addition).** At the trophy moment the
  player is offered the authoring door: "you know this world — add the questions
  you wish were here." Reuses the existing invited-author flow
  (`B-CRAFTER-LIFECYCLE-01`, the `/invited` takeover + `/craft/[domain]` surface);
  a completed player is the highest-signal candidate to author, and their
  additions **grow the set** for the next player (finite ≠ frozen — see §4).
- **Arcane questions are opt-in.** The fan-salient core is the default set; deep
  cuts are generated rarely and only on a player's explicit "go deeper" — not
  ground out automatically. (Maps onto the crafter "deep cuts" tier that exists.)

### 2. Curation is COST-ROUTED hybrid (Josh's second answer).
Not blanket-curate, not blanket-hands-off. **A human curates the domains that
are expensive or unreliable for the machine to generate + verify; cheap,
reliable domains fill themselves.**

- **"Expensive/unreliable" is a computed per-domain signal**, from telemetry we
  already collect (no new instrumentation):
  - **demotion rate** — `verification_verdict='demoted'` over verified rows,
    grouped by `canonical_subcategory`. High demotion ⇒ the machine keeps minting
    wrong facts here ⇒ human-vetting ~50→keep ~20 beats regenerate-and-catch.
  - **verify web-search rate** — domains where the verifier can't settle from
    knowledge and falls to `web_search` (`web_search_requests > 0` on
    `scope='batch-verify'` ledger rows, once attributable per domain). Niche /
    fandom / current-events ⇒ expensive to verify.
  - **draft/ask-to-answer kill rate** — low machine yield ⇒ expensive to fill.
  These combine into a **curation-worthiness score** per domain.
- **Routing:** score above a tunable threshold → the domain is flagged
  **curate** and surfaced in the crafter "where your craft is wanted" worklist
  (which already ranks active domains by demand × thinness — this adds a
  cost-risk dimension). Below threshold → **auto-fill** (machine generates the
  set, gates filter, no human in the loop).
- **The expensive set and the authorship-invite set are the same set** — a
  niche fandom domain is both where the machine is unreliable *and* where a
  just-completed superfan is the ideal author. The two additions converge.

## What "finite" changes (the mechanics)

- **Depth threshold** stops meaning "too thin to serve" and starts meaning
  **"set complete."** The `RETRIEVAL_POOL_DEPTH_THRESHOLD` / kb-exhaustion guard
  is reinterpreted: reaching target depth = the set is done, trigger the trophy,
  not "keep generating."
- **Set size** is per-domain, seeded from the node's authored **mastery weight**
  (`node_weight`, already seeded on 116 nodes) — a deeper topic (weight 9) gets a
  bigger target set than a shallow one (weight 2). This reuses mastery-v2's weight
  as the set-size signal, not just the mastery bar.
- **Refill** flips from "drain a daily backlog forever" to **"fill each set once,
  then stop."** A completed set is not re-refilled. This collapses the recurring
  refill cost to a bounded, one-time-per-domain cost.
- **Graduation** (`D-AREA-EXPANSION-01`, rung 5) flips valence: **fallback → the
  intended arc.** That doc must be revised (do not treat graduation as "we ran
  out" anymore).

## Finite ≠ frozen (how sets grow)

A set is bounded *at any moment*, not permanently sealed:
- **Human authorship extends it** — completed players + curators add questions,
  so a beloved topic's set organically grows past its machine-generated core.
- **Opt-in depth extends it** — a player asking to "go deeper" mints arcane
  questions on demand, appended to their view of the set.
- **Re-completion** — when a set grows after a player completed it, they're
  notified there's more (a light re-engagement hook, not a treadmill).

## Build implications (phased; each independently mergeable)

- **P1 — Curation-worthiness score (read-only):** per-domain demotion + verify-
  web + kill-rate rollup; surface as a column/sort in the crafter worklist. No
  behavior change; validates the routing signal before it gates anything.
- **P2 — Set-completion state:** reinterpret depth-reached as "complete" for
  auto-fill domains; wire the trophy/designation + the authorship-invite door at
  completion (reuse the invited-author takeover). Flag-gated.
- **P3 — Refill re-scope:** refill fills to target-set-size then stops per domain;
  completed sets excluded. Folds into the `D-SUPPLY-LADDER-UNIFY-01` rework.
- **P4 — Curation routing live:** the score gates which domains enter the crafter
  worklist as "curate" vs auto-fill.
- Revise `D-AREA-EXPANSION-01` (graduation valence) alongside P2.

## Open knobs (tune later; do not block the build)

- Target set size as a function of `node_weight` (linear? floor/ceiling 15/30?).
- Curation-worthiness threshold + the weight of each signal (demotion vs web vs
  yield) — calibrate against the crafter's own kept/killed ledger.
- Whether opt-in deep cuts count toward a *second* designation tier.
- Re-completion notification cadence (avoid it becoming a treadmill by the back
  door).

## Interacts with

- `D-SUPPLY-LADDER-UNIFY-01` — now UNBLOCKED; rungs 2/3/5 rewrite against finite
  sets (fill-once refill, complete-not-thin threshold, graduation-as-arc).
- `D-AREA-EXPANSION-01` — graduation valence flips; revise with P2.
- `B-CRAFTER-LIFECYCLE-01` — the authorship-invite and curation surfaces already
  exist; this decision points real routing at them.
- Mastery-v2 (`node_weight`) — reused as the set-size signal.
- The paid AC-1 refill run / soak — still paused pending the P3 re-scope; refill
  as it stands (infinite drain) is now the *wrong shape*, so do not run the
  old-shape confirmation — rebuild it fill-once first.

## Results (addendum, 2026-07-05)

P1 and P2 shipped the same day this was ratified; building them + the parallel
demoted-question work surfaced findings that **partly overtake the plan above.**
The decision holds as *direction*; three corrections to what's written:

- **P1 (curation-worthiness score) — shipped (#1422), but the signal is INERT.**
  `curationVerdict` + `CURATION_FUTILITY_THRESHOLD=0.34` are live in the crafter
  worklist + weekly cost email. **Nothing crosses the line in prod:** the worst
  domain is ~25% demotion (under 0.34) and refill is off so nothing is
  "generation-struggling." The router is built ahead of anything to route.

- **The cost-routing premise (§2) is weaker than assumed — and this session
  eroded it further.** §2 keys "curate this domain" on **demotion rate** as a
  proxy for intrinsic domain difficulty. But the salvage pass (`D-QUALITY-
  SALVAGE-01`, #1426) found **~70% of demotions are one-off *extra-fact* errors**
  (a wrong year/count/attribution, usually in the explainer) scattered across
  otherwise-fine domains — fixable with a one-line trim, **not** a signal the
  domain is hard. Worse, the salvage pass + the generation tightening (#1425)
  **drive demotion rates down broadly**, hollowing out the exact signal P4's
  routing depends on. **Correction:** if cost-routing is revived, do NOT key it on
  raw demotion rate. Use the signals salvage can't explain away — **verify
  web-search rate** and **draft-kill rate** — or **post-salvage *residual*
  demotion** (a domain that still demotes *after* the trim is the genuinely-hard
  one). That residual is the real "expensive domain."

- **P2 (set-completion) — shipped (#1427), but it does NOT use `node_weight`.**
  Contrary to "set size is seeded from `node_weight`" (§"What finite changes"),
  completion was implemented as **distinct-answered ≥ durable pool depth, floored
  at `SET_COMPLETION_MIN_SIZE=8`** — because at current scale pool depth *is* the
  set, and weight-based target sizing is really a P3/generation-cap concern that
  doesn't exist yet. Do not build P3 assuming P2 already sizes sets by weight.

- **At ~6 weekly players the whole model is LATENT, not load-bearing.** Only 13
  pre-P2 completions across 4 players exist, and they don't retroactively fire —
  so the trophy/authorship arc will rarely trigger for now. **P3 (fill-once
  refill) and P4 (routing) are scale-gated, not next-up:** normal generation +
  human authoring already fills sets faster than 6 people drain them, and P4 has
  no cost-variance to route on yet. Revisit both when player count grows enough
  that (a) players actually complete sets and (b) a residual-demotion signal has
  real spread.

- **What held up:** the completion-as-trophy reframe (the driving fix for the
  "answering ever deeper leads to boredom" feedback) is correct regardless of
  scale, and the phasing ("each independently mergeable") is what let P1/P2 ship
  while P3/P4 wait. The §2 convergence idea (expensive domain == ideal-author
  domain) stays elegant — *if* cost-variance ever materializes under a
  salvage-corrected signal.
