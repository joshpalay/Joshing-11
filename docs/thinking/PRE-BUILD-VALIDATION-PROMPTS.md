> Read-only investigation prompts. Run to validate the foundation.

# PRE-BUILD VALIDATION — Investigation Prompts

Four read-only investigation prompts derived from `PRE-BUILD-VALIDATION.md`. Each is a Claude Code prompt that answers one gating question against the live system. All are read-only — no builds, no flag flips, no LLM spend, no migrations. Run them, paste findings, decide.

Note on step 3 (the hand-authoring test): that step from the checklist is not a prompt — it's you authoring ~20 questions and watching Robyn play them. No prompt substitutes for it. It's listed here only so the set is complete; do it in the real world.

Suggested order: V1 (is anything on fire) → V2 (does the thesis hold) → [step 3, offline] → V3 + V4 (pin the cost story).

---

## V1 — Is the bank hit-rate regression still live? (run FIRST)

```
Read-only investigation. NO writes, NO builds, NO LLM calls. Clone depth-1.

CONTEXT: Early in a prior session an Axiom alert fired — bank hit-rate dropped
well below baseline. Root-cause candidates named at the time: pool-refill
stalling, carry-forward breaking, key/dimension mismatch, or a volume spike.
The investigation was blocked on repo access and never resumed. I need to know
if this is STILL DEGRADING players right now.

READ-FIRST (confirm, paste back):
1. src/server/daily/queue-orchestrator.ts — locate the hit-rate / bank-serve
   logic and how a "hit" (served from bank) vs "miss" (had to generate) is
   counted. Capture the exact metric and where it's emitted (Axiom? a log line?).
2. src/server/db/queries/daily.ts — the carry-forward query and the
   key/dimension the bank is matched on (domainKey? canonicalSubcategory?).
3. src/server/daily/__tests__/topup-carryforward.test.ts and
   queue-floor.test.ts — what invariants these assert (tells you what
   "healthy" looks like).

INVESTIGATE (report findings, do not fix):
- Does the carry-forward path look intact, or is there a visible break
  (key mismatch, a filter that drops carried questions, a stale dimension)?
- Is there a recent change to the bank-match key or dimension that would
  explain a hit-rate drop?
- What would I query in Axiom (or the DB) to see CURRENT hit-rate vs baseline?
  Give me the exact metric name / query.

DELIVER: a short findings note — is the regression mechanism visible in code,
what's the most likely cause of the named candidates, and the exact query to
check if it's still live. If it looks actively broken, say so plainly and
stop — that becomes a fix, ahead of any redesign.

DO NOT fix anything, flip flags, or run generation. Read and report only.
```

## V2 — What is the north-star reaction rate right now? (the thesis test)

```
Read-only investigation. NO writes, NO builds, NO LLM calls. Clone depth-1.

CONTEXT: The product's core thesis is that wrong answers are connection events —
measured by REACTION RATE ON WRONG ANSWERS, target >25%. B-METRIC-REACTION-RATE-01
was drafted and verified against live schema. I need the current number, and
whether the query to get it already exists or needs assembling.

READ-FIRST (confirm, paste back):
1. src/server/db/queries/reactions.ts — how reactions are stored and queried.
   What counts as a "reaction"? Is it tied to a specific answer outcome
   (correct vs wrong)?
2. The schema for reactions + answer outcomes — can a reaction be joined to
   whether the answer was WRONG? (The north-star is specifically reactions on
   WRONG answers, not all reactions.)
3. Any existing reaction-rate query or the B-METRIC-REACTION-RATE-01 draft if
   it landed as code.

INVESTIGATE (report, do not build):
- Write (as a proposed read-only SQL query, do NOT run migrations) the query
  that computes: of wrong answers served, what fraction got a reaction, over
  the trailing 30 days.
- If the data needed to compute it exists, give me the query to run in the
  Supabase SQL editor.
- If something's missing (e.g. reactions aren't joinable to wrong-answer
  events), say exactly what's missing — that gap is itself a finding.

DELIVER: the runnable read-only query for current reaction-rate-on-wrong-answers,
OR a precise statement of what's not yet capturable and why. Do not build the
metric surface — just make the number gettable.

DO NOT write migrations, build surfaces, or run generation.
```

