# Cassian bank supply and reuse measurement

Updated 2026-10-11 after crossing the twenty-build threshold. Run `npx tsx scripts/cassian-bank-audit.ts` with the project's database environment for a read-only aggregate refresh. The script prints no player IDs, declared topic names, or question text. Detailed private data and query limitations remain in ignored `_scratch/Cassian/`; this repository is public.

## Twenty-build follow-up

The October 11 read-only refresh found **21 actual built queues across five users** after the confirmed October 3 deployment cutoff. The earlier same-day seventeen-build count is superseded. The threshold is met, but this descriptive sample does not show fewer generation calls or shorter waits.

| Measure | Seven days before deployment | After deployment through audit |
| --- | ---: | ---: |
| Completed builds | 27 | 21 |
| Distinct users | 5 | 5 |
| Final slots | 160 | 125 |
| Bank-hit attempts | 104 | 110 |
| Bank-miss attempts | 154 | 100 |
| Fresh generation calls | 97 | 79 |
| Generation calls per built queue | 3.59 | 3.76 |
| Builds with no generation calls | 1 | 1 |
| Loosened bank-hit attempts | 0 | 2 |
| Median user-visible ready time | 35.3 s | 37.1 s |
| 95th-percentile ready time | 73.9 s | 74.8 s |

These are unequal, unmatched windows with a small user population and changing stock/history. Ready time describes an existing daily queue build, not cold topic-selection-to-first-ready latency. Bank hits are lookup attempts, **not final bank placements**: a hit is recorded before the serving clone is inserted and before final queue selection. The attempt record has no source or serving-row ID, and the clone has no explicit bank-source lineage. The 110 hits cannot be divided by 125 final slots to claim a reuse rate, nor can the two loosened hits be verified as two final placements from this telemetry.

Post-deployment miss reasons were 46 answered-fact history, 25 filtered, 18 no stock and 11 tier. The history also includes the miss-diagnosis repair in #1743, so historical shifts between labels cannot by themselves establish a difficulty-policy effect. Keep the no-repeat rule; these counts support investigating depleted and filtered stock rather than loosening it further.

Current basic stock eligibility is still uneven: **18 of 156 player/domain pairs have none; 23 have only one or two**. These are declared-interest approximations that omit selected-mode preferences, open-report suppression, same-build avoidance, domain floors and the full tier ladder. Exact fact-key/text grouping now finds **374 groups used by more than one user**, with 510 additional distinct-user placements beyond each group's first. This is a conservative historical reuse proxy, not a count of bank-served slots in the measured builds. It does not recover explicit source-to-clone lineage.

Next obtain final-placement lineage and fixed-workload stage costs, then assess savings using a matched sample. Provider invoices and the full cold-topic path remain unmeasured. No production difficulty, writer, gate or cache setting changed. This audit ran entirely read-only with zero model calls; the script's `ledger` field is pilot-only and must not replace the [current lifetime budget](TRACKER.md).

Private snapshot: `_scratch/Cassian/cassian-component-2026-10-11/private/BANK-AUDIT.json`; threshold count was captured at 2026-10-11 22:09:35 UTC. Source limitations were checked against `BankAttempt`, `DailyBuildMetric` and the bank clone write path.

## Initial October 4 snapshot

The loosened bank difficulty rule in PR #1744 reached production at **2026-10-03 17:28:30 UTC**. The first snapshot has only **two** completed builds afterward, so it cannot establish whether the rule saves calls or improves ready time. Neither build recorded a loosened pick. The seven days before deployment had 27 actual built queues, 104 bank-pick hits and 97 fresh generation calls. Hits are attempts, not final queue placements. Always filter `DailyBuildMetric` to `outcome='built'` and compare from the deployment timestamp rather than the merge time.

Current declared-interest supply is uneven: of 143 distinct player/domain pairs, 22 have no row eligible under basic ownership, answered-fact, duplicate and dud filters; another 19 have only one or two. Exact fact-key-and-text grouping also shows genuine cross-player reuse potential: 340 question groups have been placed for more than one user, representing 458 additional-user placements beyond the first. This is a conservative proxy, because the database does not record explicit source-to-clone lineage and rewordings do not group together. It still shows why sharing verified bank questions can amortize writing costs. Adding stock that only one player ever sees merely moves generation earlier.

For the owner's monthly cost goal, track source retrieval, writing, checks, grading and background restock together at a fixed player workload. The bank can avoid most of a fresh question's cost, but it must keep enough **unseen, on-tier** facts for each player's topics. Preserve the uncapped no-repeat rule. The six source-verified Cassian questions promoted after the pilot are useful stock in their own topics but too few to infer a service-wide saving.

The initial next measurement was a refresh after at least **20 post-deployment built queues**. That refresh is complete above. A clean final-placement metric still needs explicit source lineage on bank clones or queue slots. Keep topic and player detail private.

The proposed answer-only creation test was subsequently completed in [ANSWER-ONLY-CREATION.md](ANSWER-ONLY-CREATION.md); it did not improve usable yield. Reference reuse remains a candidate after topic-level cache-hit telemetry exists; the cache retains only its latest passage per topic, so old repeat-fetch frequency cannot be reconstructed. No production writer, gate, reference TTL or difficulty setting changes follow from these snapshots. The admin review form asks separately about a question's disposition and whether the machine's pass/hold decision was correct, with a correction note attached to that question.
