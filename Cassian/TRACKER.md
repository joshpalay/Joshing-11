# Cassian tracker

Updated 2026-10-03. Work branch `codex/cassian-current`, draft PR [#1745](https://github.com/joshpalay/Joshing-11/pull/1745). Code worktree: `_scratch/cassian-worktree` under the repository root. The original checkout has unrelated edits and was not reset.

## Owner decisions

- Desired ongoing game LLM cost: $5/month, aspirational. Report cost per accepted question and per player-day at a fixed workload.
- Authorized incremental experiment cap: $10 total across runs, retrieval, gates, grading and failures. First run aimed below $4.
- Admin-only Cassian card after all regular and bonus Daily Five questions; visually designated as an experiment.
- Answer normally, then rate Good/Fix/Reject/Unsure and all optional dimensions, corrections and panel feedback.
- No mastery, points, streak, normal bank, feed, notification or activity writes. No repeat of previously shown questions/facts.
- Topic coverage and topic-selection-to-first-ready latency matter. Do not alter global model switches or the merged bank difficulty change (#1744).

## Durable budget and data

| Item | Current value |
| --- | ---: |
| Authorized lifetime | $10.000000 |
| Pilot provider-response cost in CassianRun | $1.900008 |
| Reserved/uncertain | $0 |
| Remaining before admin grading or follow-up | $8.099992 |
| Source retrieval within pilot | $1.319228 |
| Both writer arms within pilot | $0.256178 |
| Quality + factual gates within pilot | $0.324607 |

The connected database has migrations 0151–0153 applied. `CassianCandidate` holds 24 immutable snapshots; at the last read-only smoke check `CassianReview` held zero exposures/reviews. The first run made 84 calls with no unresolved reservation. The ledger, not this file, controls new spending. Response-level totals differ by about $0.000005 from six-decimal settlement rounding. No question was added to shared stock or shown to a player during the offline run.

The executed manifest is ignored at `_scratch/Cassian/cassian-pilot-2026-10-03/private/manifest.json`, SHA-256 `1d8312dcf9728de46a2a7af6206076ee9afc415bc4bd2234836ef5b1dcf91536`. The committed `Cassian/manifest.json` is a generic public estimator example. Set `CASSIAN_MANIFEST_FILE` to the private path for run-specific estimates, import or recovery. Raw responses/checkpoint remain ignored under `_scratch/Cassian/cassian-pilot-2026-10-03/`.

## Milestones

| ID | State | Evidence / finish line |
| --- | --- | --- |
| C0 Baseline | Partial | Recent model/gate IDs, tokens and internal spend reproduced. Provider invoice and deployed SHA not reconciled. Exact production amounts are kept privately because the repository is public. |
| C1 Offline runner | Operational; failure tests incomplete | Dry-run, 3-topic run, 12-topic resume and DB budget settlement worked. Test recovery and overlapping runners before future paid work. |
| C2 Admin ratings | Implemented locally; deployed QA pending | 24 candidates imported; admin endpoints and page include answer/reveal, blind first rating, post-rating gate audit, corrections and panel note. Verify actual admin/non-admin sessions and save/reload. |
| C3 First comparison | Machine screen complete; owner review pending | [Results](runs/cassian-pilot-2026-10-03/RESULTS.md): 12 questions per arm, 6 Sonnet and 4 Haiku core-gate passes, zero human ratings. No winner yet. |
| C4 Below-bonus panel | Implemented locally; deployed QA pending | Shared review component appears only after completed Daily Five and admin visibility probe. Check no-bonus, partial queue, mobile, recap and novelty in preview. |
| C5 Follow-up | Pending | Collect owner ratings, then choose a bounded retrieval/cache and cold topic-to-ready test. Retrieval is the larger measured lever. |
| C6 Final report | Pending | Human quality, cost per accepted unique question, topic coverage, latency, fixed-workload monthly feasibility and budget left. |

## Current caveats

- `#1743` and `#1744` were merged when checked; deployment and runtime flags remain unverified.
- A private rolling production estimate found non-writer spend alone above the $5 monthly target after one-time rewrite work was removed. A writer swap cannot achieve the target at the current workload. The 12-topic pilot reinforces this: retrieval consumed most of pilot spend.
- The approximately 80-question owner-written document remains unfound. Fifty-four active examples are provisional style references; the original report snapshots remain private. No training has been attempted.
- The implemented core screen does not replay every production history/embedding/ask-to-answer check. The panel performs exact/fact-key checks against production and prior Cassian exposures and feeds Cassian exposures into later normal generation/bank exclusions. Semantic same-fact paraphrases remain a QA risk; do not claim absolute novelty until tested.
- Initial ratings hide model and gate identity; gate verdict is shown only after first save. Review revisions are stored in `CassianReview.rating_history`.
- An automated review rejected recursively removing the superseded `docs/experiments/question-quality-v1` directory. It remains in this worktree with Cassian designated as the current plan.
- The public branch previously contained narrow topic names and production spend figures. Working files are now genericized; prior public commit objects may remain accessible after history/ref cleanup. Do not commit the private manifest or raw responses.

## Session log

- 2026-10-03: Created Cassian plan and clean current-main worktree. Opened draft PR #1745. Captured production baseline and froze 12-topic manifest.
- 2026-10-03: Added 0151 budget ledger, checkpointed paired runner and executed 3-topic then 12-topic pilot at $1.900008. Ran TypeScript and focused budget tests.
- 2026-10-03: Added 0152 candidate/review storage and imported 24 snapshots idempotently. Added 0153 panel notes. Implemented admin page/endpoints, below-bonus Daily Five placement and scoped cross-direction fact exclusion. Read-only schema smoke passed with zero reviews; deployed auth/UX QA pending.
- 2026-10-03: Reviewer identified retrieval as the larger cost lever, gate-model coupling, fixed-size estimator and public data exposure. Pinned gate/source models independent of arms, enabled 3/6/9/12-topic estimates, moved the exact manifest to ignored storage, and generalized public documentation. Public branch history cleanup is pending.

## Next exact actions

1. Finish focused novelty, auth, answer/revision, and budget-failure tests; run build/lint. Fix any failures.
2. Update the draft PR with the implementation and measured results; push sanitized work and verify no sensitive topics remain in the branch diff/history. Reconcile the previous public planning branch.
3. Deploy admin-only through the established process; verify non-admin 404 and actual admin save/reload. No card has yet been shown to a player.
4. Have the owner rate eligible cards. Analyze quality by topic breadth and gate false rejection before choosing a writer or paying for a retrieval follow-up.

At each handoff record branch/commit, deployment SHA, candidate/exposure/review counts, budget spent/reserved, exact model/gate IDs, tests, human feedback and remaining risks. Implementation is not the final experiment result.