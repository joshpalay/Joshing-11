# Cassian: v4 evidence and quality contract

October 12, 2026. This is a new offline contract and opt-in compatibility runner. It does not replace the executed v3 design or production gates. See [compatibility results](COMPATIBILITY-RESULTS.md) for its bounded real-model test and the [earlier fresh results](FRESH-RESULTS.md) for the failures that motivated it.

## What changed

- Code locates actual card/source quotations using the tested locator. The models supply identifying quotes instead of calculating numeric offsets. Absent or repeated text stays unresolved. A correctly located quote still needs a sound interpretation.
- Strict writers identify factual claims using card-field quotes and prepared eligible fact IDs. Code binds those IDs to the existing source spans. This reduces repeated citation output; selecting a fact ID does not prove that it supports the new assertion. Interrogative/grammatical scaffolding can be recorded separately.
- The source reviewer reconstructs the whole question, canonical answer, every variant and explanation without seeing the writer's inventory. Readable source text, stable source identities, provenance hashes and locators are supplied.
- Canonical answers and variants receive separate entity, answer-type, language and specificity checks. The supplied policy permits compatible short forms when the ask permits them and enforces explicit full-name, original-language, units and missing-word requirements. Missing support remains unknown rather than a contradiction.
- The quality reviewer sees only the question, canonical answer, topic and tier. Variants join explanations, sources, inventories and private gold outside that input. Every hold must quote the actual question. The reason can still be mistaken despite real quoted words.
- The provider receives the SDK-generated native JSON schema. Local Zod limits, complete field bindings, quote locations and cross-field checks remain authoritative. Only protocol enum strings are case-folded; names, quotes, IDs and answers are not.

The [Anthropic structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) describes schema-constrained JSON and the refusal/truncation exceptions. The installed SDK transforms unsupported schema constraints; local validation remains necessary. The frozen request includes the native schema in both token counting and its request hash. Schema compilation may affect first-call latency.

## Meaning of results

Source findings distinguish factual contradiction, missing evidence, invalid/ambiguous quotation, incomplete reconstruction, incorrect answer/variant and policy uncertainty. Strict inventory omissions are separate from source support. Its mechanical comparison uses card-span containment; differently selected spans can require adjudication even when they describe the same relationship.

There is no serving approval in these modules. Source truth, semantic inventory completeness, novelty, task fulfillment and reason validity still require review. A reviewer marking coverage complete is an attestation, not a proof. A malformed response causes protocol review and cannot be counted as a factual hold. Rejecting every control cannot establish reliability.

Synthetic tests cover supported/contradicted/missing cases, quotation ambiguity, malformed/nonfinal replies, explicit variant mismatches, unsubstantiated entity mismatches, strict inventories, blinded inputs, native schema transmission, dependent receipts, price drift and free CLI execution. Saved replay converts only the transport shape of thirteen prior quality holds; all thirteen quoted strings locate, without changing their reasons or frozen scores. The prior 235 executed archived artifacts are verified unchanged.

## Frozen compatibility probe

Two previously approved source packets supply four Haiku 5.5 writes: soft and strict for each packet, with arm order alternated. Eight previously approved controls include two sound questions, three challenge questions and the mandatory chronology, attribution and formation regressions. All model-visible IDs use the same opaque format. Source checks use Sonnet 5.5; mixed quality batches also use Sonnet 5.5. No repairs, retries, replacements, tools, new retrieval or after-output prompt/gold changes are permitted.

Maximum: four writers, four generated-card source checks, eight control source checks and two quality calls, or eighteen paid calls. Software run cap is $0.75; total planned reservations are $0.727 inside the existing $10 lifetime cap. Writer output allowance is 3,500 tokens, source review 3,600, quality 1,600. Timeout is sixty seconds. Exact known requests are preflighted before inference; each dynamic request is counted before payment, with 1,000 input-token headroom. An initial no-inference draft missed that headroom for one source-rich control; it was preserved and superseded before paid outputs by the final frozen allowance.

The private final design is `_scratch/Cassian/cassian-compat-v4-prep-2026-10-12/private-final/design.json`, SHA `0c44f577d0c3ac2677e64a3a23891218a04cde56d4a5789d5fe3d9e18906de30`. Run ID: `cassian-compat-v4-2026-10-12-final`. Prepared evidence and control text come from the already approved v3 study; gold is still same-author development material. Predeclared compatibility criteria require four final writer candidates with complete strict inventories, valid source/quality replies, retention of both sound controls, no unsafe challenge passes and resolution of all three regressions. Those criteria are necessary mechanics checks, never a reliability or rollout threshold.

## Local commands

Set `CASSIAN_COMPAT_DESIGN` to that private final design; credentialed commands also accept `CASSIAN_ENV_FILE`. `scripts/cassian-compat-calls.ts` defaults to free scoring. `--score-only` and `--run --limit 0` do not load credentials or open a database/provider client. `--budget` is read-only; `--preflight` counts tokens without inference. Explicit `--run`/`--resume` dispatch sequentially with a runner lock, reserve-before-call ledger entries and exact receipt journals. Completed resume reuses receipts without new token/inference calls. Unknown charges and missing/conflicting receipts block replay; the older halted uncertain 2¢ remains reserved.

Keep private designs, source text, questions, responses, control gold, histories and detailed audits in ignored `_scratch/Cassian/`. Provider amounts are list-price estimates rather than reconciled invoices. This cached, curated probe does not measure automated retrieval, evidence preparation labor, independent adjudication or cold/depleted-topic readiness. Full creation cost per new usable unique question remains the primary metric; bank maturity and the $5/month aspiration remain separate.
