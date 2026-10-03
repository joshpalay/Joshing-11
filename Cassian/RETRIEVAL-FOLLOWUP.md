# Cassian follow-up candidate: reference reuse and topic readiness

Read-only snapshot on 2026-10-03 using `npx tsx scripts/cassian-reference-audit.ts`, with a `BEGIN READ ONLY` transaction. Production `domain-reference.ts` currently treats `DomainReferencePassage` rows as fresh for 24 hours. This document proposes a separate measured follow-up; the TTL is unchanged in PR #1745.

| Aggregate | Observed |
| --- | ---: |
| Distinct active declared-interest topics | 111 |
| Topics with no cache row | 93 |
| Cached rows fresh under 24 hours | 0 |
| Cached rows aged 1–7 days | 3 |
| Cached rows aged 7–14 days | 0 |
| Cached rows older than 14 days | 15 |
| Domain-reference LLM calls in rolling 30 days | 25 |
| Web searches in those calls | 53 |
| Call duration p50 / p95 | 11,731 / 17,553 ms |

The first Cassian pilot spent $1.319228 of $1.900008 on source retrieval (~69%), versus $0.256178 on both writer arms together. That establishes retrieval as the larger **pilot** cost and latency component. It does not prove a longer production TTL would save the same fraction: 93 of 111 active topics have never had a cache row, and the latest-row-only cache table cannot show how often a particular topic was re-fetched. `LlmUsageEvent` records call scope and build ID but no topic. The current snapshot cannot reconstruct cache hits, repeat fetches by topic, or whether a reused passage would narrow fact variety.

Before changing the TTL, record cache hit/miss, age and topic-key counts without exporting user interests; identify how many retrieval calls are repeat fetches within 7 and 14 days. Match that with per-topic unique fact keys, duplicate/held-gate rates, and topic-selection-to-first-eligible-question-ready latency. Separate first-ever topic retrieval from repeat retrieval and normal Daily Five builds from the isolated pilot. Keep the writer model, quality/factual gates and difficulty rule fixed during this measurement.

If repeat fetches are material, run a bounded paired comparison on a small set of eligible topics: reuse the prior passage in one arm, fetch a fresh passage in the other, and compare eligible novel questions, source accuracy, variety and readiness time. Reserve the worst-case paid cost in `CassianRun` before dispatch. Stop if quality or narrow-topic coverage degrades; do not relax the novelty or factual gates to make reuse appear cheaper. Human ratings from the first pilot should be collected before choosing the paid follow-up. A 7–14 day TTL is a candidate only after this evidence, not an automatic next change.