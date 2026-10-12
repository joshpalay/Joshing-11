# Cassian source coverage: free audit

October 11, 2026, after [#1775](https://github.com/joshpalay/Joshing-11/pull/1775) merged at `6de1554cc06c17850fb3cbb82658da4cde5cd9c6`. The saved-artifact audit is complete. **The evidence supplied to the writer/checker is the next bottleneck.** A stricter checker cannot certify facts absent from its packet, and agreement with a model-written summary is not independent verification of that summary.

## What was inspected

All 24 saved questions, answers and explanations, their twelve reference packets, original preparation/retrieval code and targeted-review provenance were read. Both novelty exclusions remain excluded. The 22 eligible cards have 66 field-level claim groups. The audit records material assertions, exact supporting summary substrings, missing support and incompatible wording separately. It makes no new web/model request or database read/write, and does not revise frozen gold labels or scores.

| Strict saved-packet coverage, eligible cards | Count |
| --- | ---: |
| Requested answer relation supported by summary | 6 of 22 |
| Requested answer relation missing/incomplete | 16 of 22 |
| Whole card covered by summary | 1 of 22 |
| Fields covered by summary | 9 of 66 |
| Fields missing some material support | 56 of 66 |
| Field with incompatible formation wording | 1 of 66 |
| Packets with captured, verified underlying-page quotations | 0 of 12 |

These are conservative coverage judgments by the same Codex agent over selected development cases, not independent review, new correctness rates or evidence that 21 cards are false. The last row describes these saved packets, not every primary source used in earlier separate fact audits. Partial facts and inferred ordered-list correspondences are retained as partial support, not erased. The strict audit does not waive nationality, role, descriptive attributes or explanation claims because they are familiar. It therefore differs from the reviewer API's earlier 15 supported / 51 unknown assessments; the original trial numbers remain unchanged.

## How the gap arose

The [retrieval prompt](../src/server/daily/domain-reference.ts) tells the model to **write the passage itself** after web search. The first block retained six such model-response passages. The second block copied six cached production references; their original page bodies/retrieval responses are absent from this artifact set. A source URL and text labeled `wikipedia`/`fandom` identify provenance intent, not an exact quotation captured from that page. Treat these derived references as unverified leads.

The [writer reference instruction](../src/server/daily/generate-questions.ts) is explicitly a soft preference: prefer passage facts, but allow facts outside the passage if the model believes it knows the work. The [comparison runner](../scripts/cassian-compare.ts) used that instruction unchanged. Broad summaries can therefore lead to detailed scenes, identities and explanatory claims with no stored evidence supporting them. This audit identifies a permitted escape from evidence; it does not establish which internal model mechanism produced each sentence.

The reference parser also caps text at 1,200 characters. All six first-block raw passages exceeded that cap; the targeted-review preparation supplied their longer raw passages to the factual reviewer, while historical writing used the capped reference. This affects twelve first-block items. The six second-block cached packets were already capped; five end mid-sentence or mid-word. The writer/reviewer packet difference is an addendum to the earlier description of reused source material, not a rerun or post hoc change to its labels. A future experiment must freeze the exact source bytes actually supplied to each role and disclose any intentional difference.

Known failures illustrate three distinct problems: absent requested facts, extra unsupported explanation claims, and a reviewer approving wording incompatible with its own cited formation passage. Some derived text also repeats a claim already disputed in prior review. Citation membership protects against invented quotations; it cannot establish source truth, complete coverage or entailment.

## Completed output and next action

The [offline evidence contract](EVIDENCE-CONTRACT.md) is ready for review. It requires captured page evidence, reviewed fact relationships and explicit coverage of the complete card. The draft writer instruction forbids filling gaps from memory and permits a truthful shortage result. Independent quality, novelty and factual assessment still apply; evidence coverage is only one requirement.

After the saved-artifact audit, a separate free capture step prepared **seven public-page artifacts, six reviewed facts and three development prototypes**. Exact HTML bytes, deterministic text extraction, URLs, capture times, source locators and hashes are retained. Six pages supply the packet's evidence; one related language page remains a captured lead rather than claim support. Two prototypes are agent-authored draft repairs; the third preserves a known bad original explanation as a negative control. The drafts were authored by this agent; no writer/checker API test has run, and all are previously exposed facts unsuitable for new bank stock.

The supporting pages are [Vitsœ's English design principles](https://www.vitsoe.com/us/about/good-design), [its German Rams biography](https://www.vitsoe.com/de/about/dieter-rams), [Folger's Act 4, scene 7](https://www.folger.edu/explore/shakespeares-works/hamlet/read/4/7/), [Act 5, scene 2](https://www.folger.edu/explore/shakespeares-works/hamlet/read/5/2/), and the NBA's [franchise timeline](https://www.nba.com/kings/history-franchise-timeline) and [original-player article](https://www.nba.com/knicks/last-original). The relevant NBA articles live in embedded page payloads; the extraction records their exact paths rather than treating a 200 response or empty shell as sufficient evidence.

Next independently reconstruct/review prototype claims, add genuinely unseen controls and freeze a new writer/pipeline comparison with a budget, all-attempt/replacement/retrieval costs, topic coverage and cold ready time. Current prototype claim spans cover whole fields; a complete independent atomic claim inventory and question-quality review remain pending. These development packets do not establish blind accuracy or operating economics. No new paid run/request fingerprints are prepared or dispatched here, and no live writer/checker instruction has changed.

Private audit: `_scratch/Cassian/cassian-source-coverage-2026-10-11/private/CLAIM-AUDIT.json`, with a local reproduction script and file hashes in `PROVENANCE.json`. The audit's input manifest remains SHA-256 `1ee7dd22df2d79964e06be684fa19acd5016e6cc18b4bb77fce466b9cae03690`. New prototype: `private/DEVELOPMENT-PACKET-v2.json`, SHA-256 `8a271131ac3e35254646146e940f9e6e076a498f28a1d91a0a355f8fbc00173a`; seven captures are under `private/pages/`. Exact questions, claim groups, URLs and supporting text remain ignored. Incremental model cost **$0**. Last verified ledger: $4.110187 spent, $0.02 retained uncertainty and $5.869813 available; this work did not query or modify it.
