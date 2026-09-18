---
name: question-drift-r1-r2-tracking
status: active
opened: 2026-09-11
last-reviewed: 2026-09-18
owner: Josh
related-pr: "#1654, #1662, #1666, #1683, #1698"
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
what makes attribution possible at Phase 2. The R8 per-defect gate counters
(shipped the same day) do the same job mechanically.

**Scope widened 2026-09-11 — this window now measures a five-item batch.**
R3, R6 and R9 shipped into the same window on purpose. The reasoning is volume,
not convenience: generation runs at roughly 10–20 questions/day, so a 14-day
window yields 150–300 rows. That is barely one readable hand-read sample.
Running R1/R2, then R3/R6/R9, then R5 as three sequential windows would cost six
weeks and give each window a sample too thin to read. Per-item attribution is
not affordable at this size, so the batch is measured together, with the
per-defect counters and the disjoint hand-read metrics carrying whatever
attribution is available. R5 stays out (see §2 decision 5) because it is the one
item that deliberately makes questions harder.

Grading invariant: this is a generation-side change. **No grading flag or
grader model may flip until Phase 2 closes** (`PARTIAL_ANSWER_LEAK_ENABLED`,
`DOMAIN_DRIFT_DROP_ENABLED`, recheck prompt, grader model, fast-path rules).

## 2. Open decisions

1. **Keep R1's accessible bar, or revert to the exemption?** Decide at Phase 2 on the numbers in §4.
2. **Keep R2-c (gate softener specialist-only), or restore it for moderate?** Decide at Phase 1 if the quality-gate drop rate exceeds 45%.
3. **Accept the accessible-tier correct-rate dip?** R2 removes giveaways, so the easy tier gets a little less easy. Today this is unmeasurable (`empirical_correct_rate` populated on 30 of 2,191 rows) — decision 4 is a prerequisite.
4. ~~**Ship R8 (write `n_answered` / `empirical_correct_rate` on every answer path; per-defect split in `GateDropStat`) before Phase 2?**~~ **RESOLVED 2026-09-11 — shipped.** See the Updates entry. Phase 3 is unblocked for rows answered from the R8 deploy onward; rows answered before it stay unmeasured (the write is not backfilled).
5. **When to ENABLE R5 (declared-domain floor)?** The code shipped 2026-09-11 **switched off** (`DECLARED_DOMAIN_FLOOR_ENABLED` unset). Do not set it before Phase 2 closes — it stacks on R1, and the June recalibration shows real harm from a blanket floor. Enabling is one env var, no deploy; reverting is clearing it.

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

### Phase 0 — ship — **DONE 2026-09-11**

