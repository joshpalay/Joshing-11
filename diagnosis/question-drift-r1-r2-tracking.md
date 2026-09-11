---
name: question-drift-r1-r2-tracking
status: active
opened: 2026-09-11
last-reviewed: 2026-09-11
owner: Josh
---

# Diagnosis: Question drift — impact of R1 (accessible fan-salience) and R2 (no self-defining setups)

_Started 2026-09-11 · Owner: Josh · Working branch: `claude/provenance-privacy-batch` (uncommitted at open)_

This is a measurement document. Two generation-prompt changes from
`audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md` were applied on
2026-09-11 and this file tracks whether they moved the corpus the way the
audit predicted, and whether they cost anything they should not (supply,
correct rate, spend). The Recommendation section is a running best-guess
until the Phase 2 hand-read lands.

---

## 1. What triggered this

The pipeline-level drift audit (`audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md`)
found that half of machine questions are not fan-salient, that the drift is
concentrated at the accessible tier (66% encyclopedia-lead, 16% fan-salient),
and that a third of accessible questions describe their own answer. Both were
traced to prompt text, not to model or gate failures. Josh asked for R2 first
("the answer in the question change") and then R1, both shipped the same day.

**What changed, exactly** (all in `src/server/daily/generate-questions.ts`):

| Ref | Where | Change |
|---|---|---|
| R2-a | `SYSTEM_PROMPT`, side-facts rule (was "Setup length is not the problem … a long atmospheric question is safe") | Now: one clause of framing is enough; length is not a virtue; a longer setup is more places for a wrong side-fact and more chances to describe the answer. |
| R2-b | `SYSTEM_PROMPT`, new **Rule 3c "DO NOT DEFINE YOUR OWN ANSWER"** after ONE CLEAN ANSWER | The gate's strike-the-interrogative test is now in the *generator* as a hard floor at every tier, with the 19th-Amendment BAD example, a GOOD re-aim, and the Picard's-brother "context is fine" contrast. |
| R2-c | `QUALITY_GATE_SYSTEM_PROMPT`, DEFINITION_SUPPLIED | The "when the stem leaves any real identification work … do NOT flag" softener is now specialist-only; accessible and moderate apply the test literally. |
| R1-a | `SYSTEM_PROMPT`, FAN-SALIENCE RULE, accessible bullet (was "PREFERRED but NOT required") | Now: fan-salience is still required at the *angle*, not the difficulty. Easy is fine; the roster/title/location/who-composed-it lead is not. "If the only fan-salient angle is obscure, that fact is not accessible — find a different well-known fact." |
| R1-b | `QUALITY_GATE_SYSTEM_PROMPT`, GENERIC_AT_TIER (was "NEVER flag an accessible-tier item") | Now tier-graded: full bar at moderate/specialist (unchanged), a *narrower* bar at accessible — flag only the encyclopedia first-line lead (character-by-role name, title, principal location, who composed/wrote/directed) with no hook. Any hook (object, line, scene, gag, nickname) → do not flag. |
| tests | `quality-gate-generic-tier.test.ts`, `quality-gate.eval.test.ts` | Pinned phrase moved; live eval now expects the Rory's-boyfriend roster question flagged at accessible and a Homer catchphrase question passed. |

R1 and R2 shipped in the **same window**, so their effects on the aggregate
gate-drop rate cannot be separated. The two hand-read metrics below are
disjoint by construction (definition-supplied → R2; roster-lead → R1), which is
what makes attribution possible at Phase 2.

Grading invariant: this is a generation-side change. **No grading flag or
grader model may flip until Phase 2 closes** (`PARTIAL_ANSWER_LEAK_ENABLED`,
`DOMAIN_DRIFT_DROP_ENABLED`, recheck prompt, grader model, fast-path rules).

## 2. Open decisions

