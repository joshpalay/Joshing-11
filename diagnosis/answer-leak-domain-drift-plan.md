# Diagnosis: answer-leak & domain-drift gate rollout

_Started 2026-09-05 · Owner: Josh · Working branch: `claude/answer-leak-and-domain-drift-gates` (PR #1611)_

This is a living document. It tracks the open decisions from PR #1611 (three
new question-quality gates, two of them shipped in measure-only mode), the
plan to resolve them, and a dated log of what actually happened. Append to
**Updates** at the bottom rather than editing the history above it.

---

## 1. What triggered this

Two questions served in production on 2026-09-04/05 gave their own answers
away in the stem, and one was filed under the wrong domain:

| Question (stem gives it away) | Answer | Filed under |
|---|---|---|
| "...What specific **dental** benefit are the workers fighting to keep?" | "Dental plan" | The Simpsons |
| "In '**Lemon** of Troy'... recover Springfield's prized ......" | "lemon tree" | The Simpsons |
| "...refuses to sign **a petition for universal peace**... What cause did that petition support?" | "A petition **calling** for universal peace / ..." | **Virginia Woolf** (should be Joyce) |

Root causes and the three gates built to catch them are described in PR #1611.
Two of the three gates shipped **measuring, not dropping** -- this doc is
about how to decide whether/when to flip them on.

## 2. Open decisions

1. Flip `PARTIAL_ANSWER_LEAK_ENABLED` on, or keep measuring?
2. Flip `DOMAIN_DRIFT_DROP_ENABLED` on, or keep measuring?
3. Should the answer-shape gate (`ANSWER_SHAPE_GATE_ENABLED`, currently
   defaulting **on**) actually default **off** instead?
4. Is dropping the right response to drift at all, or should a drifted
   question be **re-filed** to the domain it's actually about, or even routed
   as an **expansion-offer signal** (the model noticing an adjacency the
   player hasn't declared)?

## 3. The reframe: shadow-mode measurement is the wrong instrument here

Generation runs at roughly **13 rows/day** (~90/week, trailing 8 weeks).
Against that throughput:

| Gate | Backtest hits (2,304 live rows) | Expected shadow-mode yield |
|---|---|---|
| Partial leak | 13 (0.56%) | ~1 hit per 9 days |
| Answer shape | 41 (1.78%) | ~1.6 hits per week |
| Off-domain drift | unmeasured (no eval built yet) | unknown |

Waiting a month on the counters buys ~2 partial-leak observations. The
2,304-row corpus backtest already produced 13, today, at zero risk. So
"measure in shadow mode" is the wrong tool for the two deterministic gates --
it's a good *regression* detector after a decision, a poor way to *make* one.

Separately: generation over-provisions and chunk-retries
(`GENERATION_CHUNK_SIZE` + retry in `generate-questions.ts`), so at hit rates
of 0.56% / 1.78% the **cost of a drop is close to zero**. That collapses all
three flag decisions to one question: **is the gate right when it fires?**
-- which is a precision question, not a volume question.

That said, the three gates are not the same *kind* of decision:

- **Shape + partial leak** are pure functions -- fully backtestable offline,
  no cost, no risk. The real unknown is whether "genuine leak" as I judged it
  matches Josh's judgment. That's a **labeling** problem. I wrote the rules
  *and* graded them against the corpus, which is the weakest link in what
  shipped.
- **Off-domain drift** is an LLM judgment with **zero** precision data run
  against it so far. It is also the gate whose false-positive mode is
  invisible and recurring -- silently dropping a *correctly-filed* question
  forever, with no counter that would ever surface it as wrong.

## 4. Plan

### Phase 1 -- Close the self-grading gap (unblocks decisions 1 and 3)
Build a blind-labeling script:
- Emit all 13 partial-leak hits + all 41 shape hits + ~50 unflagged controls,
  shuffled, stripped of which rule (if any) fired.
- An independent labeler (Sonnet, separate from the rule author) judges each:
  "would you serve this to a player?"
- Josh adjudicates only the **disagreements** between the rule and the
  labeler -- expected ~10 items, not 104.
- Output: precision per gate, plus a recall proxy from any control the
  labeler flags as bad that neither gate caught.

**Exit criteria:**
- Partial leak >= 90% precision -> flip `PARTIAL_ANSWER_LEAK_ENABLED` on.
- Shape >= 90% precision -> confirm default-on. Below ~75% -> default off and
  tighten the rule instead.

### Phase 2 -- Build the off-domain eval that doesn't exist yet (decision 2)
Use the existing live-eval harness (`quality-gate.eval.test.ts`,
`RUN_LLM_EVALS=1`, `npm run test:evals`) rather than building a new one.
Fixture set from real rows:
- **Positives** (should flag): 4 Joyce + 2 Forster rows filed under
  "Virginia Woolf's Novels and Essays"; Romantic Opera rows filed under
  "Romantic Era Orchestral Music".
- **Negatives** (must NOT flag -- containment): Mrs. Dalloway under Woolf,
  Sesame Street under Classic Children's Television, Breaking Bad under
  Color References Across Film and TV, `nt-*` (New Testament book) rows
  under New Testament.

**Exit criteria:** catches every known positive **and** flags zero
containment negatives. A single containment false positive disqualifies the
gate from dropping -- that failure mode is otherwise invisible in production.
Then run one full-corpus pass (~230 Haiku calls, negligible cost) for a real
hit rate before flipping `DOMAIN_DRIFT_DROP_ENABLED`.

**Until both conditions pass, this flag stays off.** This is the one gate I'd
resist flipping on today's evidence regardless of time pressure.

### Phase 3 -- Decide drop vs. re-file, on data (decision 4, first half)
Dropping the Joyce question destroys a good question and throws away the
taxonomy signal. But re-filing needs somewhere to put it, and that isn't
guaranteed -- the affected user has no "Joyce" domain, only "Ulysses (Joyce
Novel)" with 2 rows under a different `broad_category`.

