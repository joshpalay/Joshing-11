> RECORD of a design session. Thinking-in-progress; nothing here is ratified or a build instruction.

# SESSION SUMMARY — Supply → Human-Authored Pivot

**Date:** captured end of session. **Status of everything here: THINKING IN PROGRESS / NOT RATIFIED unless noted.** This is a record, not a set of commitments. No build prompts should be written from any of this until the pre-build validation (below) is done and the relevant decisions are ratified.

**One-line arc:** started chasing a cost spike and a "why is question supply so hard" problem; ended with a fundamentally different content model — human-authored finite sets with the LLM demoted to staff — plus a clear-eyed list of what still needs *validating* before any of it gets built.

---

## 1. How the session traveled (the narrative)

1. **Started operational.** A spend spike ($7.56 in a day) and a standing question: why is it so hard/expensive to get good questions for narrow domains? Plus a live bank hit-rate regression flagged early.
2. **Diagnosed the spend.** Mostly one-time Sonnet-4.6 refill *testing* burn (much of it unlogged timed-out calls), NOT a runaway prod loop. The Sonnet-5 flip was exonerated (cheap). The one recurring line worth watching: the `batch-verify` cron (~46 web-grounded verifications/day).
3. **Characterized grounded refill.** Verified runs showed: on Sonnet 5 throughput is fine (41 domains drained in ~165s, zero timeouts — the old 65%-timeout catastrophe was a 4.6 phenomenon; the async-Batch-API rebuild is NOT needed). Yield "collapse" was credit exhaustion, not a bug. Real unit cost: **~$0.39 per KEPT question** (high because of a ~73% gate drop rate; cheap batch generation without grounding/gating was ~$0.004 — ~100× less).
4. **The economic pivot — CORRECTED by V4 (see §5a).** Initial framing: human curation (~$0.004/kept) vs automated grounded refill (~$0.39/kept) → curation ~90× cheaper. **The V4 investigation later showed this is misleading for the near term:** the live per-user floor is *already* cheap (bank reuse free, or ungrounded Sonnet ~$0.004–0.02/kept). The ~$0.39 grounded path lives only in the paused refill cron and never runs per-user. So the pivot does NOT save present dollars. **The real justification is QUALITY / anti-fabrication:** the cheap floor is cheap *because* ungrounded, and ungrounded Sonnet fabricates on thin niche domains — the one failure the product can't tolerate. Refill demoted from *primary supply*; supply work PAUSED (and the pause creates no cost problem — the floor was already cheap).
5. **The bigger reframe.** Player feedback ("answering ever deeper leads to weirdness and frustration") + the cost finding converged: domains aren't infinite top-up pools, they're **finite sets** — and the LLM is a *disappointing author* (grades wrong, doesn't know what's important or clever). So invert authority: **human is author/canon-holder, LLM is staff** (drafts candidates, verifies, rewords, dedupes, provides an honest floor).
6. **The model grew a spine.** Across several refinements: finite sets → performance-based (not completion-based) mastery → no set-size cap/target (exhaustion is *discovered*, not declared) → optional arbitrary-depth domain tree (Book 3 → series → Rowling → Modern Fantasy) → a self-propagating contribution→mastery→evaluation loop → "running out" as the trigger to contribute → the authorship-exclusion invariant.
7. **Got concrete on the near-term.** Phase 1 = two crafters (Josh + Robyn), machine as staff, a **two-panel crafter admin** (flag queue + "where your craft is wanted"). Wrote a scoped D-doc for it.
8. **Audited ourselves.** Named the real risk: the session was ~95% designing, ~5% learning, on one play session's worth of evidence — with live issues (hit-rate regression, actual recurring cost) left unaddressed. Produced a pre-build validation checklist + investigation prompts.

---

## 2. What we decided (the settled model — but still un-ratified)

**The authority inversion (the core):** the human authors questions and holds canon; the LLM is staff — it drafts candidates to react to, verifies facts, rewords for fair grading, dedupes, and provides an honest floor for un-mastered domains. It never decides what is *worth asking*.

**Finite sets, not infinite pools:** a domain is a bounded body of good questions, as large as what clears the crafter's bar. No fixed size, no target, no cap. "Done" is *discovered* (nothing new clears the bar), never *declared*.

**Mastery is performance-based, not completion-based:** you master a domain by performing well across whatever exists, not by finishing a count. This killed the padding incentive and removed the last arbitrary number.

