# Cassian quality checker model comparison

Completed October 11, 2026. **Keep the production quality checker unchanged.** Haiku 5.5 was cheaper in this replay but matched fewer frozen verdicts and held more sound questions. This tests one prompt/configuration on known cases; it does not establish that the model is generally worse or change the promising writer findings.

Ten quality cases from the earlier [prompt replay](GATE-REPLAY.md) received the identical current quality prompt and identical bodies, twice per model, with alternating arm order. All forty calls completed for **$0.118195**, below the frozen **$0.50 cap**, with no retries, retrieval, factual-gate calls or new writer questions. The ledger now records **$3.454265 spent, $0 reserved, $6.545735 remaining** of $10. Costs use response-token list prices, not reconciled invoices.

| Measure | Haiku 4.5 | Haiku 5.5 |
| --- | ---: | ---: |
| Calls / distinct cases | 20 / 10 | 20 / 10 |
| Parsed verdicts | 20 | 20 |
| Matches frozen pass/hold label | 16 | 11 |
| Correct verdict with fully sound held reason | 14 | 10 |
| False holds | 4 | 9 |
| Unsafe passes under frozen labels | 0 | 0 |
| Response-level cost, all twenty calls | $0.103932 | $0.0142634 |
| Mean request time | 1.723 s | 1.399 s |
| Median request time | 1.502 s | 1.383 s |

The reason column counts correct passes plus correct holds with a fully sound rationale. Haiku 5.5's automatic reason score was 11; human review reduced it to 10 because one correct role-based hold also invented a multipart defect. Raw labels and replies remain unchanged. The exact role problem was identified in both repetitions, but only one rationale was wholly acceptable.

Haiku 5.5's direct checker calls cost about 7.3 times less. Extra false holds can trigger replacement writing/checking; this replay did not measure that cost or topic-to-ready latency. Faster individual replies do not establish a faster player experience. Both models used a 500-token output ceiling. Haiku 4.5 used temperature zero; the existing sanitizer removed unsupported sampling parameters and disabled thinking for Haiku 5.5. This is a deployable configuration comparison, with required model-native parameter differences, not a matched-temperature or adaptive-thinking experiment. The same text averaged 4,646 input tokens on 4.5 and 6,465 on 5.5.

| Subset: matching frozen verdicts | Haiku 4.5 | Haiku 5.5 |
| --- | ---: | ---: |
| Development cases | 6/10 | 4/10 |
| Controls | 10/10 | 7/10 |
| Excluding existing-definition-policy control | 14/18 | 9/18 |

Both models falsely held the valid quotation and contextual recall cases. Haiku 5.5 correctly held the false-role premise, replacing 4.5's invented name-leak reason, but falsely held the motto question and clean geographic recall. One geographic hold explicitly said the item should be kept while its `drop_indices` still held it. Another clean control changed from a false factual rejection to a pass across identical requests; primary source review corroborated the frozen label. Haiku 4.5 repeated its prior decisions throughout. Both models caught the explicit named-answer leak, printed-answer cloze and multipart controls.

All replies ended normally, with no truncation or prompt-cache tokens. Nineteen Haiku 5.5 replies and fourteen Haiku 4.5 replies were JSON-only after optional fence removal; production extraction recovered all forty verdicts. One Haiku 5.5 case changed binary decision between repetitions. Two repeats are not independent trials. These five development cases and five controls are not an unseen holdout or a representative production sample; the policy control measures adherence to an existing rule, not independent owner ground truth. Single-item calls omit production batch context.

The private manifest is `_scratch/Cassian/cassian-checker-models-2026-10-11/private/manifest.json`, SHA-256 `fb1f2ff23029b8077c71b44a52446bd6c9d6a9b4c7154e311a1cd38b9920c1a5`. Its cases and prompt are unchanged subsets of the previously approved Anthropic payload. Exact topics, questions, raw responses, source corroboration, hashes and the single-reviewer audit remain ignored. The owner explicitly requested this model comparison after approving the saved-case transfer; initial automatic approval review was resolved by proving unchanged payload/destination, without requesting duplicate owner approval.

The offline runner now accepts arm-specific quality models only when quality prompts are identical, models differ, and all cases are quality cases. Existing prompt comparisons retain their validation. Seventeen focused scoring/scheduling/budget tests, TypeScript and affected-file lint passed. Completed resume made no new calls and left spending unchanged. No production model, prompt, parser, candidate exposure, bank or gameplay change occurred.

**Next:** redesign and evaluate the overbroad definition/giveaway rule with explicit positive and negative controls, retaining genuine answer-leak and false-premise checks. Keep decision correctness separate from reason correctness and include contradictory JSON/rationale cases. Address the separately reproduced extraction bug with a focused regression test. Freeze a fresh holdout before any production gate rollout; the current model comparison does not justify a checker switch or a live writer change.