1. **Keep R1's accessible bar, or revert to the exemption?** Decide at Phase 2 on the numbers in §4.
2. **Keep R2-c (gate softener specialist-only), or restore it for moderate?** Decide at Phase 1 if the quality-gate drop rate exceeds 45%.
3. **Accept the accessible-tier correct-rate dip?** R2 removes giveaways, so the easy tier gets a little less easy. Today this is unmeasurable (`empirical_correct_rate` populated on 30 of 2,191 rows) — decision 4 is a prerequisite.
4. **Ship R8 (write `n_answered` / `empirical_correct_rate` on every answer path; per-defect split in `GateDropStat`) before Phase 2?** Without it, decision 3 and half of §4's exit criteria are blind.
5. **When to ship R5 (declared-domain floor)?** Not before Phase 2 closes — it stacks on R1 and the June recalibration shows real harm from a blanket floor.

## 3. What we know so far — baselines (pre-change, measured 2026-09-11)

All numbers are from the audit; "(sample)" means the 220-row seeded hand read,
everything else is whole-live-corpus.

| Metric | Baseline | Target after change | Which change |
|---|---|---|---|
| Accessible-tier rows that are fan-salient (sample, n=85) | 16% | ≥ 40% | R1 |
| Accessible-tier rows that are encyclopedia/roster/glossary lead (sample) | 76% (66% + 10%) | ≤ 40% | R1 |
| Accessible-tier rows that are definition-supplied (sample) | 33% | ≤ 10% | R2 |
| All-tier definition-supplied (sample, n=220) | 20% | ≤ 8% | R2 |
| Machine mean words per question | 31.2 | ≤ 24 | R2-a |
| Machine rows over 25 words | 66% | ≤ 45% | R2-a |
| Machine rows opening "In …" | 58% | (not targeted; watch) | — |
| Quality gate drop rate (`GateDropStat`, since 2026-07-09) | 208 / 668 = 31% | 35–45% acceptable; > 45% = decision 2 | R1-b, R2-c |
| Difficulty-floor deflections | 13 / 668 = 2% | ≤ 5% (a jump means the model raised its self-label instead of its angle) | R1 |
| Accessible share of new machine rows | 41% | 30–45% (a fall below 25% = model dodged the tier) | R1 |
| Declared-domain rows at accessible | 42% | (R5's metric, not this doc's; record only) | — |
| Fact keys shared by ≥2 live rows | 55% of rows | falling on post-change rows (secondary; R1 reduces convergence on the generic lead) | R1 |
| Short-queue / `generation_failed` builds | (read from logs at Phase 1) | no rise | both |
| 30-day LLM spend, generation share | ~$25 / ~29% (Aug) | generation up by ≤ $2 | both |

Load-bearing assumption: the quality gate is *not* chronically failing open.
`GateDropStat` shows 229 fail-opens all on 2026-09-07 and 0 on every other day;
if fail-opens reappear, R1-b and R2-c are inert on those days and every
gate-side number below is invalid for them.

## 4. Plan

### Phase 0 — ship (target: 2026-09-11/12)
- Commit the four-file change on its own commit (not mixed with the friends/handle work already sitting in the same working tree), open a PR, deploy.
- **Record the production deploy timestamp here** — every Phase 1/2 query is `created_at > <deploy>`.
- Exit: deploy timestamp recorded in Updates.

### Phase 1 — mechanical signals (deploy + 7 days)
Run daily, or via `/diagnosis-review`:

```sql
-- gate behaviour since deploy (compare to 31% baseline; watch failed_open)
SELECT gate, SUM(considered) considered, SUM(dropped) dropped, SUM(failed_open) failed_open
FROM "GateDropStat" WHERE day >= '<deploy-date>' AND gate IN ('quality','difficulty_floor','answer_shape')
GROUP BY gate;

-- register + tier mix of NEW rows vs baseline (31.2 words / 66% >25w / 41% accessible)
SELECT
  COUNT(*) rows,
  ROUND(AVG(array_length(regexp_split_to_array(question_text, '\s+'),1)),1) mean_words,
  ROUND(100.0*AVG((array_length(regexp_split_to_array(question_text,'\s+'),1) > 25)::int)) pct_over_25w,
  ROUND(100.0*AVG((question_text ~ '^In\b')::int)) pct_in_opener,
  ROUND(100.0*AVG((difficulty_estimate='accessible')::int)) pct_accessible
FROM "GeneratedQuestion" WHERE created_at > '<deploy-ts>' AND is_duplicate = false;

-- starvation / short queue tripwire: builds that fell below the floor since deploy
-- (read [daily/generate-questions] "chunk returned no usable questions" and
-- orchestrator generation_failed counts from Vercel logs for the same window)
```