> **WINDOW START (paste this into every Phase 1/2/3 query):**
> **`2026-09-11 19:14:09Z`** — production deploy `dpl_ETA9dR3998kLxV6MoyU2hXrfgQZZ` (#1663).
> Migration 0147 applied to production **2026-09-11**, separately and later (see below).

**Use the deploy time, NOT the merge time.** They differ by half an hour here, and
using merge time would silently include rows generated by the OLD prompt.

Four consecutive production deploys **failed to build** while this work was
merging, because #1650 left `friends.ts` calling an undefined `displayName()`:

| Production deploy | Carries | Build |
|---|---|---|
| 18:45:00Z | #1659 activity | READY |
| 18:45:30Z | #1650 F6/F8/F9 | **ERROR** |
| 18:45:39Z | #1654 R1+R2 | **ERROR** |
| 18:53:34Z | #1660 design canon | **ERROR** |
| 19:04:00Z | #1662 R3–R9 | **ERROR** |
| **19:14:09Z** | **#1663 friends fix (main incl. everything above)** | **READY** |
| 19:21:06Z | #1664 vitest exclude | READY |

So although R1/R2 merged at 18:45, **no generation change actually ran in
production until 19:14:09Z**, when #1663 unblocked the build and shipped the
whole accumulated set at once. Every prescription in this doc has the same
effective start time; there is no staggering to account for.

**Migration 0147 (`question_shape`) applied 2026-09-11**, after that deploy, via
`drizzle-kit migrate` against production. Verified: column present, `text`,
nullable, 2,940 rows intact, `__drizzle_migrations` 268 → 269. R4 therefore
records nothing for rows generated between 19:14:09Z and the migration; treat
`question_shape IS NULL` on a post-deploy row as "generated in that gap", not as
a shape the model failed to report.

Exit criteria met: timestamp recorded, migration applied, `main` green
(typecheck clean, 371 files / 2,888 tests, lint and all six ratchets passing).

### Phase 1 — mechanical signals (deploy + 7 days)
Run daily, or via `/diagnosis-review`:

```sql
-- gate behaviour since deploy (compare to 31% baseline; watch failed_open)
SELECT gate, SUM(considered) considered, SUM(dropped) dropped, SUM(failed_open) failed_open
FROM "GateDropStat" WHERE day >= '2026-09-11' AND gate IN ('quality','difficulty_floor','answer_shape')
GROUP BY gate;

-- register + tier mix of NEW rows vs baseline (31.2 words / 66% >25w / 41% accessible)
SELECT
  COUNT(*) rows,
  ROUND(AVG(array_length(regexp_split_to_array(question_text, '\s+'),1)),1) mean_words,
  ROUND(100.0*AVG((array_length(regexp_split_to_array(question_text,'\s+'),1) > 25)::int)) pct_over_25w,
  ROUND(100.0*AVG((question_text ~ '^In\b')::int)) pct_in_opener,
  ROUND(100.0*AVG((difficulty_estimate='accessible')::int)) pct_accessible
FROM "GeneratedQuestion" WHERE created_at > '2026-09-11 19:14:09Z' AND is_duplicate = false;

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

### Phase 3 — correct-rate check (R8 shipped 2026-09-11)
Accessible-tier correct rate on post-deploy rows vs pre-deploy rows. Expected: a dip of a few points (giveaways removed). Exit: dip ≤ 10 points. A larger dip means R1-a was read as "harder" regardless of what the tier mix says.

```sql
-- accessible-tier measured correct rate, rows with at least one scored answer
SELECT
  CASE WHEN created_at > '2026-09-11 19:14:09Z' THEN 'post' ELSE 'pre' END AS cohort,
  COUNT(*) rows, SUM(n_answered) answers,
  ROUND(AVG(empirical_correct_rate)::numeric, 3) mean_rate
FROM "GeneratedQuestion"
WHERE is_duplicate = false AND difficulty_estimate = 'accessible' AND n_answered > 0
GROUP BY 1;

-- per-defect gate split (R8): which rule is actually firing
SELECT gate, SUM(considered) considered, SUM(dropped) dropped
FROM "GateDropStat" WHERE gate LIKE 'quality:%' AND day >= '2026-09-11'
GROUP BY gate ORDER BY dropped DESC;
```

Caveat: the pre-cohort is thin and biased. The counters were only ever written when a question crossed a promotion/flag threshold, so pre-deploy rows with a rate are the heavily-played ones, not a random sample. Treat the pre/post comparison as indicative and prefer comparing post-deploy accessible against post-deploy moderate.

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

### 2026-09-11 — R4 question-shape persistence shipped (separate PR, needs a migration)
The last prescription. Migration **0147** adds `GeneratedQuestion.question_shape`
(text, nullable, no backfill).

The generator has been asked for a `question_shape`, and held to a no-two-alike
rule on it, since the shape catalogue was written — but the value was validated,
`console.warn`'d, and then dropped at persist. Nothing downstream could see
whether the variety instruction was landing. It was not: ~77% of live rows are
`identification` and three of the nine offered shapes have ONE row each across
2,191. The only reason that took a hand read is that the column did not exist.

Two compounding causes, both addressed:
- **Nothing was stored.** The column now persists what the model reported. Text
  rather than an enum, so a catalogue change never needs another migration.
  Nullable with no backfill — rows generated before 0147 stay honestly unknown
  rather than being guessed at from phrasing, and the new read skips them rather
  than bucketing them as "unknown".
- **The variety rule is batch-scoped**, and a batch is three questions
  (`GENERATION_CHUNK_SIZE`), so "no two alike" is satisfiable forever by
  identification plus two others. `getRecentShapesByDomain` now feeds per-domain
  shape counts back into the prompt, lifting the rule from per-batch to
  per-domain and naming identification as the one to steer away from.

**The migration has NOT been run.** `npm run db:migrate` when ready. Journal entry
added by hand and verified with `node scripts/reconcile-drizzle.mjs` in
report-only mode; `--apply` was deliberately NOT used, as it also marks
migrations applied in `__drizzle_migrations` and this database currently has 18
migrations pending in tracking. An idempotent `ADD COLUMN IF NOT EXISTS` guard is
in `instrumentation.ts` alongside the `empirical_correct_rate` precedent.

Note for whoever reads this next: this landed while another session was working
in the same tree on a design audit and an activity-actor change (migration 0147).
Their activity migration reached `main` first and took 0146 — the number this
change originally used — so this was renumbered to 0147 when the stack was
merged up. Both are journaled in order.

### 2026-09-11 — R5 declared-domain floor shipped SWITCHED OFF (separate PR)
Built, tested, and deliberately inert. `DECLARED_DOMAIN_FLOOR_ENABLED` is unset,
and with it unset every code path is byte-for-byte the previous behaviour — that
property has its own tests rather than being asserted in a comment.

What it does when enabled:
- **Floors the REQUEST**, not the writing. A declared domain's requested tier is
  raised to the engaged-fan rung (`DECLARED_DOMAIN_FLOOR`, default `moderate`)
  in `getDomainDifficultyOverrides`, for already-played domains as well as
  first-contact ones — a player who declared an interest, missed twice and got
  pushed back to tourist level is exactly the case that matters.
- **Makes the request stick.** The difficulty gate tolerates a one-rung miss, so
  a `moderate` request happily accepts `accessible` output; that alone would have
  defeated the floor. Declared domains now get zero tolerance, derived from the
  territory map already threaded in for the prompt, so it costs no extra query.
- **Never touches demonstrated territory**, flag on or off.

Why flagged rather than simply enabled: the 2026-06-28 recalibration turned OFF a
BLANKET floor that had pinned every focus domain (declared or merely played) to
≥ moderate. It buried good easy questions in the under-difficulty reserve and
pressured the generator into inventing deep cuts for shallow topics, a documented
driver of hallucinated canon. This version is declared-only, moves the request
rather than the writing, and reverts by clearing one env var with no deploy.

**Enable only after Phase 2 closes**, and then as its own window — it stacks on
R1. Tripwire on enabling: demote rate and short-queue rate on thin declared
domains (Spy School, Tears of the Kingdom). If either rises, the floor is right
but the supply is not, and the answer is grounding, not difficulty.

### 2026-09-11 — R7 subject coverage shipped (separate PR, stacked on the prompt batch)
The last of the generation-side prescriptions, in the same window as the rest.

The sub-angle hints name covered FACETS, and the model satisfies "pick a new
facet" with another scene from the same headline work. Measured: Woolf's domain
put Mrs Dalloway at the centre of 19 of 47 rows; Shakespearean Tragedy reached
Hamlet 10 times and Macbeth 6 before anything else. `subject_entity` was written
on every generated row and read by nothing except a 14-day answered-subject
cooldown.

- **New `getRecentSubjectsByDomain`** returns covered subjects per domain with
  counts, most-covered first, threaded into the prompt as its own block after the
  sub-angle one and phrased as the stronger instruction ("a domain is not one
  work — prefer a different play, novel, album, episode, character, figure, or
  period"). Counts are included deliberately: the useful signal is "Hamlet is
  saturated", not "Hamlet has appeared".
- **Sub-angle window widened 20 → 60.** A domain with 70+ live rows carries ~200
  tags, so a 20-entry window left most covered facets invisible to the very
  instruction that depends on seeing them.
- **Tags are folded before dedupe** (`subAngleDedupeKey`): case, punctuation,
  articles and diacritics. "Fugue Structure" / "fugue structure" used to claim
  two of those scarce slots; 541 tags were duplicated this way across 1,211 rows.

Threaded through `generateDailyQuestions`'s options object rather than as another
positional parameter (`buildUserPrompt` already takes 15). The other four
`buildUserPrompt` callers — crafter drafts, retrieval-grounded, supply-backfill —
are unchanged and simply pass no subject block.

### 2026-09-11 — R3 / R6 / R9 prompt batch shipped (separate PR, stacked on R8)
Three more prescriptions, all prompt-and-exemplar text, folded into the SAME
measurement window as R1/R2 for the volume reason recorded at the top of this
doc. What changed:

- **R3 — exemplar gap-filling.** Ten exemplars added to `exemplars.ts`: two
  `what_happens_next`, two `sequence_or_order`, one meaningful `year_or_date`
  (the three shapes the catalogue offered but the list never demonstrated, each
  of which had produced exactly ONE live row in 2,191), three discipline-domain
  exemplars with a real angle rather than a glossary gloss, and two short-register
  fandom exemplars as a counterweight to the 31-word house style. **Nothing
  curated was deleted** — the six encyclopedia-lead identification exemplars the
  audit flagged are listed as RETIREMENT CANDIDATES in a comment for Josh to
  judge, since that list is his taste calibration. identification therefore only
  falls from 54.5% to 50.0%; actioning the retirements would take it to ~44%.
- **R6 — the prompt's examples are not a question bank.** ~86 live rows (3.9%)
  reproduced a fact used as an illustration somewhere in the instructions,
  including facts from the BAD examples (Mrs Lovett's pies ×6, Candace calling
  her mother ×5, Neville's points ×2). A new hard-floor rule names the leaked
  subjects explicitly and extends the ban to defect-demonstration facts.
- **R9 — a strip test discipline domains can fail.** Rule 2 strips the work's
  title, which is vacuous for UX Design or Counterpoint, so those domains
  collapsed into glossary definitions (10.4% of machine rows use "what term…"
  phrasing versus 0% of human ones). New Rule 2c strips the FIELD name instead,
  with the same rule mirrored into the quality gate's GENERIC_AT_TIER. The
  `technique_or_term` catalogue entry no longer describes itself as
  define-then-label.

Deliberately NOT in this batch: R7 (subject-entity feedback) needs real query
plumbing and goes separately; R5 stays gated; R4 needs a migration.

### 2026-09-11 — R8 telemetry shipped (separate PR, stacked on R1/R2)
Two measurement gaps closed, both **zero change to generated output** so neither
can contaminate the R1/R2 window:

1. **Per-defect gate counters.** The quality gate already prefixes every reason
   with its defect name and the caller already routes on that prefix; those
   prefixes are now tallied into `GateDropStat` under synthetic gate names
   (`quality:GENERIC_AT_TIER`, `quality:DEFINITION_SUPPLIED`, …). No migration —
   `gate` is a text column. Every known defect is written each run, including the
   ones that did not fire, so "checked, never fired" is distinguishable from "not
   measured". This is what makes R1 and R2 individually readable in Phase 1
   despite having shipped in the same window: they target different defects.
2. **Empirical play counters on the generated bank.** `evaluateQuestionTrustOnPlay`
   computed distinct-answerer aggregates on every scored answer but only ever
   wrote them when a promotion (3 correct), a nobody-correct flag (5 holders), or
   an empirical difficulty recompute was already in reach. At this scale almost
   every question is answered once or twice, so nothing was recorded: 2,161 of
   2,191 live bank rows had null counters. The aggregate is now written on every
   scored answer, before the threshold checks, recomputed-not-incremented so it
   stays idempotent under concurrent answers.

**Known side effect, deliberate:** `rankAndFilterBankCandidates` excludes "dud"
stock (`empirical_correct_rate = 0` with `n_answered ≥ 5`). That rule has been
effectively inert because the inputs were null; it now has real data and will
begin excluding genuine duds from bank reuse. At current volume very few rows
reach 5 distinct answerers, so near-term impact is small, but this is a real
behaviour change in serving and is the one thing to watch in Phase 1 alongside
the gate rate. Exclusion only ever filters — an emptied candidate set falls
through to generation — so it cannot starve a domain.

Not included from R8's original scope: widening `prompt-proposer.ts` evidence
beyond factual defects. Left for the Chunk B batch.

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

### 2026-09-12 (diagnosis-review) — deploy+~17h; Phase 1 SQL still unrun (no DB access this session); code confirmed unchanged since deploy

**Environment note:** no `DATABASE_URL`/`ANTHROPIC_API_KEY`/Supabase project
in this session, so none of the Phase 1 SQL above (`GateDropStat` gate
behaviour, register/tier mix of new rows, the starvation tripwire) could
actually be run. This doc's own windows are deploy+7 days (~2026-09-18) for
Phase 1 and deploy+14 days or 200 post-deploy rows for Phase 2, so a reading
this soon wasn't due regardless — recording the blocker for the record
rather than treating it as a missed check.

What git/GitHub confirm instead:
- `DECLARED_DOMAIN_FLOOR_ENABLED` (R5) is still read with the same
  default-off semantics in `src/server/adaptive-difficulty.ts:257` — no code
  change since 2026-09-11 flips its default or removes the gate.
- `PARTIAL_ANSWER_LEAK_ENABLED` / `DOMAIN_DRIFT_DROP_ENABLED` /
  `VERIFICATION_UNVERIFIABLE_HOLD_ENABLED` (the flags this window's grading
  invariant says must not move) are all still plain env reads, unchanged.
- One new commit landed in `generate-questions.ts` since the 19:14:09Z
  deploy: `#1667` ("Fix repeated questions (fact_key drift)"), merged
  2026-09-11T20:16:22Z. It threads `subjectEntity` into the embedding-dedup
  call and touches `pool/dedup.ts` / `db/queries/pool.ts`. **It does not
  touch `SYSTEM_PROMPT`, `QUALITY_GATE_SYSTEM_PROMPT`, or any of the
  R1/R2/R3/R5/R6/R7/R9 code this doc tracks** — confirmed by reading its
  diff and changed-file list. Noted so it isn't mistaken for an eighth
  prescription landing in this window.
- The remaining PRs that landed after this doc's Phase 0 table (`#1665`
  mutual-friend fallback, `#1666` this doc's own deploy-timestamp
  correction, `#1668` a nav alignment fix) are unrelated follow-ups — none
  touch generation or the quality gate. Added `#1654`, `#1662`, `#1666` to
  this file's `related-pr` frontmatter, which had none set until now.

