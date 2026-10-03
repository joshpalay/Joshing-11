# Critique of the supplied synopsis

Reviewed 2026-10-03. Overall judgment: its smaller first experiment is a better engineering starting point than the original QEXP-01 architecture. Several conclusions and the ready-to-paste prompt need correction before use. The quoted prompt is material to critique, not a replacement user instruction to execute unchanged.

## 1. Where the critique is right

The original plan specified too much infrastructure before demonstrating that a cheaper writer can maintain quality: logical run/job/call/assignment/dataset records, resumable workers, multiple review modes and potential training. Although the plan allowed combining records rather than mandating nine physical tables, that distinction does not fix the practical overdesign. A $10 pilot should start with a manifest, bounded script, saved candidate snapshots, ratings and a report.

An isolated current-writer versus cheaper-writer comparison, holding prompts/evidence/gates constant, answers a useful question quickly. Existing provider clients, parsers, gate logic and pricing/usage instrumentation should be reused. No global model or difficulty switch should change during the comparison.

Fresh generation volume, bank coverage and accepted-question yield matter more than raw token price alone. Report unit economics alongside aggregate spend. Defer fine-tuning until there is evidence that prompting/model selection is insufficient, a suitable reviewed corpus exists and economics justify training.

## 2. Verified PR status — the synopsis is already stale here

Read through GitHub CLI, not inferred from the local checkout:

