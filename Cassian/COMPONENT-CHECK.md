# Cassian component check and parser repair

October 11, 2026. **Reject the third quality-prompt revision for production.** It did not fix the remaining given-name false hold, added another, and regressed the reason for a correct false-premise hold. The previous revision also failed selected tier-policy controls. Production checker prompts and models remain unchanged. A separate three-line JSON-extraction repair is proposed in this PR.

## Single-question comparison

The baseline is the [second giveaway revision](GIVEAWAY-RULE.md), not the current production prompt. The candidate adds explicit requested-name-component and request-group rules, literal quotations, exact code prefixes and reasons under 40 words. Both are offline builders in `scripts/cassian-gate-prompts.ts`; production imports neither.

Six known development conditions and twelve selected conditions received two calls per prompt, alternating order. All 72 calls completed on `claude-haiku-4-5-20251001`, temperature zero, 500 output tokens, with no SDK retries or factual-checker calls. Selection, labels, request bodies and both actual prompts were frozen before these responses. No tuning occurred between sets.

| Measure | Previous revision | Third revision |
| --- | ---: | ---: |
| Development verdict matches | 10/12 | 10/12 |
| Development correct verdict and sound reason | 8/12 | 8/12 |
| Selected verdict matches | 16/24 | 14/24 |
| Selected correct verdict and sound reason | 16/24 | 14/24 |
| Combined verdict matches | 26/36 | 24/36 |
| Combined correct verdict and sound reason | 24/36 | 22/36 |
| False holds | 8 | 10 |
| Unsafe passes | 2 | 2 |
| Parsed verdicts | 36/36 | 36/36 |

The denominators count repeated replies: each arm covers eighteen case conditions, not 36 independent questions. The twelve selected conditions contain eleven question texts, because one fixture is tested at two tiers. Six were deliberately selected from existing maintainer fixtures, four of which overlap rubric examples; six were authored by the same reviewer who designed the prompt and audited all replies. This is a source-reviewed regression sample, **not an independent blind or representative holdout**. Selection exclusions and source mappings are saved privately. One existing fixture's answer metadata was source-corrected before dispatch; its decision label did not change.

## What failed

- The candidate returned six false holds across three given-name conditions while explaining that the requested name was absent and required external recall. It followed the new reasoning language but contradicted that reasoning in its verdict. A genuine quoted substring did not establish answer disclosure.
- The known multipart rationale improved: the candidate identified two request groups rather than treating each same-kind name as its own ask. Another correct hold regressed to an invented answer-leak reason instead of identifying the actual false-role premise.
- Both revisions falsely held allowed catchphrase and specific-object recall fixtures despite retained tier-policy examples permitting those forms. Both also passed a source-confirmed false-count premise twice. This measures the quality checker only; it does not establish what the separate factual checker would do downstream.
- Every successful reply used JSON fences despite the instruction to omit them. Fourteen of the candidate's held single-item reasons reached at least 40 whitespace-separated words. All replies parsed after extraction and ended normally; no truncation or cache tokens were recorded.

The private audit reviews every distinct reply and preserves automatic scores separately from human interpretation. Two previous-revision development reasons were downgraded because they wrongly demanded splitting the individual same-kind names. One selected baseline reason used a dash instead of a colon; its two-group rationale was sound, so the human count is one higher than automatic prefix scoring. All decision repetitions agreed. All paired raw replies were identical except one baseline multipart reason's wording/prefix.

## Batch and output-format attempt

Four six-item mixed batches were planned: two groups in forward and reverse order, two repeats, plain text versus structured JSON. Both arms used the **same third-revision prompt and Haiku 4.5 model**, the same 500-token limit and a 90-second offline timeout. This isolates output format from prompt/model changes. Six-item mapping and malformed-output checks are stricter offline scoring rules; live gate validation was not replaced.