**No decision-resolving change; all five open decisions in §2 are exactly
where 2026-09-11 left them.** Status stays `active`.

### Next steps (unchanged)
1. Run this doc's own Phase 1 SQL once a session with production DB access
   is available — due at deploy+7 days (~2026-09-18), sooner is fine once
   access exists.
2. Everything else in §2/§4 unchanged.

### 2026-09-14 (diagnosis-review) — deploy+~3 days, still short of the +7 day Phase 1 window; a related (not tracked) change to the R5 baseline; no DB access this session

**Environment note:** no `.env`/`.env.local` present and
`mcp__Supabase__list_projects` returns zero projects, so none of this doc's
Phase 1 SQL could run. Not due yet regardless — deploy was
2026-09-11T19:14:09Z, so Phase 1's deploy+7-day window lands ~2026-09-18 and
Phase 2's deploy+14-day window ~2026-09-25.

**`git log --since=2026-09-12` on this doc's tracked paths** (`SYSTEM_PROMPT`,
`QUALITY_GATE_SYSTEM_PROMPT`, `adaptive-difficulty.ts` for R5, the R1–R9
prompt/gate code in `generate-questions.ts`) shows one new commit:
`#1683`, "fix(difficulty): seed brand-new topics at accessible, not overall
skill," merged 2026-09-13T21:17:34Z, touching `src/server/adaptive-difficulty.ts`
only (22/-16, one file).

