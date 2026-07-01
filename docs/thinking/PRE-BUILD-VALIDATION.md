> GATE: run these before any build prompt.

# PRE-BUILD VALIDATION — confirm the foundation before any build prompt

**Status: action checklist. UPDATED with V1/V2/V3/V4 investigation results.**

## ⚡ RUN THESE THREE QUERIES FIRST (highest leverage, ~15 min total)

The investigations turned most open questions into numbers you can fetch now. Before any doc work or build:

1. **V2 north-star query (Supabase)** — is reaction-rate-on-wrong-answers >25%? The single most important number in the plan. Query in §2.
2. **V1 by-tier query (Axiom)** — is the hit-rate drop a harmless tier-mix shift, or an all-tier collapse (a real break)? Query in §1.
3. **V3 Query A (Supabase, on a quiet non-testing day)** — actual daily run-rate, by scope. The cost number the session argued about and never had. Query in §3.

Then the one thing no query can do: **§ hand-author 20, watch Robyn play** (step 3-offline).

The session produced a coherent, largely-designed model on very little new evidence. These steps put cheap, real contact with reality under the plan. Every investigation run so far has corrected something — run the rest before building.

---

## The three that actually gate the build

### 1. Is the bank hit-rate regression still live? — ⚠️ INVESTIGATED (V1): COST regression, not player-facing — with one condition

V1 result: the alert tracks bank hit vs fall-through — but a fall-through still serves the player a freshly-generated good question. So a hit-rate drop is a cost/latency regression, not a quality regression. No code break is visible (carry-forward intact, bank-match keys consistent). Most likely cause: a difficulty-tier-mix shift (recent commits moved tier requests deeper → bank holds less deep stock → blended rate drops with no bug) or a volume spike. This downgrades my earlier audit alarm — players are almost certainly NOT being degraded right now.

The condition — run the by-tier query (Axiom, `vercel` dataset):

```kql
vercel
| where _time > ago(3d)
| where message startswith "[daily/bank-telemetry]"
| extend outcome = extract("outcome: '([a-z_]+)'", 1, message)
| extend tierRequested = extract("tierRequested: '([a-z]+)'", 1, message)
| summarize total=count(), hits=countif(outcome=="hit") by tierRequested
| extend hitRatePct = round(100.0 * hits / total, 1)
| sort by total desc
```

- Per-tier rates hold, mix moved deeper → cost regression only. No emergency. Proceed.
- All three tiers dropped together → real supply/servability break (check `factKey`-null decay). Fix before anything else.

Cross-check player impact — search `vercel` for a coincident spike in `"[daily/queue-orchestrator] generation_failed"` or `"persisted short queue"`. Flat = players fine, purely a spend regression.

### 2. What is the north-star number RIGHT NOW? — ✅ QUERY READY (V2): run it

