# Cassian: explicit card scope and answer references

October 12, 2026, following merged [#1787](https://github.com/joshpalay/Joshing-11/pull/1787) at `f56cdd22`. This free offline revision makes the proposed interpretation rules explicit after the [coverage integration](COVERAGE-PROBE-RESULTS.md) found reviewer-added context and inconsistent answer/variant coverage. It adds a separate audit helper and saved-case replay. It does not edit the executed runner, prompts, gold, source responses or machine scores, and is not connected to paid dispatch or production.

## Material scope

A question asserts its stated relationships and qualifiers, plus the minimal named entity/work/trial identity needed to interpret the ask. Its name does not assert every fact from the source about that entity. An interrogative asking which person performed an action does not itself state the hidden person's name. Dates, quantities, chronology, attribution and formation roles explicitly present in the card remain material.

Every reconstructed assertion must appear in the scope audit. A mixed assertion can split into multiple components: actual card assertions and explicitly identified source-only context. Each component binds a unique quote in the correct original field, its reconstructed claim IDs, an assertion, a role and a semantic reason. Source-only context remains visible in the result; it is not silently deleted. An entire asserted field cannot be discarded, and an answer/variant cannot be discarded as source context. Every material component needs one explicit covered/missing/uncertain mapping.

These are **semantic attestations**. A real quote, complete accounting and a hash do not prove that decomposition preserves every material fact. No fuzzy assertion matcher, quote-containment rule or fact-ID shortcut supplies that judgment.

## One rule for both answer forms

For a question such as “Who designed the lamp in 1842?”, both a full name and a permitted surname identify the answer variable of that complete ask. Each needs a local same-field identity record. Both inherit the identical explicit binding to **all** material question components. The question inventory must itself cover those components; a missing year blocks both references. The source/acceptance check must still establish the referent against the entire ask, including language and explicit full-name requirements.

Additional factual content stated in an answer or variant needs its own same-field record. Explanations always record their own assertions; neither a question record nor an answer record covers an explanation omission. This replaces the inconsistent practice of permitting canonical answers to borrow context while demanding that variants repeat every question qualifier. It is a new proposed policy, not a retrospective repair of strict scores obtained under the earlier rule.

The helper preserves the original source decision, including missing-evidence review and contradiction hold, even when the new inventory is complete. Every result remains `notServingApproval`. It does not produce a revised source/quality pass or certify novel, eligible, usable stock.

## Relations and ambiguity

Formation evidence must preserve the participants, result and whether that result is new or preexisting. Two predecessors forming a new successor cannot support one predecessor joining a preexisting successor. Unknown newness remains unknown. Chronology requires order, not a mention of both subjects; attribution compares the speaker of the same utterance, not a nearby name. The helper compares explicitly supplied role structures. Extracting those structures correctly from prose remains adjudicator work; no model has been shown to do this reliably. Historical continuity conventions are separate from the precise formation relation.

Ambiguity needs two distinct referents or interpretations that fit the unchanged ask. Both alternatives bind the complete question/answer/domain/tier input and actual question quotes. Two spellings of one referent do not count. Specialist knowledge by itself is a difficulty consideration; a named study and determinate outcome can be appropriate at specialist tier. An absent ambiguity witness leaves the reason unsubstantiated, not automatically clear. The witness remains an explicit reviewer attestation; code cannot prove that its alternatives are real or that they satisfy the ask. Independent appeal/difficulty review remains unassigned.

## Separate saved replay

Explicit author audits cover four saved cards, **26 material components and five source-context components**. The two saved inventory controls use clearly labeled author-prepared schema projections of the saved source response; they are not new native model replies. All original bytes and scores remain unchanged.

| Saved case | New offline interpretation |
| --- | --- |
| Strict music card | Incomplete: explicit scale-size qualifier missing from question inventory; both answer references blocked by that missing context. |
| Strict empirical card | Inventory complete under the uniform reference rule; reviewer-added trial/answer details are separately recorded as source context. Original source/quality scores and evidence-fragment/policy uncertainties remain. |
| Saved missing inventory | Incomplete: explanation omission remains despite corresponding question/answer records. |
| Saved complete inventory | Complete: all explanation relationships retained; shorter date/measurement anchors and paraphrases remain acceptable. |

The chronology, attribution and formation cases were also replayed with **author-extracted** typed roles: unknown chronology, contradicted attribution and contradicted precise formation. If formation newness is interpreted as unspecified, its result is unknown, not supported. These results verify mechanics given explicit role extraction; they do not fix, rescore or retest the paid checker that passed formation. The specialist quality hold supplies no competing-answer witness, so its policy disagreement stays unresolved.

The suite has **174 passing tests across fourteen files**, including 22 new tests for consistent references, real omissions, source failure preservation, bound scopes, mandatory relations and ambiguity witnesses. TypeScript and affected-file lint pass. Tests use synthetic public fixtures. Literal quote validation, malformed/nonfinal source replies, missing evidence, contradictions, uncertainty and harmless quote-anchor differences are checked separately.

This phase made **zero inference, token-count, database or retrieval calls**. Last verified lifetime ledger remains $5.865966 spent, $0.02 old uncertainty reserved, $4.114034 available. Preparation/adjudication labor is unknown, not free. Full creation cost per independently usable new unique question, cold/depleted readiness and invoice reconciliation remain unmeasured. No new owner trivia ratings are needed.

## Freeze and next work

Private freeze: `_scratch/Cassian/cassian-card-scope-2026-10-12/private/CONTRACT-FREEZE.json`, SHA `7be123ed0a431263ac195851ca56c5233e784bf7e7f9236b19ee301614eb4b14`. Fifty-five exact artifacts preserve the executed free helper, audits, projections, replay results, prior inputs and pre-update documents. All 451 older archived artifacts and 23 executed runtime/input pins were verified unchanged. The private replay helper subsequently received type annotations only; its exact executed bytes remain archived. Runtime scope policy and replay artifacts are unchanged. Detailed case/source/history/gold text remains private.

Next review the explicit scope/reference/ambiguity policy independently where feasible, then integrate it into a distinct bounded frozen design with reconstruction and reconciliation kept separate. Retain supported and unsafe controls, mandatory relation regressions and unresolved cases; count additional checks and semantic preparation. No paid dispatch is ready from this free freeze. A later fresh 20–30-topic comparison still needs realistic history/tier constraints, frozen scoring and complete-task retrieval/failure/replacement/labor/readiness accounting before rollout.