The structured arm uses `output_config.format` with a frozen JSON schema. Index enums, allowed reason prefixes and object keys constrain syntax; they do not guarantee true evidence, consistent verdicts, or complete drop/reason mapping. Local validation checks those mappings. Anthropic documents additional latency for initial schema compilation, but the cause of the observed timeout is unknown. [Official structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

The first plain-text batch completed in 2,701 ms for **$0.003366**, matching five of six labels. It passed two controls falsely held in single-item requests but still missed the false-count premise. One batch cannot establish a batch improvement or order stability. The first structured request aborted after 90 seconds with no response or captured request ID. Its **$0.02 reservation remains uncertain**; it was not retried or released. Fourteen planned calls were never dispatched. There is no structured-output result, so format accuracy, latency and cost comparisons remain incomplete.

The schema design, actual prompts, cases, labels and batch order were selected before responses. Exact schema bytes were materialized into the batch manifest and its baseline prompt-hash metadata corrected after the single-item runs but before any batch dispatch. The private freeze addendum records this; no response-informed tuning changed the request payload design.

## JSON parser repair and free verification

The earlier factual replay exposed an independent extraction failure: an unfenced JSON verdict after prose containing an inch mark was ignored because the prose quote changed the scanner's JSON string state. `src/lib/llm.ts` now starts string/escape tracking at the first opening object brace. Direct and fenced parsing, the first-object selection rule, nested-string escaping and malformed/truncated-output refusal are preserved.

The historical failed response now parses locally, but its recovered verdict is still incorrect. This repairs extraction, not checker reasoning. Historical results and raw files were not rewritten. The fix also left all 73 new completed checkpoint scores unchanged. It affects the shared parser when merged; no model request, prompt rollout, bank import or gameplay write was made to validate it.

Eleven focused test files passed **89 tests**, covering parser, mocked grading/categorization, parameter sanitation, quality/factual gate behavior, replay scoring and budget recovery; six existing opt-in tests were skipped. TypeScript and affected-file lint passed. The runner adds `--score-only` for free checkpoint auditing before credential loading, database access or model-client initialization. It rejects paid flags in that mode and checks the frozen manifest hash. This mode verified the incomplete batch's six verdicts with all credential/environment-file variables unset; it does not settle the uncertain request. Paid resume was not attempted after the timeout.

## Budget and next action

| Work | Completed calls | Settled cost | Run ceiling |
| --- | ---: | ---: | ---: |
| Development regressions | 24 | $0.063670 | $0.15 |
| Selected conditions | 48 | $0.123162 | $0.35 |
| Partial batch comparison | 1 | $0.003366 | $0.25 |
| Total | 73 | **$0.190198** | **$0.75** |

Of 88 planned calls, 73 returned, one has an uncertain charge and fourteen were unstarted. The durable ledger records **$3.976317 spent, $0.02 reserved, $6.003683 available after reservations** within the authorized $10. These are response-token list-price estimates, not invoices. The existing unresolved-reservation guard stops further paid dispatch. Reconcile the failed request using provider billing evidence before considering another paid trial; elapsed time or owner approval alone cannot establish its charge.

Merge the parser repair and audit, retain both prompt candidates for development, and stop adding prompt clauses as the immediate remedy. The next checker design should derive the requested fact and evidence before deciding pass/hold, then validate their agreement. It still needs selected source-reviewed cases and mixed batches, including allowed tier examples and real false premises. Do not automatically resume the abandoned third-revision format trial or switch the writer. No new owner ratings are needed. A subsequent free [bank audit](BANK-SUPPLY.md) found 21 built queues, crossed the planned threshold, and still could not establish fewer generation calls or faster readiness; final bank-placement attribution remains open.

Private manifests, selection, checkpoints, source notes, reply hashes, freeze addendum and `HUMAN-AUDIT.json` remain in ignored `_scratch/Cassian/`. Development manifest SHA-256: `43e495d6135a111d06b6b10f7070ff4b2a51d21606e59a8b0c3243e0e9c35fbe`; selected: `3511c527e1de1bf5bbcc9a27c316e6b48873ae1fb03fffe3c73ee17c3bb3ba38`; batch: `3d10059fc3d532012340a43442cd9d2ea5d3f63c384c9b45afafa7ea61ffa29e`. Candidate prompt SHA-256: `882290a3505d832261855c914c671f00a83ac9592c70a97db5f4a75af4e475ef`; batch schema: `c5597968da7e0f6e13022709255e69f06af7480348b14be7c07bfe80a789372b`.
