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
| C2 Admin ratings | Implemented locally; deployed QA blocked | 24 candidates imported; admin endpoints and page include answer/reveal, blind first rating, post-rating gate audit, corrections and panel note. Signed-in Chrome blocked the protected preview before app load (`ERR_BLOCKED_BY_CLIENT`); verify actual admin session and save/reload from a browser that can normally open the preview. |
| C3 First comparison | Machine screen complete; owner review pending | [Results](runs/cassian-pilot-2026-10-03/RESULTS.md): 12 questions per arm, 6 Sonnet and 4 Haiku core-gate passes, zero human ratings. No winner yet. |
| C4 Below-bonus panel | Preview built; admin QA blocked | Shared review component waits for server-confirmed completed Daily Five and admin visibility probe. Local anonymous page and all API routes return 404; Vercel preview itself is access-protected and signed-in Chrome blocked the page before app load. Check signed-in admin, no-bonus, partial queue, mobile, recap and novelty. |
| C5 Follow-up | Read-only cache audit done; paid test pending | [Retrieval follow-up](RETRIEVAL-FOLLOWUP.md): 25 calls/30d, p50 ~11.7s, only 18/111 active topics cached at snapshot. Collect owner ratings and repeat-fetch evidence before TTL or paid test. |
| C6 Final report | Pending | Human quality, cost per accepted unique question, topic coverage, latency, fixed-workload monthly feasibility and budget left. |

## Current caveats

- `#1743` and `#1744` were merged when checked; deployment and runtime flags remain unverified.
- Cassian migrations 0151–0153 are applied to the connected live database while PR #1745 is still draft. Drizzle compares journal `when` to the latest applied `created_at`, so a migration based only on main's 0150 can be silently skipped. [Reserve 0154 and a later `when` for the next migration](MIGRATION-ORDER.md) until this PR merges; no conflicting migration existed on main when checked 2026-10-03.
- A private rolling production estimate found non-writer spend alone above the $5 monthly target after one-time rewrite work was removed. A writer swap cannot achieve the target at the current workload. The 12-topic pilot reinforces this: retrieval consumed most of pilot spend.
- The approximately 80-question owner-written document remains unfound. Fifty-four active examples are provisional style references. The private flagged-question export contains 22 incorrect reports (4 upheld, 9 admin-edited, 9 open) and zero inappropriate reports. Twenty-one have a prior Daily Five text snapshot; nine snapshots differ from current text. Snapshot text is evidence of what was shown on or before the report date, not a guaranteed report-time version. Open reports are unverified, and edited/current text must not be labeled as the original bad version. No training has been attempted.
- The implemented core screen does not replay every production history/embedding/ask-to-answer check. The panel performs exact/fact-key checks against Daily Five queue snapshots, generated rows, answered/feed/authored rows and prior Cassian exposures; same-domain distinctive-answer checks catch some paraphrases. Cassian exposures feed into later normal generation/bank exclusions. Semantic same-fact paraphrases remain a QA risk; do not claim absolute novelty until tested.
- Initial ratings hide model and gate identity; gate verdict is shown only after first save. Review revisions are stored in `CassianReview.rating_history`.
- An automated review rejected recursively deleting the superseded `docs/experiments/question-quality-v1` directory. The safer alternative removed it from the PR index while leaving the local files intact. Cassian is the sole plan in the sanitized PR.
- The public branch previously contained narrow topic names and production spend figures. Working files are now genericized; prior public commit objects may remain accessible after history/ref cleanup. Do not commit the private manifest or raw responses.

## Session log