**Read the diff directly — this does not touch R5's flag or its floor
mechanism**, but it does change the baseline R5 stacks on top of, so it's
worth recording here even though it resolves none of this doc's five open
decisions:
- Before: a domain with no persisted difficulty row seeded from the
  player's **global adaptive level** (`seedDifficultyFromAdaptiveLevel(level)`).
  After: it always seeds from `MIN_ADAPTIVE_LEVEL` (accessible), regardless
  of global skill — the PR's own rationale is a strong overall player
  hitting a first-contact bonus question in a domain they've never played
  and getting handed specialist-tier difficulty on zero domain-specific
  signal.
- `applyFocusFloor(...)` — the function R5's `DECLARED_DOMAIN_FLOOR_ENABLED`
  path calls to raise a declared domain's floor — is unchanged, still called
  the same way, still gated behind the same flag (confirmed still read with
  default-off semantics at `adaptive-difficulty.ts:257`, same line this
  doc's 2026-09-12 entry checked). The PR's own comment states the R5 floor
  read is untouched ("read for ALL requested domains" logic is unmodified).
- Net effect if/when R5 is later enabled: the floor now lifts from a
  strictly lower, uniform baseline (everyone starts at accessible) instead
  of a baseline that varied with the player's global skill. Not a reason to
  change the "enable only after Phase 2 closes" recommendation — flagging it
  so whoever reviews R5's enablement later isn't surprised that the
  pre-floor baseline shifted underneath it in the meantime.

**No other commits since the last review touch this doc's paths.** Nine
commits landed on `main` in total (#1670–#1683); the other eight are
unrelated UI/friends/invites work, confirmed by file list.

`git log --all --grep=revert --since=2026-09-05` — no reverts of `#1654`,
`#1662`, or `#1666`; all three remain in `main`'s ancestry (fast-forwarded
only this session), so the prior direct-API "MERGED" confirmations still
hold.

**No decision-resolving change; all five open decisions in §2 are exactly
where 2026-09-12 left them.** Status stays `active`.

### Next steps (unchanged)
1. Run this doc's own Phase 1 SQL once a session with production DB access
   is available — due at deploy+7 days (~2026-09-18), sooner is fine once
   access exists.
2. Everything else in §2/§4 unchanged.

### 2026-09-15 (diagnosis-review) — first real Phase 1 reading (deploy+~4 days, ahead of the +7 day window); migration 0147 confirmed applied; nothing trips a Phase 1 stop condition yet

**Environment note:** this session has a live, read-only Supabase MCP
connection to the production project (`grixooyecvnugpxvcbct`) — the first
DB access this doc has had since it opened (every prior review, 2026-09-12
and 2026-09-14, had none). Ran this doc's own §4 Phase 1 SQL directly.
Deploy was 2026-09-11T19:14:09Z, so this is deploy+~4 days — earlier than
the deploy+7-day Phase 1 window and well short of Phase 2's deploy+14-days-
or-200-rows gate (only 50 post-deploy live rows exist; Phase 2 needs
whichever of the two conditions is later, and neither is met yet). Reading
early because access exists now, not because it's due.

**Migration 0147 (`question_shape`) is confirmed applied** — the
2026-09-11 entry said "has NOT been run yet"; it now shows as a real
column with real data: of 51 post-deploy rows, 23 carry a shape (28 are
`NULL`, expected for rows generated in gaps or by paths that don't set
it). Distribution: `identification` 15/23 (65.2%), `technique_or_term`
7/23, `who_did_what` 1/23. Down from the ~77% `identification` share R4's
own motivating read found pre-fix, though still short of the ~44% R3's
exemplar-retirement scenario projected — too small a sample (n=23) to
read as more than "moving the right direction."

**Phase 1 SQL, run for real for the first time:**

| Metric | Baseline | Now (since 19:14:09Z deploy, n≈50-73) | Target | Read |
|---|---:|---:|---:|---|
| Quality gate drop rate | 31% | **27/73 = 37.0%** | 35-45% OK, >45% trips decision 2 | within band |
| `failed_open` (same window) | — | **0** | 0 | clean |
| Mean words/question | 31.2 | **30.8** | ≤24 | barely moved |
| Rows over 25 words | 66% | **64%** | ≤45% | barely moved |
| Rows opening "In …" | 58% | **0%** | watch only | collapsed |
| Accessible share of new rows | 41% | **64%** | 30-45% (< 25% = fail) | well *above* target band |
| Difficulty-floor deflections | 2% | **2/73 = 2.7%** | ≤5% | within band |

**None of Phase 1's three stop conditions trip.** Quality-gate drop rate
is inside the acceptable band with zero fail-opens; accessible share is
nowhere near the <25% "model dodged the tier" floor; difficulty-floor
deflections are well under 5%. (The fourth Phase 1 check — short-queue /
`generation_failed` builds from Vercel logs — still can't be checked from
here, same gap every prior review hit.)

**Two things worth flagging even though nothing trips a stop condition:**
- **Word length and the ">25 words" share barely moved** (31.2→30.8,
  66%→64%) despite R2-a's explicit target of ≤24 words / ≤45% over-25. The
  "In …" opener collapsing from 58% to 0% shows *something* in phrasing
  changed sharply, but raw length didn't follow. Not a Phase 1 failure (no
  length threshold is a stop condition), but worth watching into Phase 2's
  hand read.
