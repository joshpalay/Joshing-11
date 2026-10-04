# Cassian tracker

Updated 2026-10-04. Current follow-up branch `codex/cassian-owner-review`; the original Cassian implementation merged as [#1745](https://github.com/joshpalay/Joshing-11/pull/1745), the malformed-key fix as [#1746](https://github.com/joshpalay/Joshing-11/pull/1746), the explanation replay as [#1747](https://github.com/joshpalay/Joshing-11/pull/1747), and the future-pricing note as [#1748](https://github.com/joshpalay/Joshing-11/pull/1748). Code worktree: `_scratch/cassian-worktree` under the repository root. The original checkout has unrelated edits and was not reset.

## Owner decisions

- Desired ongoing game LLM cost: $5/month, aspirational. Report cost per accepted question and per player-day at a fixed workload.
- Future pricing idea only: approximately 200 normal answered questions free, then a monthly subscription. No price or paywall decision yet. See [FUTURE-PRICING.md](FUTURE-PRICING.md); Cassian cards never count toward the proposed allowance.
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
| Explanation-free factual-gate replay | $0.151923 |
| Answer grading in connected ledger | $0.005977 |
| Current connected ledger spent | $2.059577 |
| Current connected ledger reserved/uncertain | $0 |
| Remaining authorized lifetime | $7.940423 |

The connected database has migrations 0151–0153 applied. `CassianCandidate` holds 24 immutable snapshots; the owner answered all 23 available cards and saved 22 overall ratings. The malformed Placeholder card was answered before its allocation fix and remains unrated; one pilot candidate was never shown. The first run made 84 calls with no unresolved reservation. The ledger, not this file, controls new spending. Response-level totals differ by about $0.000005 from six-decimal settlement rounding. No candidate was added to shared stock; owner review occurred only in the admin experiment.

The executed manifest is ignored at `_scratch/Cassian/cassian-pilot-2026-10-03/private/manifest.json`, SHA-256 `1d8312dcf9728de46a2a7af6206076ee9afc415bc4bd2234836ef5b1dcf91536`. The committed `Cassian/manifest.json` is a generic public estimator example. Set `CASSIAN_MANIFEST_FILE` to the private path for run-specific estimates, import or recovery. Raw responses/checkpoint remain ignored under `_scratch/Cassian/cassian-pilot-2026-10-03/`.

## Milestones

| ID | State | Evidence / finish line |
| --- | --- | --- |
| C0 Baseline | Partial | Recent model/gate IDs, tokens and internal spend reproduced. Provider invoice and deployed SHA not reconciled. Exact production amounts are kept privately because the repository is public. |
| C1 Offline runner | Operational; failure tests incomplete | Dry-run, 3-topic run, 12-topic resume and DB budget settlement worked. Test recovery and overlapping runners before future paid work. |
| C2 Admin ratings | Owner review completed | 23 available cards answered, 22 overall ratings saved. The sole unrated card was the malformed Placeholder item; no further rating is needed. The post-rating gate control caused confusion about disposition versus gate correctness. |
| C3 First comparison | Owner and source review complete | [Owner review](runs/cassian-pilot-2026-10-03/OWNER-REVIEW.md): 20/22 rated Good for appeal, but source-audited keeps are 8/12 Sonnet and 5/12 Haiku. Small sample; no production writer switch. |
| C4 Below-bonus panel | Admin played in production | The owner answered the available cards in the admin experiment. The earlier protected-preview and production-login issues are historical. No ordinary-player rollout is planned. |
| C5 Follow-up | Gate replay complete; bank analysis next | [Explanation yield](EXPLANATION-YIELD.md): one genuine explanation-only recovery. [Retrieval follow-up](RETRIEVAL-FOLLOWUP.md) remains a candidate, but first measure bank supply/reuse after the difficulty-rule deploy. No new paid arm selected. |
| C5a Explanation yield | Gate-only replay complete; creation trial pending | [Explanation yield](EXPLANATION-YIELD.md): 24 saved questions replayed without explanations at the factual gate. Three more machine passes, but source audit confirms only one genuine explanation-only recovery; one false original hold and one unsafe new pass. No replacement generation measured yet. |
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
- 2026-10-04: Added an explanation-free factual-gate replay over the 24 immutable pilot snapshots. The first API request returned provider 400 before inference because Sonnet 5.5 deprecated `temperature`; the exact $0.03 reservation was reconciled at $0, and the corrected runner used the existing model-parameter sanitizer and a new ledger key. All 24 calls completed for $0.151923 with no unresolved reservation. Source-audited the three newly machine-eligible items: one genuine explanation-only recovery, one false original hold, one unsafe new pass. Added [EXPLANATION-YIELD.md](EXPLANATION-YIELD.md) with fixed-target replacement-cost and latency measures for the next creation trial. No normal-game change or candidate exposure occurred from this replay.
- 2026-10-04: Recorded the owner's future 200-free-questions/monthly-subscription hypothesis in [FUTURE-PRICING.md](FUTURE-PRICING.md). Existing answer, build, and usage records support an initial read-only cohort-cost report; shared-bank amortization and calls outside a build need attribution review. No Cassian schema, paywall, allowance counter, or payment integration was added.
- 2026-10-04: Owner answered all 23 available admin cards and saved 22 overall ratings (20 Good, 1 Reject, 1 Unsure). The remaining unrated card is the earlier malformed Placeholder item; one candidate was never shown. Independent source audit of all 24 found 8/1/3 keep/revise/reject for Sonnet and 5/3/4 for Haiku. With shared source cost split equally, the pilot cost per audited keep was $0.1270 vs $0.1769. [Owner review](runs/cassian-pilot-2026-10-03/OWNER-REVIEW.md) records the decision not to switch writers and to analyze bank supply/reuse before another paid arm. The ledger stood at $2.059577 spent, $0 reserved. One optional panel note was a question correction saved under the generic "Missing topic" category; it is not a topic-coverage report.

## Next exact actions

1. Run a read-only bank-supply and cross-player reuse analysis: eligible unused stock by topic/tier, answered-out facts, post-difficulty-change build fills, and new generation calls per actual built queue. Do not count carry-forward rows as built games or expose private topic names.
2. Decide whether remaining Cassian budget is best used for answer-only creation or reference retrieval reuse after the bank evidence. Preserve the fixed-target usable-question design for any paid arm.
3. Before another admin review batch, clarify the gate-review control and provide a candidate-specific correction note. Keep the ordinary game and no-repeat rules unchanged; no writer rollout is justified by the small pilot.

At each handoff record branch/commit, deployment SHA, candidate/exposure/review counts, budget spent/reserved, exact model/gate IDs, tests, human feedback and remaining risks. Implementation is not the final experiment result.
