# Cassian: separate evidence adjudication

October 12, 2026, after [#1778](https://github.com/joshpalay/Joshing-11/pull/1778) merged. The fourteen-call trial is complete. This adds a separate interpretation of its six generated cards and nine controls; **the frozen scores, original labels, requests and responses remain unchanged**. The author is the same preparing Codex agent, not an independent reviewer. Full per-card findings and source spans remain private.

| Finding | Saved cases | Meaning |
| --- | ---: | --- |
| Factual error | 2 unambiguous controls + 1 wording-sensitive control | Wrong speaker, wrong formation participant, and the previously marked formation relationship. The latter retains the original Revise label and exclusion sensitivity. |
| Missing evidence | 7 cards/controls | Unsupported popularity/chronology, unprovided expansions or section identity. Absence does not mean false. Capture identity can repair some packet omissions; a chronological inference still needs actual evidence. |
| Bad quotation | 2 | Display line numbers interrupt otherwise present words. Old strict quote checks correctly withheld these citations. |
| Incomplete claim record | 3 generated cards | Partial span anchors triggered the old full-character rule. One also omitted substantive chronology/origin claims; the others are not demonstrated wrong answers. |
| Policy disagreement or unresolved acceptance | 2 | Specificity of container-only variants and loose historical formation wording. Keep these distinct from unambiguous contradiction. |
| Incorrect answer variant under the new explicit-language policy | 2, conditional | An English rendering does not answer an explicit request for a German phrase. This is a v3 acceptance-policy finding, not a retroactive change to v2 scores or gold. |
| Separate quality defect | 1 control | Literal answer disclosure; its factual claims are supported. |

Counts are nonexclusive and count cards/controls, not individual claims. No generated canonical answer was established false by this adjudication; this does not certify the whole cards. Some variants remain unresolved. Original factual control agreement stays **7/9**, or **7/8** excluding the wording-sensitive formation case. Original experimental approvals stay **0/3 in both arms**. There is no new model result here.

The new [offline contract revision](EVIDENCE-V3.md) preserves chronology, attribution and formation as mandatory regressions. A free replay reconstructs those relationships with readable source spans and the separately assigned judgments: chronology remains review-required for missing evidence; attribution and formation retain holds. These are hand-authored development reconstructions, not fresh provider decisions. Both malformed old citations resolve to recorded readable spans without changing their historical outcomes.

Saved proof verifies the six original mechanical outcomes again with the original assessor/context, plus unchanged hashes of both checkpoints, manifests, frozen scores and reason audit. The new adjudication, adapted records, source-offset maps, citation repairs and regression reconstructions are separate ignored artifacts under `_scratch/Cassian/cassian-evidence-v3-2026-10-12/private/`.

No API or database call occurred. Last verified ledger remains **$4.237201 spent, $0.02 old uncertainty reserved, $5.742799 available**. Preparation/adjudication labor was not retrospectively timed and is **unknown, not free**; replay compute time excludes that work. The [next evaluation plan](EVIDENCE-EVALUATION-PLAN.md) requires prospective labor and complete-task accounting.