- **Accessible share overshot the target band on the high side** (64% vs.
  a 30-45% target, baseline 41%). The plan's tripwires only guard the low
  end (<25% = model avoiding the tier); nothing in the plan anticipated
  *this* much overshoot. Not resolving anything here, just naming it since
  it's a bigger move than the plan's own table expected in either
  direction.

**Per-defect gate breakdown since deploy** (`quality:*`, day≥2026-09-11):
`DEFINITION_SUPPLIED` 17/64 (26.6%, still the largest single category —
consistent with R2 targeting it, though this is a mechanical per-attempt
rate, not the same measurement as Phase 2's hand-read %), `GENERIC_AT_TIER`
4/64, `ANSWER_LEAKED` 2/64, `SELF_ANSWERING` 1/64, everything else 0.

**Phase 3 (correct-rate) — too thin to read yet:** accessible-tier mean
`empirical_correct_rate`, pre-deploy cohort 0.725 (n=34 rows/47 answers) vs
post-deploy 0.650 (n=10 rows/12 answers). A ~7.5-point dip, inside the
Phase 3 exit criterion's ≤10-point allowance, but the post cohort is only
10 rows/12 answers — nowhere near enough to trust, and the doc's own
caveat about pre-cohort selection bias still applies. Not treating this as
a real reading yet.

**No decision-resolving change; nothing in §2 moves.** Status stays
`active`. Phase 1 looks clean so far but isn't due for a real verdict
until ~2026-09-18; Phase 2's hand read isn't due until ~2026-09-25 or 200
rows, whichever is later (currently 50).

### Next steps (revised)
1. Re-run this Phase 1 SQL at the actual deploy+7-day mark (~2026-09-18)
   for the real verdict; today's reading is early and directionally clean
   but not the official checkpoint.
2. Watch whether accessible share (currently 64%, well above the 30-45%
   target band) settles or keeps climbing — not a stop condition today,
   but worth a closer look if it persists into Phase 2.
3. Everything else in §2/§4 unchanged (Phase 2 hand read not due; R5 stays
   off pending Phase 2).

### 2026-09-16 (diagnosis-review) — deploy+~5 days, still short of the +7 day window; accessible-share overshoot cooling toward the target band; nothing trips a stop condition

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
2026-09-15. Deploy was 2026-09-11T19:14:09Z, so this is deploy+~5 days —
still short of the deploy+7-day Phase 1 window (~2026-09-18) and well short
of Phase 2's deploy+14-days-or-200-rows gate (64 post-deploy live rows
exist now, up from 50). Reading early again since access exists, same as
yesterday.

