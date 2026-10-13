# Cassian: offline verification repair

October 13, 2026. Following the failed reason/contract criteria in the [saved scope model test](SCOPE-PROBE-RESULTS.md), the generic comparison mechanics now require explicit, bound semantic references. The original paid outputs, gold, scores and executed code remain unchanged. This is a separate offline shadow verifier, with zero new provider calls, token counts, retrieval or database activity.

## What changed

The new `scripts/cassian-verification-fix.ts` uses a reviewed contract bound to hashes of the whole card, writer inventory and readable source documents. Every contract witness must locate uniquely in its declared document. Stale contracts and invented witnesses fail validation. The contract records reviewer identity and whether the review is independent.

- **References have identities and types.** Explicitly reviewed full names, surnames, speaker headings and blank/completed forms of a quotation can share stable IDs. An unknown label, ambiguous identity, requested answer variable or scoring event cannot become a contradictory spoken attribution. No fuzzy name matching or automatic surname equivalence is used.
- **Predicate and source meaning are bound separately.** A model proposal must retain the reviewed actual card relation and match the reviewed source relation. Two matching model tuples do not prove chronology. A valid quotation from another passage cannot borrow the reviewed passage's relation. Source quotes must be actual unique spans; fabricated ellipsis splices stay failures.
- **Required ask atoms cannot be waived.** Reviewed qualifiers and their permitted literal writer forms are checked against actual same-field writer assertions, regardless of a model's `covered` verdict or `source_context` label. A quantity in an explanation, date or unrelated phrase cannot satisfy a missing question qualifier.
- **Answer names share the whole ask.** Canonical answers and variants use reviewed local identity witnesses. Code derives their identical question context, including protected requirements, rather than accepting selective inherited context from the model. Explanations retain their own records and cannot borrow answer/question coverage.

Inventory completeness remains separate from factual support. The helper retains the original source decision and always returns `notServingApproval: true`. It has no provider, database or production adapter and does not alter prompts or global model switches.

## Replay of the exact saved outputs

The four native scope outputs and relevant comparisons from all three role outputs were replayed unchanged. New binding contracts are explicitly **same-author manual review**; they are not fresh model outputs or independent adjudication.

| Saved case | New shadow result |
| --- | --- |
| Missing question quantity falsely called covered | Incomplete; the same-field writer record still lacks the protected quantity |
| Empirical answer variant rejected for repeated wording/missing inherited context | Complete inventory; local equivalent identity and identical code-derived ask context resolve the binding error |
| Explanation inventory with a real omission | Incomplete; omission retained |
| Paired complete explanation inventory | Complete; named trial identity and period remain protected context despite the model's exclusion |
| Correct question attribution with differing labels/blank form | Supported after explicit reviewed entity/utterance binding |
| Incorrect explanation speaker | Contradicted for the same bound utterance |
| Question variable and valid surname miscast as different speakers | Unknown/unresolved reference; false contradictions removed, scoring remains a nonspeech event |
| Formation target reduced to chronology by the model | Unknown/card relation changed; the failed extraction remains visible |
| Formation target with the separate reviewed accession/formation tuples | Contradicted under the saved precise-newness interpretation; **author extraction, not model success** |
| Chronology inferred from paragraph order | Unknown/source relation unverified |
| Fabricated source quotation splice | Unknown/invalid source quote; uncorrected |

The formation wording remains sensitive to historical-continuity policy. The reviewed accession-to-existing versus formation-of-new comparison preserves the earlier explicit interpretation; it does not resolve that policy disagreement automatically. No combined success rate or new usable yield is claimed from these shadow results.

## Validation and preservation

Eighteen new synthetic regressions cover aliases, ambiguous/unknown references, nonspeech events, real contradictions, stale inputs, invalid and borrowed quotes, changed predicates, protected qualifiers, uniform answer context, genuine omissions and preservation of failed source decisions. The focused suite passes **204 tests across 16 files**; TypeScript and affected-file ESLint pass. One initial existing CLI test exceeded Vitest's default five-second limit; the complete suite passed with a 30-second test allowance while its original 15-second child-process limits remained unchanged.

Private artifacts are in ignored `_scratch/Cassian/cassian-verification-fix-2026-10-12/`: the exact replay script, reviewed contracts, shadow results, preservation proof and **50-file byte archive**. Freeze SHA: `b30846d61ea6f0b7292d78b72bc7f4dd56801ff676d590d40c1aa748405b1d05`. All **600 earlier archived artifacts, 18 unexecuted draft artifacts and 23 latest executed pins** were verified unchanged. Current-status documents were archived before updating them. Old source/quality responses and scores are not repaired or overwritten.

## Cost and next decision

This phase spends **$0** on models. The last verified lifetime ledger remains **$6.396224 spent, $0.02 reserved/uncertain, $3.583776 available** under the authorized $10 cap. Never retry or release the old uncertain call merely to clear its accounting state.

The repaired mechanics rely on reviewed identities, required atoms and relation extraction. They do not discover those semantics or establish automated model reliability. Preparation/review labor remains unmeasured and cannot become a free production dependency. Independent review is still unassigned.

Next review the binding policy and how those contracts will be produced and costed, then freeze an integration design before another paid comparison. Keep sound controls, unknown evidence, real omissions and policy sensitivities separate. Full creation cost per independently usable new question remains the primary metric; saved checking alone cannot measure it. Production rollout still requires fresh independent quality/variant/novelty/coverage evidence and complete retrieval, labor, failures, replacements and readiness accounting. No new owner trivia ratings are needed.
