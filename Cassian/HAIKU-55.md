# Haiku 5.5 paired writer trial

Run 2026-10-08, after Haiku 5.5's release. This is a six-topic balanced offline block: two broad, two niche and two very narrow topics, each with one fresh Sonnet 5.5 and one fresh Haiku 5.5 question. The two arms used the same saved reference packet, difficulty target, prior-fact context, prompt builder, Haiku 4.5 quality gate and Sonnet 5.5 factual gate. Reusing references isolated writer cost and avoided new retrieval spend. Haiku 5.5 used low effort and a 3,000-token output ceiling to allow for its default adaptive thinking; Sonnet used the existing lowest-thinking configuration. No normal-game writer, gate, bank, or no-repeat setting changed.

The private frozen manifest, checkpoint, question-level source audit and novelty query are in ignored `_scratch/Cassian/cassian-haiku55-2026-10-08/`. The public manifest is a generic example. The durable Cassian ledger controlled each paid call; the three-topic first block settled with no reservation before expansion to six topics.

| Measure | Sonnet 5.5 | Haiku 5.5 |
| --- | ---: | ---: |
| Questions written | 6 | 6 |
| Passed both existing machine gates | 3 | 4 |
| Writer cost at current list prices | $0.097061 | $0.006879 |
| Existing gate cost | $0.062261 | $0.060648 |
| Mean writer time per question | 3.76 s | 4.69 s |
| Provisional independent keep / revise / reject | 1 / 2 / 3 | 4 / 2 / 0 |

The entire block spent **$0.226849** and left **$0 reserved**. Cassian's lifetime ledger now records **$2.736258 of $10**, leaving **$7.263742**. These are list-price estimates, not a provider invoice. The candidate's writing was about 14 times cheaper in this small block, but its measured writer time was about 0.93 seconds slower. This does not establish that the topic-to-ready experience improves: reference retrieval was reused, not timed here.

The provisional source audit checked both answers and explanations. It found one Haiku question falsely held by the quality gate. It also found an incorrect explanation in a Sonnet question that passed both gates. Machine pass counts therefore cannot stand in for usable yield. Exact text and sources remain in the private audit so the admin rating can be blind. A read-only exact text/fact-key/same-domain answer check found no matches in the existing bank or published questions, but semantic overlap across all player histories is not fully excluded.

The 12 immutable candidates were imported into **CassianCandidate only** for the existing admin-only review page; they were not put in `GeneratedQuestion`, normal Daily Five, mastery, points or the activity stream. Owner blind ratings and an authenticated feedback save/reload check are pending. One prior pilot card may also still appear in the review queue; identify this run by its Haiku 5.5 comparison label after the initial rating is saved.

**Decision:** keep the production writer unchanged. The six-topic result makes Haiku 5.5 a promising candidate, not a release decision. After owner review, compare usable novel questions per dollar, coverage by breadth and the full topic-to-ready path. Refresh the current monthly cost forecast using current model prices, then continue the bank-supply audit. Cheaper writing alone does not demonstrate the $5/month target because retrieval, gates and other scopes remain.

Price and migration references: [Anthropic Haiku 5.5 announcement](https://www.anthropic.com/claude-haiku-5-5), [Haiku 5.5 migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide), [Sonnet 5.5 announcement](https://www.anthropic.com/claude-sonnet-5-5). Haiku 5.5's updated tokenizer uses more tokens for the same text, and requests using our old sampling values require sanitization. The pricing catalog now includes Haiku 5.5's short- and long-prompt tiers and current Sonnet rates. Historical usage reports reprice rows at today's catalog rates; use provider invoices for historical bills.