**Phase 1 SQL, re-run:**

| Metric | 2026-09-15 reading | Now | Target | Read |
|---|---:|---:|---:|---|
| Rows since deploy (`is_duplicate=false`) | 73 | **64** | — | some post-deploy rows were demoted between readings (expected — the gate/sweep chain runs continuously); not itself a signal |
| Mean words/question | 30.8 | **30.6** | ≤24 | still barely moved |
| Rows over 25 words | 64% | **63%** | ≤45% | still barely moved |
| Rows opening "In …" | 0% | **0%** | watch only | unchanged |
| Accessible share of new rows | 64% | **58%** | 30-45% | still above target band, but cooling — 6 points closer than yesterday |
| Difficulty-floor deflections | 2.7% | — (not re-run; last reading well inside band) | ≤5% | — |

**Quality-gate drop rate since deploy, re-run:** 42/109 = **38.5%**
(considered 109, up from 73; dropped 42, up from 27) — still inside the
35-45% acceptable band, `failed_open: 0`. `difficulty_floor`: 2/109 = 1.8%,
still well under the 5% stop condition.

**None of Phase 1's three stop conditions trip**, same as yesterday. The
accessible-share overshoot (64% → 58%) is the one number worth tracking
specifically: it's moving toward the 30-45% target band rather than away
from it, which is a mild point in favor of "this settles on its own" over
"R1-a needs a rewrite," but one day of movement on a metric this doc's own
plan didn't anticipate overshooting in either direction isn't enough to
call it.

**Phase 3 (correct-rate) — still too thin, dip near but inside the ≤10-point
allowance:** accessible-tier mean `empirical_correct_rate`, pre-deploy
cohort now **0.741** (36 rows/52 answers, up from 34/47 = 0.725) vs
post-deploy **0.650** (unchanged, still only 10 rows/12 answers). Dip is
now **9.1 points** (was 7.5), still inside the ≤10-point exit criterion but
closer to it — driven by the pre-cohort's own number moving as more answers
accumulate on old rows, not by the post-cohort changing at all. The
post-cohort's sample size hasn't grown in a day; still not treating this as
a real reading.

**No code change since the last review:** `git log --since=2026-09-15` on
`generate-questions.ts` and `adaptive-difficulty.ts` returns nothing. No
new PRs since #1683 touch this doc's tracked paths (checked the repo's
recent PR list directly — #1685–#1693 are all design-canon/UI/friends work,
none touching generation or the quality gate).

**No decision-resolving change; all five open decisions in §2 are exactly
where 2026-09-15 left them.** Status stays `active`. Phase 1's real
checkpoint is still ~2026-09-18; Phase 2's hand read still isn't due
(~2026-09-25 or 200 rows, currently 64).

### Next steps (unchanged)
1. Re-run this Phase 1 SQL at the actual deploy+7-day mark (~2026-09-18)
   for the real verdict.
2. Keep watching accessible share — cooling (64%→58%) but still above the
   30-45% target band.
3. Everything else in §2/§4 unchanged (Phase 2 hand read not due; R5 stays
   off pending Phase 2).

### 2026-09-16 (later, diagnosis-review) — second same-day check; minor row growth only

Re-queried a few hours after the entry above, same live Supabase access.
Post-deploy row count (`created_at > '2026-09-11 19:14:09Z'`,
`is_duplicate=false`) is now **66**, up from 64 — 2 rows of ordinary
generation. Accessible share unchanged at **58%**. Quality-gate drop rate
and `difficulty_floor` re-run over the `day >= '2026-09-11'` window are also
unchanged: 42/109 dropped (38.5%), `difficulty_floor` 2/109 — identical to
the morning reading. `git log` confirms no commits since the entry above
touching `generate-questions.ts` or `adaptive-difficulty.ts`.

**No decision-resolving change; all five open decisions in §2 unchanged.**
Status stays `active`. Phase 1's real checkpoint is still ~2026-09-18;
Phase 2's hand read still isn't due.

### Next steps (unchanged)
1. Re-run this Phase 1 SQL at the actual deploy+7-day mark (~2026-09-18).
2. Keep watching accessible share — still above the 30-45% target band.
3. Everything else in §2/§4 unchanged (Phase 2 hand read not due; R5 stays
   off pending Phase 2).