Measure, across all historically-drifted rows: how often does a plausible
target domain already exist in that user's KB?
- **High hit rate** -> re-file to the existing domain; strictly better than a
  drop, no data model change needed.
- **Low hit rate** -> drop remains the right default; re-filing to a
  newly-minted domain is a bigger, riskier change (interacts with
  `reconcileBankDomain` / territory-depth accounting) and shouldn't be built
  speculatively.

### Phase 4 -- Drift as a demand signal (decision 4, second half -- likely the highest-value option)
The generator writing a Joyce question for a Woolf player isn't purely an
error; it may be the model noticing a real adjacency the player hasn't
declared. There's existing surface for this --
`src/server/daily/expansion-offer-diagnostic.ts`,
`src/server/db/queries/suggestion-catalog.ts`, declared interests. A
consistently-drifting domain could route to an expansion offer instead of
the bin. This is a product decision, not a gate-tuning exercise, and it's the
option most likely to be worth more than any single flag flip -- but it
should wait until Phases 1-3 establish whether drift is common enough to be
worth building for.

## 5. Recommendation (as of 2026-09-05)

Do Phase 1 first -- cheap, unblocks two of three decisions, and it's the one
place my own judgment shouldn't be the only signal. Prior: partial-leak flips
on, shape stays on -- but that should be confirmed against an independent
labeler, not taken on my say-so. Hold `DOMAIN_DRIFT_DROP_ENABLED` off
regardless of time pressure until Phase 2's eval passes both a positive and a
negative bar.

---

## Updates

### 2026-09-06
Folder created; plan captured as written and agreed. No phases started yet.

### 2026-09-06 (later) — Phase 1 started: blind labeling in progress
Extracted all 2,304 currently-servable (`is_duplicate = false`) rows from
prod via a read-only SELECT, then ran the actual shipped functions from PR
#1611 (`questionPartiallyLeaksAnswer`, `textContainsAnswer`,
`findAnswerShapeFailures` — not a re-derivation, the real code) against every
row to reproduce:

- **13** partial-leak hits
- **41** answer-shape hits
- a pool of rows flagged by neither, from which **50** were sampled as
  shared controls (deterministic shuffle, reproducible)

Built two blind sets for independent labeling, each rule's hits mixed with
the same 50 controls and shuffled so order carries no signal:
- `leak` set: 63 items (13 flagged + 50 controls)
- `shape` set: 91 items (41 flagged + 50 controls)

Labeler-facing copies carry only `{item_id, question_text, answer}` — no
rule tag, no flag, no row id — so the grading judgment can't be contaminated
by knowing which rule (if any) fired.

**Labeler:** two fresh, context-free subagents (no memory of this
conversation, no knowledge of which rule wrote which candidate, no exposure
to my reasoning about "genuine leak") — one per rule, run in parallel. This
is the check against my own self-grading in the original PR: I wrote both
rules and graded them against the corpus myself before shipping, which is
the exact weakness this phase exists to close. A real Anthropic-API-backed
Sonnet grading pass (matching how the app's own gates work) wasn't available
in this environment — no `ANTHROPIC_API_KEY` is present in the local
`.env` — so independent subagents stood in as the blind labeler instead.

Both labelers are running now. Next update will carry:
- LEAK / NO_LEAK and BAD_SHAPE / CLEAN counts per set
- precision per gate (of the rule's own hits, how many the labeler agrees
  are genuinely defective)
- a recall proxy (of the 50 controls, how many the labeler flagged as bad
  that neither rule caught)
- the specific disagreement items, for Josh to adjudicate directly (this is
  the ~10-item review the plan calls for, not the full 154)

**Still outstanding, unrelated to Phase 1:** the three original bad rows
(`800c44a3…`, `139e1932…`, `357618e3…`) are **still live and servable in
prod** — re-checked today, `is_duplicate` is still `false` on all three. The
demote SQL from PR #1611 has not been run yet.
