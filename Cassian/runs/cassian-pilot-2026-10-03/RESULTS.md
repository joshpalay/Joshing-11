# Cassian pilot — machine screen, awaiting owner ratings

On 2026-10-03 the first balanced 12-topic comparison requested one question per topic from each writer. All 24 responses parsed. Both writers received the same retrieved reference packet and topic/difficulty prompt per topic. The run used Sonnet 5.5 as the recent production writer and Haiku 4.5 as the candidate; quality checks used Haiku 4.5 and factual checks used Sonnet 5.5 for both arms.

| Measure | Sonnet 5.5 | Haiku 4.5 |
| --- | ---: | ---: |
| Requested and parsed | 12 | 12 |
| Passed implemented core gates | 6 | 4 |
| Held by core gates | 6 | 8 |
| Writer call cost | $0.205566 | $0.050612 |
| Mean writer call duration | 3,539 ms | 3,097 ms |
| Human reviewed | 0 | 0 |

The database budget ledger recorded **$1.900008** total and **$0 reserved** across 84 calls: 12 source, 24 writer, 24 quality and 24 factual. The sum of response-level estimates differs by about $0.000005 because the ledger stores six decimal places per call. Source retrieval accounts for about $1.319; writer calls for about $0.256; gates for about $0.325. All 12 retrieval calls returned a passage. No candidate was inserted into the shared bank or shown to a player.

These counts do **not** identify a quality winner. The run has no human accuracy/interest ratings or same-fact exposure review. Its standalone core screen uses the current parser, quality/factual prompts and deterministic leak/shape/difficulty checks, but it has not replayed every production history/embedding/ask-to-answer check. Its writer timing measures model calls with a shared source packet; the owner's topic-selection-to-first-ready latency remains unmeasured. The raw question text and provider replies stay in ignored `_scratch/Cassian/cassian-pilot-2026-10-03/` for authorized import into the admin review table.

Next: import immutable candidate snapshots, enforce production/Cassian shown history before revealing text, collect owner ratings across all dimensions, and inspect held examples for false gate rejections. Spend remaining under the existing $10 total cap: **$8.099992** before any answer grading or further calls, subject to reconciliation with provider billing.