| PR | Verified status | Evidence |
| --- | --- | --- |
| [#1743](https://github.com/joshpalay/Joshing-11/pull/1743) | Merged, 2026-10-03 15:57:01 UTC | Actual changed files include miss classification and telemetry. Its title/body mention both halves, but #1744 explicitly explains that only the first commit merged here. |
| [#1744](https://github.com/joshpalay/Joshing-11/pull/1744) | Merged, 2026-10-03 17:27:20 UTC | Difficulty loosening plus the diagnosis document and tests. It is no longer open. |

Merged is not proof of deployed. Record deployed SHA, runtime flags and measurement window before evaluating effects. The current local checkout was at `d44a2f96` during inspection and did not contain `diagnosis/bank-difficulty-loosening.md`; it also had unrelated uncommitted work. Do not run the proposed prompt by switching this dirty checkout to a different branch and assume it matches latest main.

The PR #1743 description reports a rise in 30-day spend and bank-miss counts of 119 tier / 63 fact-history / 31 no-stock, totaling 213. These are supporting reports, not independently reproduced billing queries in this critique. Rounded percentages total 101%; that is harmless rounding, not a count discrepancy.

## 3. Cost claims need explicit provenance and consistent windows

The earlier owner estimate was not an audited baseline. The later 30-day measurement should replace it after its ledger window is verified. The monthly run-rate projection is not a second observed bill.

The reported cleanup and QA amounts, verification drop, weekly generation growth and stage timings were not independently verified here. Keep them as reported findings until accompanied by query, dates, scope definitions and provider-billing reconciliation. A ledger that prices history using today's map can differ from actual billed spend; unpriced and failed calls must be visible.

The earlier prompt's explanation of the one-time cleanup is ambiguous: which period contained it, and how does it explain the rise? Supply an additive period-to-period bridge with nonoverlapping buckets. Do not subtract QA and cleanup twice if they overlap.

“3.2 fresh questions” also needs care: the PR describes approximately 3.2 generation calls per built build. Calls, generated candidates, accepted questions and served slots are different denominators. Similarly, don't hardcode six questions per game without checking actual core/bonus/partial-build counts.

## 4. Keep both the owner's $5/month target and unit economics

Cost per completed game or active player-day helps explain growth, but it must not replace the owner's explicitly requested $5/month target. “Under five cents a game” is an illustrative target from the other session, not an owner decision. At 100 games/month, five cents already consumes the entire $5 before other costs; at 1,000 games it is $50.

Use:

`projected monthly cost = fixed/unaffected recurring cost + games per month × marginal cost per game + other recurring activity`

Report the actual current month, normalized projections at a fixed workload, and scaling scenarios separately. Show normal production, one-off maintenance, QA and Cassian experiment spend as distinct buckets.

If fresh writing is roughly half of current spend, making writing free still leaves recurring costs above the $5 target. A cheaper writer alone cannot reach it. Measure the unaffected-cost floor and other expensive stages before promising savings.

## 5. Fine-tuning: defer, don't make an industry-wide claim

It is reasonable to leave training out of the first $10 pilot. It is too broad to say fine-tuning is generally unavailable or necessarily impossible for every provider at that budget. OpenAI's particular self-serve service has documented restrictions and retirement dates; this does not establish all-provider availability. Dataset preparation, evaluation and serving economics also matter more than the training API fee alone. [Official OpenAI availability notice](https://developers.openai.com/api/docs/deprecations).

Cassian will not train in its first implementation slice. Preserve the reviewed data so training remains a future option supported by evidence.

## 6. Changes to the prompt that would lose owner requirements

- “Good / Fix / Reject / Unsure plus note” is a useful quick layer, but the owner asked for all rating dimensions. Keep expandable accuracy, clarity, interest, difficulty, topic fit, appropriateness, repetition, grading, speed and corrections.
- A separate admin page is a useful first milestone, not a replacement for the requested below-bonus panel. Build that thin panel after runner/feedback foundations work, even if the experiment needs more evidence; do not make its existence conditional on declaring a cheaper model successful.
- Remove heavyweight assignment infrastructure, not basic review safeguards. A stable shuffle and hiding the model name until the first rating are inexpensive ways to reduce bias. Do not cherry-pick examples or show only gate-passed rows and then claim the gates work.
- Use the 54 active examples provisionally if the source document cannot be found quickly, but label their mixed provenance. Do not call them the recovered 80 personally authored questions. The two archive lists differ despite a claim to preserve the same 34.
- Do not interpret the quoted $4 limit as replacing the owner's $10 total cap. $4 is a sensible recommended subcap for the first comparison, leaving up to $6 for follow-up and answer grading. It is not fresh authorization to exceed $10.

## 7. No-repeat rules: preserve the rule, avoid a blanket ban on integration

The concern about editing busy production files is valid. Use an isolated current-main worktree and keep the first offline run out of the bank and gameplay. However, “no changes to no-repeat rules” and “no history integration whatsoever” are different requirements.

Once an admin sees an experimental question, normal generation could independently recreate that fact later. Keeping candidates out of the bank does not prevent that. The strict no-repeat requirement therefore needs either an existing exposure-aware exclusion mechanism or a small, separately tested integration before live play. The prior plan's intent was to preserve the rule, not loosen it, but it spread the work too widely too early.

Do not rewrite dedup or relax thresholds. Audit existing history first, use the least invasive existing mechanism, and isolate any necessary exposure hook in its own change. If existing code cannot guarantee cross-direction exposure exclusion, document the gap and finish offline work while the hook is completed; never promise that “no production edits” automatically guarantees no repeats.

## 8. Speed and bank-rule confounding

The topic-to-first-ready clock must include topic processing, scheduling, retrieval, generation, gates and dedup. A writing-only model comparison isolates one component; it does not prove the full new-topic path became faster. Run a separate cold/depleted-topic timing probe, and report warm-cache selection separately.

Starting research at topic-add time is a plausible hypothesis, not a proven next fix. Inspect current prewarm, replenishment and reference caching; speculative fetches can waste money if the topic is removed or never played. Measure duplicate-work prevention, completion rate, time saved and wasted spend before expanding it.

#1744 changes the supply policy, so monthly before/after savings can mix model effects with bank-hit changes. Freeze the same rule for both model arms, record deployed state and stratify or restart windows at deployment. Do not implement or retune difficulty loosening in Cassian.

## Conclusion

Adopt the lean first comparison and milestone discipline. Correct PR status, cost provenance and denominators; retain the $5 aggregate goal, $10 total cap, all feedback fields, below-bonus destination and strict no-repeat requirement. Defer training and broad infrastructure. The new [plan](PLAN.md) and [handoff prompt](HANDOFF-PROMPT.md) implement that narrower scope.
