# Cassian: captured-evidence writing test prepared

October 11, 2026, after the [source audit](SOURCE-COVERAGE.md) merged in [#1776](https://github.com/joshpalay/Joshing-11/pull/1776). The next test is frozen and locally checked. **No writer or reviewer API reply has been obtained.** It compares one cheap writer under two evidence instructions, rather than switching production models or buying another expensive-writer comparison.

## Frozen design

Six calls ask `claude-haiku-5-5` for one card each: three fixed topic/fact targets, soft versus strict instruction. Both arms receive identical eligible fact inventories and identical captured source bytes for each target. Dispatch order alternates between arms. Both use the production writing/style system prompt plus the same private single-card JSON envelope; the strict arm adds mandatory evidence/fact/claim metadata and forbids filling gaps from memory. This is an adapted production-style protocol, not a byte-identical live writer call. Metadata cost is part of the strict arm's cost.

The initial unexecuted draft is preserved. Final v2 added anonymous reviewer IDs, mixed control grouping and a reviewer payload whitelist before any replies; questions, labels, facts and writing instructions were unchanged. The original approval rejection remains in force until explicit approval.

The source packets retain capture/extraction hashes, source IDs and exact excerpt ranges. Intervening omissions are explicit. The same Codex agent reviewed source links and authored control labels; no independent human review or blind holdout is claimed. Question quality and material claim entailment still require a separate reviewer response and a reason audit. Code can validate quote membership and metadata coverage, not truth.

Nine controls are fixed before replies: the three earlier development prototypes plus six new author-designed controls. New cases include sound quote completion, a named design rule and a historical formation relation, with matched answer-disclosure or explanation defects. Six source/quality calls review three batches of three. Reviewers see neither expected labels, original decisions nor model/arm identity; quality input excludes explanation/source prose. Fresh means new to this case set, not independently selected unseen production data.

After the initial twelve calls settle, a free preparer freezes up to two additional Sonnet 5.5 requests to review all parsed generated cards. It strips writer identity, arm, claim inventory, prior control verdicts and expected labels. It retains malformed/shortage attempts in the denominator and reviews parsed cards even when strict metadata checks fail, so mechanical exclusion cannot hide source errors. If no cards parse, no generated review calls are created. The preparer refuses incomplete initial checkpoints and will not overwrite an existing second-stage manifest.

| Stage | Maximum calls | Ceiling |
| --- | ---: | ---: |
| Six writers plus six control reviews | 12 | $0.50 |
| Generated-card quality and source review | 2 | $0.25 |
| Combined | **14** | **$0.75** |

The initial estimate is **$0.146704**, with approximately 4¢ allowed in the planning estimate for generated reviews (about **19¢ total**). These are estimates; actual usage is unmeasured. Review prompts are the previously frozen targeted quality/factual contracts, unchanged in both arms. Haiku uses native adaptive thinking/low effort; Sonnet uses the existing sanitized native floor. Each call allows 3,000 output tokens, a 30-second timeout and zero SDK retries. API structured output and provider web tools are absent.

## Code and verification

The [frozen-request CLI](../scripts/cassian-evidence-calls.ts) defaults to a free estimate. `--score-only` reports saved-call totals without credentials/DB/provider use and cannot combine with paid flags. Explicit `--run`/`--resume` is required for dispatch. File hashes, request fingerprints, model/settings restrictions, anonymous reviewer identities, allowed reviewer fields, run ID and checkpoint content hashes are checked. Paid resume requires matching settled ledger receipts; a completed ledger call without a checkpoint cannot be repeated.

Every paid call takes the existing advisory lock and an atomic reservation (5¢ per writer or 15¢ per Sonnet review), saves its checkpoint before settlement and rechecks the conservative budget. Only matching uncertainty on other halted runs can be carried. A new own-run timeout remains reserved/halts that run; it cannot be carried away by that same runner. The older failed 2¢ call stays halted and reserved. Neither its retry nor its release is part of this experiment.

The [pure core](../scripts/cassian-evidence-core.ts) validates final JSON/shortages, fact identity, required strict field/variant claims, exact claim substrings and captured source quotations. Union coverage detects text omitted from the declared inventory. A fully covered but false claim can still pass these mechanics; a focused test deliberately demonstrates that limitation. The [existing assessment core](../scripts/cassian-targeted-core.ts) now exposes the same strict batched evaluator without inventing writer labels for agent-authored controls. Existing scoring behavior is preserved.

**53 focused tests across six files passed**, alongside TypeScript, affected-file lint and diff checks. Tests cover request/settings drift, unsafe file paths, duplicate IDs, changed checkpoint contents, malformed/nonfinal writers, shortages, omitted claims, invented evidence, batch refusal and existing budget/recovery behavior. Free plan ran with API/DB/environment-file variables unset. A free second-stage attempt correctly reported that it awaits saved replies and created no requests. Read-only budget proof found zero spend/reserve for both new runs, the earlier uncertain call unchanged, and a new reservation fitting inside the cap.

## Current approval and limits

Automatic approval review rejected the first proposed `--run --limit 1` command **before the process started**. It requires explicit approval for this new experiment's private question/source payload sent to Anthropic. The approval question requests up to fourteen calls, about 19¢ estimated and capped at 75¢ within the existing $10 budget, while retaining the older 2¢. No workaround or further paid attempt occurred. Await that answer before dispatch.

The ledger remains **$4.110187 spent, $0.02 reserved, $5.869813 available**, from the new read-only check. Initial run ID: `cassian-evidence-writing-v2-2026-10-11`; manifest SHA-256 `7d16f6af34702b1ecf9f677e2ff136d77fa3265dda7ce2039f62da556920831b`. Exact topics, controls, sources, labels, requests, budget proof and the preparer stay ignored under its private run directory. The second-stage run ID is `cassian-evidence-generated-v2-2026-10-11`, but its requests cannot freeze before actual writer replies.

After approval, run the frozen comparison, inspect every source/quality reason and audit generated claims. Report writer/metadata cost, review cost, all-attempt yield, shortages, invalid output and non-Keep/unsafe approvals separately. Allocate mixed reviewer cost by reviewed-card count and disclose that convention. No owner appeal ratings, cold retrieval, replacement generation or serving novelty check is included; all cards remain private, with no bank/gameplay writes. No complete-pipeline, live-readiness or monthly-savings claim follows from this small cached-source development test alone.