## V3 — What is actual current recurring spend, by surface? (the real cost number)

```
Read-only investigation. NO writes, NO builds, NO LLM calls. Clone depth-1.

CONTEXT: A prior session diagnosed a spend spike as mostly one-time refill
testing on Sonnet 4.6, plus the batch-verify cron as the recurring line. The
STEADY-STATE recurring cost was never measured. I need the real per-day
baseline and which surface owns it — the unit cost ($0.39/kept refill question)
is NOT the same as what I actually pay per month.

READ-FIRST (confirm, paste back):
1. The llmUsageEvent table + recordLlmUsage in schema.ts — confirm the scope
   vocabulary (every distinct scope string logged). Group them into: generation,
   grading (the */answer scopes), quality-crons (vet/quality-gate/quality-
   aggregation/batch-verify), interest/categorization, refill.
2. MODEL_PRICING in pricing.ts — the per-model rates, to reprice inline.

DELIVER (as read-only SQL for the Supabase editor — do NOT run migrations):
- A query: for a given day, spend by scope (repriced to USD via the pricing
  rates), ordered biggest-first, with call counts and avg duration.
- A note on the TWO known ledger gaps (web-search spend not logged; timed-out
  calls not logged) so I read the number with those caveats.
- Specifically size the batch-verify recurring line: calls/day and est $/day,
  and whether it's draining a one-time backlog or at steady state.

DELIVER: the query + a plain-language read of "here's your real recurring daily
cost and which surface owns it." This also finishes the batch-verify cost
characterization that was flagged and never done.

DO NOT run migrations, build anything, or trigger any cron/LLM call.
```

## V4 — Does the machine floor use cheap or grounded generation? (the pivot-cost linchpin)

```
Read-only investigation. NO writes, NO builds, NO LLM calls. Clone depth-1.

CONTEXT: The human-authored pivot's cost savings apply to MASTERED domains.
At ~18 users almost every domain is UN-MASTERED, so the machine "floor" carries
most near-term content. The open question: does the floor use CHEAP batch
generation (~$0.004/question — fine) or GROUNDED generation (~$0.39/kept — still
expensive on most domains)? This decides whether near-term cost is actually a
problem or already fine, and whether the paused refill should come back JUST as
a cheap floor generator.

READ-FIRST (confirm, paste back):
1. src/server/daily/generate-questions.ts — trace what happens when a domain
   is thin / has no durable pool. Which generation function fires? Does it call
   the plain generation path or the grounded (web-search) path?
2. src/server/daily/queue-orchestrator.ts — the fallback ladder when the bank
   can't fill five. What does each rung actually invoke, and does any rung hit
   grounded generation (web_search) vs cheap generation?
3. src/server/daily/retrieval-grounded.ts — confirm grounded refill is
   flag-gated OFF (RETRIEVAL_GROUNDING_ENABLED default false), so it is NOT
   currently the floor. Then: with it off, what IS the floor for a thin domain?

INVESTIGATE (report, do not change):
- For an un-mastered/thin domain TODAY (refill off), what generates the
  questions a player gets — cheap generation, grounded, or nothing (short queue)?
- Estimate the per-question cost of that actual path.
- State plainly: is near-term floor cost CHEAP (pivot is about quality, not
  present cost) or EXPENSIVE (most domains still pay the high rate, and refill-
  as-cheap-floor may deserve un-pausing separately from its rejected
  primary-supply role)?

DELIVER: a clear answer to "what does the floor cost today, and does that change
the supply-pause decision." No code changes.

DO NOT flip flags, build, or run generation.
```

---

## After the four run

- V1 red → fix the live regression before anything else.
- V2 → the gating number. >25% = thesis holds, build with confidence. Well below = fix the core loop first, not the authoring machinery.
- Step 3 (offline) → hand-author 20, watch Robyn play. The pivot's real test.
- V3 + V4 → the honest cost story: what you actually pay, and whether the floor is cheap or expensive (which may re-open the refill pause for the floor role only).

If V1 is clean, V2 is green, step 3 feels good, and V3/V4 show manageable cost — build the flag dashboard (`D-FLAG-DASHBOARD-01`) with confidence. If any come back red, you've saved yourself from building on sand.