- 2026-10-03: Created Cassian plan and clean current-main worktree. Opened draft PR #1745. Captured production baseline and froze 12-topic manifest.
- 2026-10-03: Added 0151 budget ledger, checkpointed paired runner and executed 3-topic then 12-topic pilot at $1.900008. Ran TypeScript and focused budget tests.
- 2026-10-03: Added 0152 candidate/review storage and imported 24 snapshots idempotently. Added 0153 panel notes. Implemented admin page/endpoints, below-bonus Daily Five placement and scoped cross-direction fact exclusion. Read-only schema smoke passed with zero reviews; deployed auth/UX QA pending.
- 2026-10-03: Reviewer identified retrieval as the larger cost lever, gate-model coupling, fixed-size estimator and public data exposure. Pinned gate/source models independent of arms, enabled 3/6/9/12-topic estimates, moved the exact manifest to ignored storage, and generalized public documentation. Both remote Cassian branch references now point to one sanitized commit; PR #1745 has a generic description. Prior public commit objects may still be accessible by SHA.
- 2026-10-03: Production build and affected-code lint passed. Local anonymous GET/POST checks found the existing middleware returned redirects/401 before Cassian guards, so Cassian paths now return 404 at that boundary; a rebuilt local server confirmed all six anonymous paths return 404. The protected Vercel preview is green, but signed-in admin UX remains untested there. A read-only retrieval audit found 25 calls in 30 days (p50 11,731 ms) and 18 cached rows among 111 active topics; repeat-fetch frequency cannot be recovered from existing tables.
- 2026-10-03: Read-only `scripts/cassian-report-audit.ts` confirmed 22 incorrect and zero inappropriate reports. `scripts/cassian-export-reports.ts` wrote a private, ignored 22-case dataset to `_scratch/Cassian/reported-questions-private.json` (SHA-256 `ba3c56a975d79933671471c7923dfe3e8b57f99dc667e35b73309802931e6f4f`). Four are upheld, eight admin-edited with a prior queue snapshot, and ten unresolved or lacking a recoverable prior snapshot. These are development/regression examples, never an unseen holdout or training set.
- 2026-10-03: Expanded the allocation-time novelty check to include all prior Daily Five slot snapshots, including assigned but unanswered slots, plus same-domain answer checks. Focused tests, TypeScript and lint passed; a read-only query against the connected schema executed successfully. This lowers repeat risk but does not prove semantic uniqueness.
- 2026-10-03: Verified the installed Drizzle runner's timestamp-only migration selection and main's 0150 head. Documented the live 0151–0153 reservation. Tightened the Daily Five panel to wait for the existing server queue revalidation to confirm no pending slots before showing Cassian; corrected two import indents.
- 2026-10-03: User confirmed an admin session is signed in on this computer. Browser QA attempted in Chrome; the protected preview returned Chrome's `ERR_BLOCKED_BY_CLIENT` before rendering the app. No card was answered or rated. A read-only connected-schema check still showed 24 candidates and zero reviews. The latest PR head built and had green CI/Vercel checks, but this does not substitute for signed-in admin UX QA.
- 2026-10-03: The branch-style preview alias previously shared with the owner returned 404. GitHub's deployment status for head `8b59398f` instead reports the immutable deployment URL `https://joshing-11-debxi3rzo-joshuapalay-5402s-projects.vercel.app`. The owner can see the preview but cannot complete phone login without a production-delivered SMS code. The production and preview session cookies are host-scoped; whether the preview OTP request fails or merely lacks delivery is awaiting owner clarification. Do not request or record an OTP value.

## Next exact actions

1. Commit/push the private-report audit/export scripts and tracker correction, then recheck CI. Do not re-add the untracked superseded docs or private JSON.
2. Finish signed-in admin save/reload, no-bonus/partial-queue and semantic novelty QA in a preview session. No card had been shown to a player at the last database check.
3. Deploy admin-only through the established process when those checks pass; verify non-admin 404 and no ordinary-game writes.
4. Have the owner rate eligible cards. Use the private reported cases as development/regression examples, with status and original/current version distinctions. Analyze quality by topic breadth and gate false rejection before choosing a writer or paying for a retrieval follow-up.

At each handoff record branch/commit, deployment SHA, candidate/exposure/review counts, budget spent/reserved, exact model/gate IDs, tests, human feedback and remaining risks. Implementation is not the final experiment result.