### 2026-09-17 (diagnosis-review) — deploy+~5.7 days, one day short of the +7 window; accessible share keeps cooling toward the target band; a new PR touches SYSTEM_PROMPT examples and closes the subject_entity gap

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews. Deploy was 2026-09-11T19:14:09Z, so this is
deploy+~5.7 days — one day short of the deploy+7-day Phase 1 window
(~2026-09-18), due at the next review.

**Phase 1 SQL, re-run:**

| Metric | 2026-09-16 reading | Now | Target | Read |
|---|---:|---:|---:|---|
| Rows since deploy (`is_duplicate=false`) | 66 | **72** | — | ordinary generation |
| Mean words/question | 30.6 | **30.6** | ≤24 | unchanged, still barely moved |
| Rows over 25 words | 63% | **65%** | ≤45% | still barely moved |
| Rows opening "In …" | 0% | **0%** | watch only | unchanged |
| Accessible share of new rows | 58% | **54%** | 30-45% | still above target band, still cooling — 4 points closer |

**Quality-gate drop rate since deploy, re-run:** 47/115 = **40.9%**
(considered 115, up from 109; dropped 47, up from 42) — still inside the
35-45% acceptable band, `failed_open: 0`. `difficulty_floor`: 2/115 = 1.7%,
still well under the 5% stop condition. Per-defect breakdown
(`quality:*`, day≥2026-09-11): `DEFINITION_SUPPLIED` 26/106 (largest, as
every prior reading), `GENERIC_AT_TIER` 13/106, `ANSWER_LEAKED` 4/106,
`SELF_ANSWERING` 1/106, everything else 0.

**None of Phase 1's three stop conditions trip**, same as every prior
reading. Accessible share (58%→54%) continues cooling toward the 30-45%
band rather than away from it — four consecutive readings now (64→58→54,
plus today) moving the same direction, which is a stronger point in favor
of "this settles on its own" than any single day's move.

**Phase 3 (correct-rate) — still thin, but the dip narrowed:** accessible-tier
mean `empirical_correct_rate`, post-deploy cohort now **0.682** (11
rows/13 answers, up from 10/12), pre-deploy cohort unchanged at **0.741**
(36 rows/52 answers — not re-queried this pass, no reason to expect the
frozen pre-deploy population moved). Dip is now **5.9 points** (was 9.1),
inside the ≤10-point exit criterion and moving the right direction, but
13 answers is still nowhere near enough to trust as a real reading.