**Shallow/deep layering (a correction):** a good game needs a MIX, not all hand-crafted gems. Shallow/accessible questions are fine for the LLM (low bar by design); deep/arcane questions are where human authorship earns its keep. The mix is the fun.

**Quality × cost × availability are ONE constraint** (remaining good material), and cost is its cheapest-to-measure face → cost is the *tripwire* that detects exhaustion. When a domain runs out, say so honestly — it's a feature, not an error.

**Three doors at the "you're out" wall:** wait (we'll tell you when more come) / expand (climb the tree) / add one yourself (contribute).

**Optional arbitrary-depth domain tree:** domains nest where a master sees real structure (Shakespeare decomposes; Spy School stays flat). Mastery composes upward; graduation climbs. Record parent-per-node from day one; defer the upward-composition math.

**Contribution → mastery → evaluation loop:** you accrue standing from contributions that are *kept and hold up* (never from contributions *made* — that would be a farm). Newcomer → contributor → master → evaluator, one track. Self-propagating; seed masters (Josh + trusted few) bootstrap it. Its trigger is "running out."

**INVARIANT — a question is never served to its author.** Authoring spends a question outward; it never returns to its author. Requires an authorship-exclusion filter at every serving surface. Forces authoring to be *contributor* standing, separate from *play* mastery (closes a gameability hole structurally).

**Authored sets are (leaning) personal, not canonical:** you'd want to play Robyn's Paradise Lost, not your own — many personal sets can coexist; canonicalization is what the best-loved, proven-by-play sets *earn*. (Still formally open — Q3.)

**Phase 1 = Josh + Robyn as generalist crafters/reviewers**, machine as staff, two-panel admin. All community-scale machinery (domain-routed review, the full contributor system) deferred until the two-person core is proven.

---

## 3. What we're building first (Phase 1)

**A two-panel crafter admin view** (`D-FLAG-DASHBOARD-01`, drafted, NOT ratified):

- **Panel A — "Questions needing you":** merges the two quality streams that currently live apart — player reports (`contentReports`) and machine demotions (`needs_review` / `verificationVerdict`). Four actions: uphold-and-fix, edit, dismiss-and-restore, retire (soft/reversible). ~3 flags/day. This mostly *finishes a feature already half-shipped* — the batch-verify cron currently demotes into a surface no human reads.
- **Panel B — "Where your craft is wanted":** domains ranked by demand × shallowness, an *invitation* (not obligation) to author where it matters most. The telemetry already exists (`getThinActiveDomains` / `getDurablePoolDepthForDomains` + declared-interests / mastery tables). A player exhausting a domain lights it up here.

Mostly a surface over existing infrastructure. Small. Both panels Phase 1.

---

## 4. Open decisions (must ratify before building)

- **Q1** — how the contribution loop judges contributions, especially early before a domain has masters (the judgment step; fast-master-call vs slow-proven-by-play).
- **Q2** — how far the LLM's rewording may reach into a master's intent (hard line: variants yes, substance no).
- **Q3** — canonical-shared vs personal-gifted sets (Josh leans personal-primary; not settled).
- **Q4** — tree depth: who authors structure, whether mastery composes multiplicatively all the way up or one level, and where the tree's natural bottom is.
- **Flag-dashboard decisions A–G** — soft vs hard retire; what "restore from demote" writes; gate = env-allowlist vs role; surface the verifier's evidence; migration or not; what "demand" means for a crafter worklist; whether "shallow" counts human-authored depth.
- **The cost-tripwire threshold** (per problem-case) — how marginal is marginal enough to say "you're out." A legitimate number (economic floor), unspecified, differs per case.

---

## 5. THE CRITICAL CAVEAT — read before building anything

**This session was ~95% designing and ~5% learning, on one real play session's worth of evidence.** Two *live* issues were raised early and never resolved. Before ANY build prompt (even the flag dashboard), run the pre-build validation:

1. **Is the bank hit-rate regression still live?** (Orphaned since the session's start. Today-check.)
2. **What's the north-star reaction-rate right now?** (>25% = thesis holds, build with confidence. Below = fix the core loop first — the authoring machinery can't fix a thesis that isn't landing.)
3. **Hand-author 20 questions, have Robyn play them.** (The pivot's only real test. Offline — not a prompt.)
4. **Measure actual recurring spend by surface.** ($0.39 is a *unit* cost, not what you pay monthly.)
5. **Does the machine floor use cheap or grounded generation?** — ✅ ANSWERED (V4): CHEAP. Live floor is bank reuse (free) or ungrounded Sonnet (~$0.004–0.02/kept). Grounded (~$0.39) runs only in paused refill, never per-user. Present cost is fine; pivot is about quality, not cost; "un-pause refill as cheap floor" is a category error (refill IS the expensive grounded path). See §5a.

See `PRE-BUILD-VALIDATION.md` and `PRE-BUILD-VALIDATION-PROMPTS.md`. **If any of 1–3 comes back red, do not build — fix the foundation first.**

---

## 5a. VALIDATION RESULTS — V1/V2/V3/V4 ran; they corrected the picture

Four investigations ran (read-only). **Every one changed something** — strong evidence the design was running ahead of the facts.

**V4 (floor cost):** the machine floor is CHEAP (ungrounded ~$0.004–0.02/kept, or free bank reuse). The ~$0.39 grounded path is paused and never runs per-user. "Un-pause refill as a cheap floor" is a category error. **The pivot is about QUALITY / anti-fabrication, not present cost.** Supply-pause rule: present cost never justifies un-pausing.

**V1 (hit-rate regression):** a bank miss still serves a freshly-generated good question → the regression is **cost/latency, not player-facing quality.** No code break visible; most likely a difficulty-tier-mix shift or volume spike. **Downgrades the earlier audit alarm — players almost certainly NOT degraded.** Condition: run the by-tier query; an *all-tier* collapse (vs a mix shift) would be a real break to fix first.

**V2 (north-star):** the reaction-rate number is **capturable today** (runnable SQL in the validation checklist §2). Structural note — **reactions have no answer-level FK** (attach at question+context, not a specific answer); fine for measuring, a schema change only if per-answer attribution is ever needed.

**V3 (recurring cost):** correction — the `*/answer` scopes are author-credit accounting, NOT LLM spend; grading logs under `grade` (Haiku, cheap). **The recurring bill is owned by the daily cron chain running Sonnet generation** (`generate-questions`/`pool-refill-generate`), never measured before. batch-verify is bounded (≤~50/day, self-capping) — not the runaway; its $ is a floor (web-search + timeout gaps). Runnable cost query in the checklist §4.

**Still outstanding (the numbers, not the code):** run the V2 north-star query, the V1 by-tier query, the V3 cost query — and the one no query can do, the Robyn hand-authoring test. The investigations cleared the *code* questions; the *reality* questions remain.

---

## 6. Known risks we named (don't let these get lost)

- **Josh + Robyn are a single point of failure.** The human-authored engine runs on two people's finite time and enthusiasm. If either drifts, it stalls back to the machine floor.
- **The pivot's justification is QUALITY, not cost (V4-corrected).** Near-term supply cost is *already low* (the live floor is cheap ungrounded generation + free bank reuse). The pivot is worth doing because ungrounded generation *fabricates on thin domains* — a canon violation — not because it's cheaper. Don't let the old "curation is 90× cheaper" framing (true only of the paused grounded path) stand as the reason.
- **Model complexity crept back up** even as individual pieces simplified. A lot of interlocking machinery for 18 users — watch for over-engineering the community-scale system before the two-person core is proven.
- **The founding thesis went unexamined** all session. Everything assumes wrong-answers-bond-friends works. Validation step 2 is the test.
- **Contributor quality-control early** (before domains have masters) is the hardest unsolved piece of the community model.
- **Reactions have no answer-level FK (V2 finding).** They attach at `(question, context)`, not to a specific answer. Measurable now via the feed/game joins, but the proven-by-play mechanism (which the contribution loop leans on) may eventually want per-answer attribution — that would be a schema change. Note, don't fix.

---

## 7. Artifacts produced this session

- `CONCEPT-master-authored-canonical-sets.md` — the full model (thinking-in-progress).
- `PROBLEM-CASES.md` — the test suite: Ari (deep exhaustion), never-deep niche, shared-popular.
- `D-FLAG-DASHBOARD-01.md` — the first build, two-panel admin (proposed, not ratified).
- `crafter-workbench-mockup.html` / `crafter-admin-two-panel.html` — interactive mockups.
- `PRE-BUILD-VALIDATION.md` + `PRE-BUILD-VALIDATION-PROMPTS.md` — the validation gate.
- (This file) — the session record.

**Prior-session state that remains true:** supply work is PAUSED (`CC-SUPPLY-HALT-01`), refill/guard flags OFF, batch-verify cron running fine at ~3 flags/day, `B-QUESTION-QUALITY-AGENTS-01` shipped. The pause holds; nothing here unpauses it.
