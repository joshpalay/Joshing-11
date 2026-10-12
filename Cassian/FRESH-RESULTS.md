# Cassian: fresh v3 comparison results

October 12, 2026. **The approved comparison completed, but the pipeline released no questions.** The simpler writer produced cards; the writer required to provide evidence inventories exhausted its output allowance. Source-check replies then failed the response contract. This run identifies implementation and measurement failures; it does not establish which instructions produce more reliable trivia or a lower cost per usable question.

The [runner](FRESH-DISPATCH.md) merged in [#1783](https://github.com/joshpalay/Joshing-11/pull/1783) at `95d17e0a`. The owner explicitly approved the private Anthropic transfer and frozen $4-capped comparison here. All 67 known requests passed free token preflight before inference. Another 34 output-dependent requests were counted before their calls. No prompt, source packet, selection, gold, model setting or limit changed after outputs.

## Frozen results

Both arms used Haiku 5.5, identical curated sources and screened relationships, alternating order, and the same whole-card Sonnet source reviewer. Soft writing omitted evidence inventories; strict writing required them. This was an instruction comparison, not a Haiku-versus-Sonnet writer comparison. Reviewers received opaque IDs; source reconstruction excluded writer inventories, and quality checking excluded explanations.

| Measure | Soft evidence instructions | Strict evidence instructions |
| --- | ---: | ---: |
| Original selected requests | 23 | 23 |
| Preparation scope shortage; no writer call | 1 | 1 |
| Initial writer calls | 22 | 22 |
| Initial final candidate JSON | 22 | 0 |
| Initial nonfinal writers | 0 | 22 |
| Predeclared repair/replacement calls | 2 | 2 |
| Final candidate JSON from repairs | 2 | 0 |
| Initial source checks | 22, all protocol review | None; no final cards |
| Initial quality results | 14 pass, 1 hold, 7 protocol review | None; no final cards |
| Repaired source/quality results | 2 source protocol reviews; 2 quality passes | None; no final cards |
| Requests passing complete machine pipeline | 0 / 23 | 0 / 23 |
| Independently usable / author-provisional deliverable cards | 0 / 0 | 0 / 0 |

All 24 strict writer attempts ended with `max_tokens`, using the full 2,300 output-token allowance and returning no extracted final text. The receipts do not establish the contents of any unretained thinking blocks. This configuration could not complete the strict task; it is not evidence that the model can never supply an inventory. Initial writer calls averaged 3.90 s soft versus 10.23 s strict, costing $0.013651 versus $0.030679 in total. Those are provider-call durations and writing costs, not topic-to-ready latency or all-in unit costs.

All 43 source replies ended normally but became `review` with `malformed_output` under the frozen contract. A separate diagnostic audit found overlapping problems: 16 replies were not JSON-only, 31 had schema defects, 40 had incorrect source locators, and four lacked required material claim targets. Examples include absent `span.text`, an object instead of the required answer array, field offsets measured over concatenated card text, and real quotations at incorrect character positions. None was silently repaired into a pass.

The four repairs followed the frozen hash policy: two per arm, using unchanged packets and only their own feedback. One soft replacement changed its asked relationship; the other retained the same relationship with clearer wording. Both remained source protocol reviews. Original attempts and every charge remain counted; a repaired request is not two new usable questions.

## Controls and reason audit

The full nineteen-case control denominator and gold remain frozen, including wording-sensitive cases.

| Frozen control measure | Result |
| --- | ---: |
| Sound cards retained by both checks | 0 / 8 |
| Sound cards passing quality alone | 7 / 8 |
| Challenge cards passing both checks unsafely | 0 / 8 |
| Quality decisions matching gold, including protocol failures | 14 / 19 |
| Source decisions matching gold | 2 / 19, both for the wrong mechanical reason |
| Source decisions with required correct reason categories | 0 / 19 |
| Saved regressions fully resolved | 0 / 3 |

Every source reply was blocked, so zero unsafe passes is **not** successful checker validation. The two expected source reviews became reviews because of malformed output rather than the required missing-evidence reasons. Quality returned fourteen passes, one hold and four protocol reviews. It noticed the actual giveaway, but incorrect offsets invalidated that hold.

The same prompt-author Codex agent separately read all cards, replies, source relationships, answer variants and reasons. That audit does not change machine scores or manufacture independent review:

- Several source explanations correctly noticed planted contradictions, missing chronology and an incorrect answer type, but failed to express valid proof records. One explicit full-name variant was instead deferred as unknown policy. A known formation formulation was still endorsed under the frozen precise-formation gold; historical-continuity wording remains a separate sensitivity, not an exclusion that improves the headline score.
- Two sound surname variants were deferred because operational acceptance policy was not supplied to the reviewer; a third surname was accepted. Private gold contains a policy that the model cannot see. That measurement gap must be repaired before treating all such disagreements as model factual errors.
- Quality reasons sometimes take over variant acceptance despite the prompt assigning it elsewhere. Generated-card reasons also include an overbroad definition-as-giveaway claim, confusion between a role and a seat, plausible presentation concerns about unseen article references, and subjective tier/wording disputes. An actual question quotation does not make its reasoning sound.
- A generated question adds joint creation of a guide where its source establishes popularization in that guide. This is **missing evidence**, not a demonstrated contradiction. Another core ask leaves the pre-screened relationships despite being supported elsewhere in the supplied excerpt. Source support, task compliance and novelty are separate checks.
- Expanded bank/history screening includes existing explanations and variants. It found an explanation-level thematic overlap needing adjudication over whether an added date makes the new question materially distinct. Original preparation labels remain preserved. Other shared entities/background details do not automatically establish repeat facts. Narrow-topic specialist difficulty also remains a concern.

There is no independently assigned adjudicator. Author review supplies development findings, not independently verified yield or a release decision. All 46 original arm/request outcomes remain visible: one preparation shortage and 22 unresolved requests per arm. No experimental question was served, imported or promoted.

## Coverage and full creation accounting

The intended frame had 24 requests; the missing broad/depleted specialist cell stayed empty. The actual 23 contain seven broad, eight niche and eight very narrow interests. Role labels retain both underlying source-cold/depleted bits; they are controlled probe assignments, not measured live readiness.

| Breadth / assigned role | Requests by tier: accessible / moderate / specialist | Soft initial cards | Strict initial cards | Complete passes, either arm |
| --- | --- | ---: | ---: | ---: |
| Broad / cold | 1 / 2 / 1 | 4 | 0 | 0 |
| Broad / depleted | 1 / 2 / 0; one frame deficit | 3 | 0 | 0 |
| Niche / cold | 1 / 2 / 1 | 4 | 0 | 0 |
| Niche / depleted | 1 / 2 / 1; accessible scope shortage | 3 | 0 | 0 |
| Very narrow / cold | 1 / 2 / 1 | 4 | 0 | 0 |
| Very narrow / depleted | 1 / 2 / 1 | 4 | 0 | 0 |

| Cost category | Calls | Estimated response USD |
| --- | ---: | ---: |
| Writing, including four repairs | 48 | $0.048272 |
| Source review, generated cards and controls | 43 | $0.853644 |
| Quality checks, generated cards and controls | 10 | $0.062074 |
| Total inference | 101 | $0.963990 |
| Free token-count requests | 101 | $0 |

Operational arm costs include all writing, source/quality checks and repairs: **soft $0.541000, strict $0.033481**. Control checks cost **$0.389508**, kept separate and included once in total experiment spending. Strict costs less operationally because it fails before checking; that is not a unit-cost saving. Shared preparation is split equally for the paired comparison, and each quality batch's actual cost is allocated equally across its members.

The source-preparation record retains 38 HTTP attempts, including thirteen rate-limit failures, with no Anthropic retrieval charge. Evidence preparation, control preparation and adjudication labor remain unknown, not free. Source material was manually curated before writing. **Cost per new usable question is unavailable because usable yield is zero.** Cached sources, call timings and zero model-retrieval charges do not measure automatic retrieval, production labor, or cold/depleted topic-to-ready performance.

Receipts sum to **$0.9639895**; six-decimal per-call ledger settlement is **$0.963987**, with zero new reservation. Lifetime settled spending is **$5.201188**, the old uncertain **$0.02** is unchanged, and **$4.778812** remains after reservations. Prices are estimates, not invoice reconciliation. A completed resume added **zero paid calls and zero token counts**. All older ledger rows are unchanged.

## Offline next step

An isolated [quote locator](../scripts/cassian-quote-locator.ts) now computes actual UTF-16 positions from quoted text in one identified field/source. It permits the existing whitespace/NFC/quote-mark normalization, preserves actors/dates/negation/case, and leaves absent or repeated matches unresolved. It is not connected to the paid runner or production, and it never repairs frozen replies or judges entailment.

On the saved replies, a separate offline replay found unique locations for **268/270 source-reference occurrences** and **13/13 quality evidence quotes**. The two ambiguous references were repeated speaker headings, correctly left unresolved; they need a larger identifying passage. These include repeated references to the same quotation, not 270 independent cases. A unique location does not cure schema defects, omitted claims, wrong acceptance policy or unsound reasons.

**67 tests across seven files, TypeScript and affected lint pass.** Eight new locator tests cover actual offsets, repeated/overlapping matches, typography/whitespace, Unicode mapping, substantive mutations and the distinction between location and support. The 59 existing study tests remain green.

Next integrate quoted-text locators into a **new offline contract**, provide an exact response schema and operational variant policy, and verify the saved failures before freezing any new paid design. A small format/output-budget compatibility probe should precede another multi-topic comparison. Independent adjudication and complete production retrieval/preparation/readiness measurement still follow; production writer/gates remain unchanged.

Private provenance: final design SHA `91e33d198eb96d059d6aa24c2bbca50c9e1dcd9b20e809f7d67c0fd5ac4744e5`; ledger id `cassian-fresh-v3-2026-10-12-final`. Original machine-score SHA `1da83df03587db6045b3fb45fbf39a968c36d3677c6210c0bed0bd99d884c53d`. Exact requests, receipts, checkpoints, gold, audits, accounting and archives stay under ignored `_scratch/Cassian/`. A separate scoring adapter addendum maps quality protocol review to the scorer's invalid enum; numeric totals are unchanged. All original machine assessments and earlier scores remain intact. The executed archive preserves 235 artifacts, and 179 earlier archived/unchanged artifacts were verified before status updates.
