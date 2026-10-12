# Cassian evidence contract v3: offline revision

October 12, 2026. Implements the next free stage after the [separate adjudication](EVIDENCE-ADJUDICATION.md). The [pure v3 module](../scripts/cassian-evidence-v3.ts) is separate from the completed v2 runner, scorer and production code. **No saved trial is re-scored and no paid dispatcher is connected.**

## Material claims instead of every character

Cards have `schemaVersion: 3`, an ID, question, canonical answer, every accepted variant, explanation, identified claims and explicit question scaffolding. Each claim records an ID, an atomic assertion, a target (`question`, `answer`, `explanation`, or indexed `variant`), an exact UTF-16 card span and source-span citations. Ordinary interrogative/grammatical text can be recorded as scaffolding. Labeling an assertion as scaffolding cannot establish that it is nonfactual; the separate reviewer must inspect the full question.

Mechanics validate IDs, bounds, exact card spans and source citations. They do not demand every letter be factual evidence. After independent claim reconstruction, `inventoryOmissions` reports reconstructed spans not mapped by writer spans; semantic equivalence of assertions still requires adjudication. An absent writer record and an unsupported claim are different findings. A valid record is neither truth nor serving approval.

`assessEvidenceCardV3` combines independent source/acceptance review with the strict arm's metadata obligations, while keeping the source decision visible. Missing strict records require review rather than becoming a factual-error label; source contradictions remain holds. Soft writing does not acquire the strict inventory requirement. Neither mode skips full-card/variant reconstruction.

## Readable evidence with locators

Each source retains URL, title, section, edition when known, capture/extraction hashes, captured text, readable text/hash, locator, a UTF-16 map back to the original extracted text, and explicit removed presentation spans. Readable text folds whitespace. Only explicitly identified presentation line-number spans may be removed; digits are never guessed from their appearance. Source dates/counts remain intact. The private replay derives presentation spans from numbered HTML nodes and reproduces the original extraction before recording removals. Omissions remain visible.

Citation membership permits only whitespace and typographic quotation-mark differences at a specified readable source span. It preserves words, numbers, negation and order. A stable span plus raw map locates the evidence; neither a familiar acronym expansion nor a section label creates missing evidence. Identity metadata is supplied to the reviewer, and requested definitions must be present in source text before they can be certified. Capture/locator records must be frozen alongside the request; their schema alone cannot authenticate a page or semantic claim.

## Reviewer reconstructs the whole card

`reconstructionInput` sends full question, answer, indexed variants, explanation and identifiable readable sources. It excludes the writer inventory, scaffolding, arm/model identity, expected labels and earlier reasons. The fixed reconstruction prompt asks for independently identified material claims with card/source spans and supported/contradicted/unknown judgments, plus a coverage attestation for every field/variant and a separate acceptance judgment for canonical answer and every variant.

Variant acceptance checks the actual ask: entity, specificity, answer type and explicitly requested language. An English translation is not accepted for an explicit German-phrase ask under v3. Partial names or container-only answers need an explicit unambiguous acceptance judgment; uncertainty remains review-required. There is no blanket expansion-from-memory exception.

Malformed/nonfinal output, missing/duplicate IDs/targets, invalid spans and bad quotations require review. A bad quote is not evidence of factual error. Validly recorded contradictions or incorrect answers/variants derive a hold; absent support or uncertain reconstruction derives review. A pass means the returned assessment passed these mechanics, **not** that code proved entailment or complete reconstruction. Quality and novelty remain separate gates; this module has no release function. Quality input continues to exclude explanations and sources.

Unknown answer acceptance includes an explicit `basis` so unresolved acceptance policy is reported separately from missing source support.

## Verification and freeze boundary

**48 focused tests across three files, TypeScript and affected-file lint passed.** The focused tests separate supported claims, contradictions, missing evidence, harmless quotation formatting, malformed output, missing variants and uncertain reconstruction. A deliberately false semantic assertion passes structurally valid mechanics, documenting their limit. Synthetic relational counterparts accompany the private mandatory original chronology, attribution and formation regressions.

The free replay adapts all six saved cards without editing them, validates their writer citations, locates both old malformed quotations, retains the three mandatory relation outcomes and verifies frozen historical hashes/scores. Hand-authored reconstruction is disclosed; the reviewer model has not been tested with this v3 protocol. Source preparation time is unknown retrospectively and will be measured prospectively.

This revision's code, tests, prompt, policy, replay/adjudication and [selection/measurement protocol](EVIDENCE-EVALUATION-PLAN.md) are frozen by hash after the passing checks, with a private freeze record. The free replay's `--verify-only` mode checks frozen hashes without overwriting artifacts. Any subsequent change is a new version; do not add case-specific exceptions after seeing a paid output. Passing these checks establishes that the experiment can record intended distinctions, not that a model is reliable. Exact fresh topic selection, source inputs, settings, gold and dispatch budget are a later freeze before any new paid call.