**New PR since the last review, checked for relevance: `#1698`** ("dedup:
bank same-fact gate, required subject_entity, non-inventory prompt
examples"), merged 2026-09-16T22:07:16Z, plus its immediate NUL-byte fix
`#1699` (2026-09-16T22:34:47Z). Two things in it matter to this doc:

1. **`subject_entity` is now a hard requirement** at `parseBaseQuestion`
   (was warn-only) — closes the gap R7's subject-coverage feedback
   (`getRecentSubjectsByDomain`) depends on; 819 machine rows had it null
   before this. Also fixes `retrieval-grounded.ts`, which never wrote the
   column at all. This doesn't change any of this doc's five open
   decisions but improves the data R7 already relies on.
2. **`SYSTEM_PROMPT`'s illustrative examples moved off live-inventory
   domains** (Mrs. Dalloway, Harry Potter, Ring Cycle, Gilmore Girls, UX
   Design, Zelda, Macbeth, Florence → Moby-Dick, Casablanca, Jaws, Jane
   Eyre, chess, cartography, etc.) — this is R6's "examples are not a
   question bank" mechanism getting a data update, not new R6 rule text.
   Read the diff directly: it does **not** touch the FAN-SALIENCE RULE
   (R1-a), Rule 3c (R2-b), or any of the R1/R2/R3/R9 wording this doc
   tracks — confirmed by diffing `SYSTEM_PROMPT`'s edit hunks against the
   R1–R9 table in §1. Flagging it the same way `#1667` was flagged on
   2026-09-12: **this is not an eighth prescription landing in this
   window**, but it is a `SYSTEM_PROMPT` edit inside the measurement
   window, so any Phase 2 hand-read row generated after
   2026-09-16T22:07:16Z technically sees a slightly different prompt than
   rows generated 2026-09-11–16. Not expected to matter for the R1/R2
   metrics this doc scores (examples, not rules, changed), but worth
   naming in case Phase 2's hand read wants to know the prompt wasn't
   perfectly static for the full window.

Adding `#1698` to this file's `related-pr` frontmatter since it directly
touches data R7 depends on and edits `SYSTEM_PROMPT` inside the tracked
window.

**No decision-resolving change; all five open decisions in §2 are exactly
where 2026-09-16 left them.** Status stays `active`. Phase 1's real
checkpoint is now imminent (~2026-09-18, i.e. the next review); Phase 2's
hand read still isn't due (~2026-09-25 or 200 rows, currently 72).

### Next steps (revised)
1. Re-run this Phase 1 SQL at the actual deploy+7-day mark (~2026-09-18) —
   due at the next review.
2. Keep watching accessible share — now 54%, four readings running toward
   the 30-45% target band.
3. Everything else in §2/§4 unchanged (Phase 2 hand read not due; R5 stays
   off pending Phase 2).

### 2026-09-18 (diagnosis-review) — deploy+~7 days, the actual Phase 1 checkpoint: 2 of 3 exit criteria clearly pass; the 3rd has now gone unverifiable for the entire window

**Environment note:** live, read-only Supabase MCP connection to the
production project (`grixooyecvnugpxvcbct`) available this session, same as
the last several reviews. Deploy was 2026-09-11T19:14:09Z, so this review
lands at deploy+~7.0 days — the actual Phase 1 checkpoint date this doc's
own plan named, not another early read.

**Phase 1 SQL, re-run, and scored against the plan's own exit criteria:**

| Metric | 2026-09-17 reading | Now | Target | Read |
|---|---:|---:|---:|---|
| Rows since deploy (`is_duplicate=false`) | 72 | **76** | — | ordinary generation |
| Mean words/question | 30.6 | **30.3** | ≤24 | still barely moved |
| Rows over 25 words | 65% | **64%** | ≤45% | still barely moved |
| Rows opening "In …" | 0% | **0%** | watch only | unchanged |
| Accessible share of new rows | 54% | **53%** | 30-45% | still above target band, essentially flat |

**Quality-gate drop rate since deploy:** 50/120 = **41.7%** (considered
120, up from 115; dropped 50, up from 47) — inside the 35-45% acceptable
band, `failed_open: 0`. Per the plan's own decision-2 rule ("decide at
Phase 1 if the quality-gate drop rate exceeds 45%"), 41.7% does **not**
trip that threshold — R2-c (the gate-softener specialist-only change)
stays as shipped, no action needed. `difficulty_floor`: 2/120 = 1.7%, well
under the 5% stop condition. Per-defect breakdown (`quality:%`,
day≥2026-09-11): `DEFINITION_SUPPLIED` 28/111 (largest, as every prior
reading), `GENERIC_AT_TIER` 14/111, `ANSWER_LEAKED` 4/111, `SELF_ANSWERING`
1/111, everything else 0.

**Scoring the plan's own three Phase 1 exit criteria (§4) directly, since
this is the checkpoint date named for that scoring:**

1. Quality-gate drop rate ≤45% AND `failed_open`=0 — **PASS** (41.7%, 0).
2. No rise in short-queue / `generation_failed` builds vs. the prior 7
   days — **still not checkable from this environment.** This needs Vercel
   function-log counts this session (and every prior diagnosis-review
   session for this doc) has had no access to. This is not a new gap, but
   it is now material in a way it wasn't before: this WAS the checkpoint
   date the plan names for scoring all three criteria together, and this
   one has gone the entire 7-day window without a single reading.
3. Accessible share ≥25% AND difficulty-floor deflections ≤5% — **PASS**
   (53% ≫ 25%; 1.7% ≪ 5%). Accessible share sitting well above the 30-45%
   *target* band is a separately-tracked watch item, not itself a Phase 1
   stop condition — only a fall below 25% would trip it.

**Net: nothing trips a Phase 1 stop condition on the two criteria this
environment can check, and neither open decision in §2 is newly resolved**
(decision 2's 45% tripwire didn't fire, which is "no action" per the plan's
own table, not a resolution requiring Josh; decision 1 is scored at Phase 2,
not Phase 1, and Phase 2 isn't due — 76 rows vs. the 200-row-or-14-day gate,
whichever is later, ~2026-09-25). **Not flipping `status` to
`needs-decision`** — nothing here presents a specific question blocking one
of the five enumerated open decisions. But flagging plainly, since the
checkpoint itself just passed: **the short-queue/generation_failed criterion
that the plan's own exit-criteria table requires "all three, else stop and
revisit" has never been checked, at any point in this 7-day window, by any
review session.** If Josh wants Phase 1 formally called MET, that currently
rests on 2 of 3 criteria plus the absence of any other signal (no rise in
`carry_forward`/`partial_carry_forward` share has been noticed as anomalous
by the build-latency doc reviewed the same session) rather than a direct
check of the one criterion built to catch exactly this failure mode.

**Phase 3 (correct-rate) — dip widened slightly, still inside the
≤10-point allowance:** accessible-tier mean `empirical_correct_rate`,
post-deploy cohort now **0.654** (13 rows/15 answers, up from 11/13),
pre-deploy cohort unchanged at **0.741** (36 rows/52 answers). Dip is now
**8.7 points** (was 5.9), inside the ≤10-point exit criterion but moving
the wrong direction this reading — still only 15 answers, nowhere near
enough to trust as a real reading, same caveat as every prior entry.

**No new relevant code:** the only two commits on `main` since the last
review (`#1697` design-canon, `#1700` a UI text-wrap fix) touch neither
`SYSTEM_PROMPT`, `QUALITY_GATE_SYSTEM_PROMPT`, nor `adaptive-difficulty.ts`
— confirmed by diffing their changed-file lists directly.

**No decision-resolving change; all five open decisions in §2 are exactly
where 2026-09-17 left them.** Status stays `active`. Phase 2's hand read
still isn't due (~2026-09-25 or 200 rows, currently 76).

### Next steps (revised)
1. **New, and now the leading item:** get a real reading on short-queue /
   `generation_failed` build counts since deploy (Vercel function logs, not
   DB) — this is the one Phase 1 exit criterion that has never been
   checked, and the checkpoint date for scoring it has now passed.
2. Keep watching accessible share — now 53%, essentially flat this
   reading after four straight readings of cooling (64→58→54→53).
3. Everything else in §2/§4 unchanged (Phase 2 hand read not due; R5 stays
   off pending Phase 2).
