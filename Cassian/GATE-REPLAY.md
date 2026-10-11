# Cassian gate replay

Prepared 2026-10-11; paid dispatch is pending explicit approval to send the saved cases to Anthropic. No replay calls have run. Production writer and gate prompts are unchanged.

The frozen development replay contains sixteen cases: ten quality cases and six factual cases. Each case receives the current and candidate prompt twice, with alternating arm order, for at most 64 calls. The quality model is `claude-haiku-4-5-20251001`; the factual model is `claude-sonnet-5-5`. The local estimate is $0.353250, with a $0.75 run ceiling inside the existing $10 lifetime cap. Automatic retries, retrieval calls and new writer questions are disabled.

The quality candidate narrows the overbroad definition rule, preserves legitimate quote completion, and requires question-stem evidence for answer-leak reasons. The factual candidate emphasizes checking claims in both the question and explanation even when the keyed answer is right. Both are offline prompt builders in `scripts/cassian-gate-prompts.ts`; production does not import them.

Score pass/hold decisions separately from reasons. The scorer checks the expected defect and exact quoted evidence where applicable, but those heuristics require a human audit of every response. Report development cases separately from controls and report repeat disagreements. These known failures and repaired variants are not an unseen holdout, and two repeats of each case are not independent samples. Single-item replay does not establish behavior in full production batches.

One quality control encodes the current definition policy rather than independent owner ground truth. A change on that case must be reported as a policy difference, even if the candidate improves other decisions. Earlier owner card numbering remains unresolved; use immutable private mappings for the known explanation defect.

The private frozen manifest is `_scratch/Cassian/cassian-gate-replay-2026-10-11/private/manifest.json`, SHA-256 `1c5dadd5922dc64b05a184f7266e045e1d70bd7bf2bdcff584c79e46d2f5b163`. Exact topics, questions, expected reasons and any responses stay in ignored storage. The API payload contains question text and evaluator answer metadata; the factual payload additionally contains the explanation. It contains no user identities, ratings or answer submissions.

After approval, set `CASSIAN_ENV_FILE` and `CASSIAN_MANIFEST_FILE`, then use `scripts/cassian-gate-replay.ts --run --limit 8` for the first tranche and `--resume` for the remainder. Invocation without either paid flag only estimates. The runner uses the durable Cassian ledger and exclusive runner lock, verifies the manifest hash, refuses completed calls missing their checkpoint, and retains uncertain charges instead of retrying.

Local validation: TypeScript and focused ESLint passed; sixteen focused scoring, scheduling and budget tests passed. No candidate exposure, bank promotion or gameplay write occurs in this replay.
