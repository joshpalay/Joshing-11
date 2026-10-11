# Cassian gate replay

Completed 2026-10-11 after explicit owner approval to send the saved cases to Anthropic. All 64 calls settled for **$0.358439**, with **$0 reserved**. Neither challenger is ready for production: both performed worse against the frozen verdicts. Production writer and gate prompts are unchanged.

The frozen development replay contains sixteen cases: ten quality cases and six factual cases. Each case received the current and candidate prompt twice, with alternating arm order, for 64 calls. The quality model was `claude-haiku-4-5-20251001`; the factual model was `claude-sonnet-5-5`. The local estimate was $0.353250, with a $0.75 run ceiling inside the existing $10 lifetime cap. There were no automatic retries, retrieval calls or new writer questions.

The quality candidate narrows the overbroad definition rule, preserves legitimate quote completion, and requires question-stem evidence for answer-leak reasons. The factual candidate emphasizes checking claims in both the question and explanation even when the keyed answer is right. Both are offline prompt builders in `scripts/cassian-gate-prompts.ts`; production does not import them.

Pass/hold decisions were scored separately from reasons. One reviewer audited all 64 raw responses against the frozen cases; the automatic code/term/quotation checks were not treated as sufficient evidence. These known failures and repaired variants are not an unseen holdout, and two repeats of each case are not independent samples. Single-item replay does not establish behavior in full production batches.

| Gate and arm | Calls | Parsed verdicts | Matches frozen verdict | Correct verdict with acceptable held reason |
| --- | ---: | ---: | ---: | ---: |
| Quality, current | 20 | 20 | 16 | 14 |
| Quality, revised | 20 | 20 | 12 | 12 |
| Factual, current | 12 | 12 | 8 | 8 |
| Factual, revised | 12 | 11 | 5 | 5 |

A correct pass has no held reason to assess. The final column counts those correct passes plus correct holds supported by the actual defect. A correct hold with invented evidence does not qualify. Unparsed output never counts as a successful verdict.

| Subset | Quality current / revised | Factual current / revised |
| --- | ---: | ---: |
| Development: matching verdicts | 6/10 / 6/10 | 3/6 / 1/6 |
| Controls: matching verdicts | 10/10 / 6/10 | 5/6 / 4/6 |
| Excluding policy or ambiguous control | 14/18 / 12/18 | 7/10 / 5/10 |

The quality candidate fixed the non-leaking quote-completion hold, but both arms still falsely held another contextual recall question. The original motto false hold did not recur in either arm. The candidate stopped inventing a name-leak reason on a false-role question, but passed its genuine premise error instead. It also passed a control that printed the missing word before asking for it, twice. Both arms retained the explicit named-answer leak hold and multipart hold. Under all frozen labels, current quality had four false holds and zero unsafe passes; revised quality had two false holds and six inappropriate passes, two of which concern the policy control below.

The factual candidate continued to pass the false nickname attribution and wrong whole-work title. Both prompts sometimes recognized a defect in their prose and waived it anyway. Current factual caught the wrong-role premise twice; the candidate caught it once and then waived it. The second candidate reply had a valid trailing pass object that production JSON extraction could not recover, so its frozen score is invalid rather than pass. Current factual had three unsafe passes and one false hold; revised had four unsafe passes, two false holds and one unparsed verdict under the frozen labels.

All quality case/arm pairs repeated the same verdict. Two current factual pairs changed between pass and hold. One revised factual pair changed from hold to an unparsed reply whose intended verdict was pass. Replies completed with `end_turn`; none was truncated. Twenty responses were JSON-only after optional fence removal; 44 included extra prose. The existing extractor recovered 63 verdicts. No prompt-cache tokens were reported.

One quality control encodes the current definition policy rather than independent owner ground truth. The candidate passed it twice, as its narrowed rule permits. This is a policy difference, not independently established harm. Removing it still leaves worse quality verdict agreement, including the genuine printed-answer leak regression.

One factual control was intended as a correct whole-work/part-title repair, but its bare “closing movement” reference has two possible antecedents. That was a weakness in the prepared control. The frozen pass label and raw scores remain unchanged; excluding that case still leaves the candidate worse. A future manifest must name the source work explicitly. Earlier owner card numbering remains unresolved; immutable private mappings identify the known explanation defect.

A local, generic reproducer confirmed a separate extraction bug: an unescaped inch mark in preceding prose can disrupt `parseJsonObject`'s quote state, preventing recovery of a valid unfenced trailing object. Plain JSON and the equivalent fenced object parse. This report records the issue; no production parser or fail-open behavior was changed. The intended underlying verdict on this run was also unsafe, so fixing extraction alone would not improve correctness.

The private frozen manifest is `_scratch/Cassian/cassian-gate-replay-2026-10-11/private/manifest.json`, SHA-256 `1c5dadd5922dc64b05a184f7266e045e1d70bd7bf2bdcff584c79e46d2f5b163`. Exact topics, questions, expected reasons and any responses stay in ignored storage. The API payload contains question text and evaluator answer metadata; the factual payload additionally contains the explanation. It contains no user identities, ratings or answer submissions.

The first eight calls settled for $0.042896 before resuming the same manifest to 64. A completed `--resume` reused all results and left spending at $0.358439 with no new calls or reservations. Invocation without either paid flag only estimates. The runner uses the durable Cassian ledger and exclusive runner lock, verifies the manifest hash, refuses completed calls missing their checkpoint, and retains uncertain charges instead of retrying.

Local validation: TypeScript and focused ESLint passed; sixteen focused scoring, scheduling and budget tests passed. Private `HUMAN-AUDIT.json` preserves response hashes, per-call review, subset scores and repeat changes; a generic local script reproduces extraction failure without an API call. No candidate exposure, bank promotion or gameplay write occurred. The durable lifetime balance is **$3.336070 spent, $0 reserved, $6.663930 remaining** of $10. Costs use response-token list prices, not reconciled invoices.

**Decision:** reject both candidate prompt versions for production. Next compare Haiku 5.5 with Haiku 4.5 as the quality checker using the same current prompt and balanced controls, keeping prompt and model effects separate. Clarify the weak factual control in a new frozen manifest, investigate the extraction bug with a focused regression test, and preserve source review for known factual errors. These results do not justify a live writer switch. Any later live trial needs a separate reviewable rollout with a rollback path and full-path quality/cost measurements.
