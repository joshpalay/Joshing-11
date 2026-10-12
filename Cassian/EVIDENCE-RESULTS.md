# Cassian: captured-evidence writing results

October 11, 2026. The owner approved the [frozen test](EVIDENCE-TRIAL.md) with “Do it.” All fourteen Anthropic calls completed normally for **$0.1270136 in response costs**, settled at **$0.127014** in the ledger, below the 75¢ ceiling. The preparation merged in [#1777](https://github.com/joshpalay/Joshing-11/pull/1777). **No production writer/checker change or live trial is recommended yet.**

The evidence requirement helped focus the strict writer's answers, but its proof records failed the frozen mechanical rules. The source checker also continued to waive missing evidence and approved an explanation previously marked for correction. Neither arm produced a card accepted by the experimental pipeline. This is a development test of instructions and evidence handling, not a new model comparison or a complete serving test.

## What ran

Both arms used Haiku 5.5 on the same three fact targets and captured source bytes. Six writer calls compared soft grounding with mandatory fact/claim/evidence records. Six Sonnet 5.5 calls reviewed nine fixed controls for quality and source support; two more reviewed all six generated cards. Reviewers received anonymous IDs without writer identity, arm or expected labels. Quality review excluded explanations and sources; factual review included question, answer and explanation, but **excluded answer variants** and writer claim inventories.

All calls ended normally with valid final JSON. There were no retries, shortages or invalid writer outputs. All attempts remain in the denominator. The same Codex agent prepared sources/control labels and audited every reply; this is not independent human review. Six controls were newly authored development cases, not an independently selected holdout. Source packets were cached, facts may already have been exposed, and serving novelty was not checked.

## Frozen writer results

| Measure | Soft instruction | Strict instruction |
| --- | ---: | ---: |
| Attempts / parsed cards | 3 / 3 | 3 / 3 |
| Quality passes | 3 | 3 |
| Source passes / unresolved reviews | 0 / 3 | 3 / 0 |
| Mechanical proof-record holds | 0 | 3 |
| Experimental approvals | **0** | **0** |
| Writer cost | $0.0060180 | $0.0073976 |
| Allocated generated-card review cost | $0.0205030 | $0.0205030 |
| Attributed writing + review cost | $0.0265210 | $0.0279006 |
| Mean writer response time | 4.803 s | 7.982 s |

The three soft cards remained unresolved for an unsupported current-popularity assertion, a malformed exact quotation, and missing acronym expansions with inconsistent treatment across fields. Missing evidence does not establish that the corresponding claim is false.

All three strict records failed `unmapped_card_text`. The implementation requires claim quotations collectively to cover every letter/number in the card, including ordinary question wording and connective text. This is stricter than mapping material factual assertions. Some omitted spans are cosmetic; one strict explanation also contains an unsupported chronological inference that the source checker accepted. Thus neither the mechanical holds nor the three source approvals can be treated as a direct count of factual errors or fully verified cards. Frozen scores and rules have not been relaxed after seeing results.

The strict writer cost about 23% more and took about 66% longer on these three selected targets. Both arms have zero approvals, so cost per approved question is undefined. These small cached-source results cannot establish production yield, full-path latency or monthly savings.

## Checker results and reason audit

Quality decisions matched all **9/9** frozen control labels, with sound visibility reasons: eight passes and one literal-answer-disclosure hold. All six generated quality passes were sound under that rubric. This does not test source truth or answer-variant acceptance.

Factual decisions matched **7/9** frozen control labels. One supported positive card remained unresolved because its quotation dropped presentation line numbers. One known explanation marked Revise still passed despite a supplied formation clause supporting the correction. That latter case concerns precision of the formation relationship, not a wrong answer to the original question. Excluding this wording-sensitive control yields **7/8** agreement; neither unambiguous new contradiction passed. This sensitivity does not erase the missed correction or the other coverage waivers.

The six newly authored controls alone matched 6/6 factual labels, but one positive label itself was generous to an acronym-only packet. The checker waived missing expanded names and section identity elsewhere as well. Preserve those original labels and disclose the limitation instead of presenting the result as perfect source verification.

Across fifteen factual cards, two exact-quote checks failed because displayed line numbers interrupted otherwise present words. Those citations were correctly withheld by software, but the underlying content was not shown false. Separately, one generated strict source pass accepted chronology inferred from a more concise formulation rather than an explicit sequence. Exact quotation membership cannot prove that a claim follows from the quoted text.

Every writer card, control assessment and generated assessment was read against the frozen inputs. The private agent audit distinguishes contradiction, absent support, citation formatting, claim-record failure and policy/wording sensitivity. No owner rating, old label or historical trial score was changed.

## Cost and recovery

| Cost | Actual response total |
| --- | ---: |
| Six writers | $0.0134156 |
| Six control reviews (development overhead) | $0.0725920 |
| Two generated-card reviews | $0.0410060 |
| All fourteen calls | **$0.1270136** |

Mixed generated review costs are allocated equally by reviewed-card count: three of six cards per arm. Control costs remain separate development overhead. Captures/retrieval, replacements, appeal ratings and novelty checks are absent from this total. Amounts are token-price estimates, not reconciled Anthropic invoices.

Both completed resumes made **zero new calls** and no additional charges. Fourteen ledger receipts match saved responses within settlement rounding; both new runs have zero reservations. The older halted call remains uncertain with its **2¢ reservation unchanged**, and was neither retried nor released. Lifetime ledger: **$4.237201 spent, $0.020000 reserved, $5.742799 available** within the $10 cap.

Private manifests, source captures, requests, responses, labels, scores, per-item audit and settlement/resume proof remain ignored under `_scratch/Cassian/`. The initial manifest SHA is `7d16f6af34702b1ecf9f677e2ff136d77fa3265dda7ce2039f62da556920831b`; the generated-review manifest SHA is `bbcdc15ae46705a4c8cec88fbc49f28679678b5d301ffe5216385f1591ff9b44`. Saved score SHA is `57bd092fca16c62063981b20fa8723337a7591db37c2668aafbb1a67e8f75979`. Preparation had 53 focused tests plus TypeScript/lint passing; this follow-up changes documentation only. No candidate, bank or gameplay writes occurred.

## Next work recorded at completion

Before another paid test, make free evidence/protocol repairs: supply explicit source section/edition identity and acronym definitions; deterministically normalize presentation line-number noise while retaining raw hashes and locators; map material assertions without requiring every question word to be evidence; and include variant specificity and answer-language checks. Test formation wording separately from unambiguous contradictions. Keep source, quality and novelty requirements, and retain this run unchanged as the baseline.

After those repairs, freeze a separate evaluation before any new calls. Independent examples/review and full-path cost, novelty and latency evidence remain necessary before a live trial. No more owner answers are needed for this completed batch. See [next steps](NEXT-STEPS.md).

**October 12 follow-up:** [separate adjudication](EVIDENCE-ADJUDICATION.md) and [v3 offline repairs](EVIDENCE-V3.md) complete, with this result and its scores unchanged. The [fresh evaluation protocol](EVIDENCE-EVALUATION-PLAN.md) now includes breadth/history selection and complete-task/labor measurement; concrete new inputs and dispatch remain unprepared. No additional paid calls.