Exit criteria (all three, else stop and revisit decision 2 / wording):
- quality-gate drop rate on post-deploy rows ≤ 45% and `failed_open` = 0;
- no rise in short-queue / generation_failed builds versus the prior 7 days;
- accessible share of new rows ≥ 25% and difficulty-floor deflections ≤ 5%.

### Phase 2 — hand read (deploy + 14 days, or once ≥ 200 post-deploy live rows exist, whichever is later)
Repeat the audit's method on **post-deploy rows only**: seeded random sample of 100 accessible-tier rows and 100 rows across all tiers; label each row A (encyclopedia/roster/textbook lead), B (fan-salient), C (glossary definition), plus the definition-supplied overlay flag. Same labeller, same rubric as the audit appendix.

Exit criteria (the decision table for open decisions 1 and 2):

| Outcome | Reading | Action |
|---|---|---|
| accessible fan-salient ≥ 40% AND definition-supplied ≤ 10% AND Phase 1 clean | both changes worked | mark done; schedule R5 |
| definition-supplied ≤ 10% but accessible fan-salient < 30% | R2 worked, R1 wording not landing | rewrite R1-a; keep R1-b |
| accessible fan-salient ≥ 40% but definition-supplied > 15% | R1 worked, R2 ignored by generator (gate doing the work at supply cost) | strengthen Rule 3c wording; check gate drop reasons |
| accessible share of new rows < 25% | model dodged the tier instead of changing angle | R1-a is being read as "harder"; rewrite the "not harder" sentence |
| Phase 1 tripwire hit | supply cost | revert R1-b to exemption first (cheapest), re-measure |

### Phase 3 — correct-rate check (needs R8)
Once `empirical_correct_rate` is written on every answer path: accessible-tier correct rate on post-deploy rows vs pre-deploy rows. Expected: a dip of a few points (giveaways removed). Exit: dip ≤ 10 points. A larger dip means R1-a was read as "harder" regardless of what the tier mix says.

## 5. Recommendation (as of 2026-09-11)

Ship as-is, on its own commit, and do nothing else to generation or grading
for two weeks. The cheapest revert if Phase 1 trips is R1-b alone (restore the
accessible exemption in the gate) — the generator-side R1-a can stay because
it costs nothing when the gate is lenient. Do not ship R5 until Phase 2
closes. Ship R8 (telemetry) in the meantime; it is the only thing that makes
decision 3 answerable.

What would change this: a Phase 1 rise in short-queue builds on thin declared
domains (Spy School, Tears of the Kingdom) — that is the June failure mode
reappearing, and it means the accessible bar is being read as a difficulty
bar on domains that only have easy facts. The fix then is wording, not
revert: make the "find a different well-known fact" sentence louder and add
a thin-domain escape ("if the domain has fewer than N live rows, the roster
lead is acceptable at accessible").

---

## Updates

### 2026-09-11
Opened. R2 (three edits) and R1 (four edits + two test files) applied to the
working tree on `claude/provenance-privacy-batch`; full unit suite green after
R2 (412 files / 3,650 tests); the gate test files touched by R1 re-run green
(14 files / 105 tests; the 7 skipped files are the opt-in live evals, which
need `ANTHROPIC_API_KEY` and an evals flag). Typecheck carries one pre-existing error in `src/app/page.tsx`
(imports `getCoreAnswerCount`, which does not exist in `bonus.ts`) from the
branch's earlier uncommitted work — not from these changes. **Not yet
committed or deployed; deploy timestamp still to be recorded.** Baselines in
§3 are from the audit run the same day.