V2 result: the number is capturable today — the query must be assembled (no reaction-rate query landed as code), but the data exists. One structural note: reactions have no answer-level foreign key — they attach at `(question, context)`, not to a specific answer. Fine for measuring (feed's `contextId` is the answer, 1:1); a schema change only if you ever want per-answer attribution later. Caveats: `answerResult` mutates on recheck (wrong-then-corrected drops out — usually right); daily solo answers aren't reactable (correctly excluded).

Run this (Supabase SQL editor) — the `ALL` row vs the >25% target is your north-star:

```sql
WITH wrong_served AS (
  SELECT 'feed' AS surface, fi.id AS unit_id,
    EXISTS (SELECT 1 FROM "QuestionReaction" qr
            WHERE qr."contextType"='feed' AND qr."contextId"=fi.id) AS got_reaction
  FROM "FeedItem" fi
  WHERE fi."answerResult"='incorrect'
    AND COALESCE(fi."answeredAt", fi."sourceEventAt") >= now() - interval '30 days'
  UNION ALL
  SELECT 'joshing_game' AS surface, gr.id AS unit_id,
    EXISTS (SELECT 1 FROM "QuestionReaction" qr
            WHERE qr."contextType"='joshing_game' AND qr."contextId"=gr."gameId"
              AND qr."questionId"=gr."questionId" AND qr."senderUserId"=gr."userId") AS got_reaction
  FROM "JoshingGameResponse" gr
  WHERE gr."isCorrect"=false AND gr."answeredAt" >= now() - interval '30 days'
)
SELECT COALESCE(surface,'ALL') AS surface,
  count(*) AS wrong_served,
  count(*) FILTER (WHERE got_reaction) AS with_reaction,
  round(100.0 * count(*) FILTER (WHERE got_reaction) / NULLIF(count(*),0),1) AS reaction_rate_pct
FROM wrong_served GROUP BY ROLLUP (surface) ORDER BY surface NULLS LAST;
```

- `ALL` >25%: thesis holds — build the authoring machinery with confidence.
- Well below 25%: that is the real problem. The authoring model can't fix a thesis that isn't landing. Stop and address the core loop first.

### 3. Author ONE set by hand and have Robyn play it (the pivot test)

The entire human-authored pivot rests on one belief validated by zero experiments: hand-crafted questions beat machine questions enough to justify the labor. Test it directly, once, for the cost of an evening.

- **Do:** hand-author ~20 Paradise Lost (or any domain you love) questions — machine drafts candidates, you keep/kill/tweak, exactly the workbench loop. Have Robyn actually play them. Watch her actual reaction, especially on wrong answers.
- **The read:** do hand-crafted questions produce visibly better reactions than the machine-generated ones already in the system? Does the keep/kill/tweak loop feel good to you, or like a chore you'd abandon in three weeks (§ the "you + Robyn are the single point of failure" risk)?
- If yes on both: the pivot is validated by evidence, not reasoning — build with confidence.
- If the reactions aren't better, or authoring feels like a slog: the pivot's premise is shakier than the design assumes. Rethink before building the workbench.
- **Cost:** one evening. **Gates:** validates or breaks the entire authoring model for less effort than any single build.

---

## Two economic facts to pin (the cost picture is narrower than "$0.30/question")

The pivot IS justified — but precisely. What was proven: grounded refill as a primary supply mechanism costs ~$0.39 per kept question (high because of the ~73% gate drop rate, not because generating is expensive — cheap batch generation was ~$0.004/question, ~100× less). What was NOT proven: that this is your actual current spend, or that the machine floor needs the expensive path.

### 4. Measure actual current recurring spend — ✅ QUERY READY (V3): run on a quiet day

V3 result (with corrections):

- "Grading" ≠ the `*/answer` scopes — those are author-credit accounting, NOT LLM spend. Grading's LLM cost logs under the single scope `grade` (Haiku, cheap).
- Your recurring bill is owned by the daily CRON chain, not live player traffic — specifically Sonnet generation (`generate-questions` / `pool-refill-generate` at $3/$15 per M). This is the run-rate the session never measured; the $0.39/kept figure was a per-artifact unit cost, not this.
- batch-verify is bounded, not a runaway: ≤~50 calls/day by construction (self-capping, stamped so never re-swept). Its worry is overstated — but its logged $ is a floor (web-search fees + timed-out calls uncosted; both gaps concentrate here).

Run this (Supabase) on a representative quiet day (no manual refill testing) — set the date:

```sql
with pricing (model, in_rate, out_rate, cread_rate, cwrite_rate) as (values
  ('claude-sonnet-4-6',3.0,15.0,0.30,3.75),('claude-haiku-4-5-20251001',1.0,5.0,0.10,1.25),
  ('gpt-4o',2.5,10.0,0.0,0.0),('gpt-4o-mini',0.15,0.6,0.0,0.0),('gpt-4.1',2.0,8.0,0.0,0.0),
  ('gpt-4.1-mini',0.4,1.6,0.0,0.0),('gpt-4.1-nano',0.1,0.4,0.0,0.0)),
day as (select date '2026-06-30' as d)   -- ← set to a quiet day
select e.scope, count(*) as calls, round(avg(e.duration_ms)) as avg_ms,
  round(sum(e.input_tokens/1e6*coalesce(p.in_rate,0)
    + e.output_tokens/1e6*coalesce(p.out_rate,0)
    + e.cache_read_tokens/1e6*coalesce(p.cread_rate,0)
    + e.cache_create_tokens/1e6*coalesce(p.cwrite_rate,0))::numeric,4) as usd,
  count(*) filter (where p.model is null) as unpriced_calls
from "LlmUsageEvent" e cross join day left join pricing p on p.model=e.model
where e.created_at >= day.d and e.created_at < day.d + interval '1 day'
group by e.scope order by usd desc;
```

The top line — almost certainly a Sonnet generation scope — owns your monthly bill. (Query B for batch-verify backlog-vs-steady-state is in `PRE-BUILD-VALIDATION-PROMPTS.md`.)

### 5. Decide what the machine floor costs — cheap generation or grounded? — ✅ ANSWERED (V4): CHEAP

Result: the live per-user floor is bank reuse (free) or plain ungrounded Sonnet generation (~$0.004–0.02/kept). Grounded generation (~$0.39/kept) lives only in the paused refill cron and never runs on the per-user path. Near-term supply cost is already low.

Corrections this forces (applied to the other docs):

- "Un-pause refill as a cheap floor" is a CATEGORY ERROR. Refill is the grounded path — intrinsically the ~$0.39 mechanism. No cheap-floor variant exists to bring back; the cheap floor already runs by default. Turning refill on adds cost.
- The pivot is about QUALITY, not present cost. The cheap floor is cheap because ungrounded — and ungrounded Sonnet fabricates on thin niche domains (Spy School hallucination). Human authoring fixes that. The $215-vs-$2 comparison is true only of the grounded path (not running), so it's no longer the headline reason.
- Supply-pause rule: present cost never justifies un-pausing. The only trigger for grounding's return is a deliberate choice to pay for fabrication-prevention on thin domains, budgeted as added expense — not a saving.

---

## The meta-point

The plan is good and directionally right. But this session was almost entirely plan, built on one play session and a chain of sound reasoning. The next move is not more design, and not even the first build — it's the cheapest possible contact with reality (steps 1–3, all cheap) that could confirm or break the foundation before you invest in it. Steps 4–5 sharpen the cost story that justifies the pivot so it's precise rather than approximate.

Suggested order: 1 (is anything on fire — minutes) → 2 (does the thesis hold — the gating number) → 3 (does hand-authoring actually win — one evening) → 4–5 (pin the cost story). If 1–3 come back green, build the flag dashboard with confidence. If any comes back red, you've saved yourself building on sand.
