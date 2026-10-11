# Owner review complete: focus next on gate reliability

Checked October 11, 2026. All ten imported second-block cards have saved answers, overall ratings and post-gate judgments. Eight were rated Good and two Fix. Six were marked Keep and four Revise in the separate disposition field; an appeal rating of Good does not certify an unchanged explanation. Together with the first block, all 22 available comparison cards are answered and rated. No further owner ratings are needed for these blocks.

| Saved appeal ratings across both blocks | Sonnet 5.5 | Haiku 5.5 |
| --- | ---: | ---: |
| Cards shown and rated | 10 | 12 |
| Good / Fix / Reject | 4 / 5 / 1 | 10 / 2 / 0 |
| Original generated attempts | 12 | 12 |
| Offline writer + gate cost, all attempts | $0.329643 | $0.136708 |

Two second-block Sonnet attempts were withheld for history/semantic overlap after generation. Owner rates therefore describe a selected sample with four complete pairs in this block, not an unbiased six-pair comparison. Across both blocks there are ten complete owner pairs and two unpaired cards. All 24 original generated attempts and costs remain in the analysis.

The provisional pre-review source audit and owner Good overlapped on four Sonnet and five Haiku originals. Post-review corroboration identified one additional explanation wording error in a previously kept Haiku card, reducing that conservative unchanged-card overlap to four per arm. Three per arm also passed the machine gates. The private reconciliation preserves both the earlier audit and the later correction. These tiny counts, cached references and selected owner sample do not support a production writer switch or shared-bank promotion.

The owner's highlighted gate failures are two false quality holds, an appropriate hold with an invented answer-leak reason, and an earlier explanation-related false pass. One earlier card number does not align with saved chronological order; its exact mapping is pending clarification. The independently recorded earlier explanation failure remains valid regardless of that numbering. Do not infer a gate error rate by adding an earlier-block incident to the ten-card current denominator, or by counting a wrong reason as a wrong binary decision.

Request inspection disproves the proposed explanation-wiring mechanism: both Cassian and production quality requests contain question, answer, tier and fact metadata, **without the explanation**. Only the factual gate receives the explanation. The quality gate claimed the stem contained words that were absent. Answer/metadata or model-knowledge contamination is a plausible inference; the mechanism has not been isolated experimentally. Separately, the factual gate missed or waived real card defects. The app's combined pass/hold status obscures this distinction unless reasons are examined.

The second block contains four same-topic writer pairs and two unpaired cards. The actual serving order mixed topics except for one consecutive pair. Allocation uses a deterministic hash shuffle, without a topic-spacing constraint. Paired topics were intended comparison targets, not repeated facts. Future serving should separate same-topic cards where possible while preserving blind review and existing novelty checks.

Seven private development regression cases now cover non-leaking quotation/context questions, invented stem leakage, genuine disclosure, a false attribution and a missed explanation attribution. No model calls were made to prepare them. These cases were derived from known feedback and cannot serve as an unseen holdout.

**Next:** a bounded offline gate replay, scoring pass/hold and reason correctness separately. Compare the current quality prompt with a candidate that requires evidence from the player-visible stem, distinguishes contextual clues from answer disclosure and preserves valid quote completion. Test explanation correctness separately at the factual gate, with clean controls so improvements do not create new false holds or unsafe passes. Keep prompts and writer switches in production unchanged until this evaluation is reviewed. Prepare a fresh holdout after development; more writer cards are not the immediate priority.

Ledger after owner answer grading: **$2.977631 spent, $0 reserved, $7.022369 remaining** of the authorized $10. The second block is $0.239734 including $0.000232 later grading; its original generation cost remains $0.239502. This reconciliation added no paid calls or database writes. Exact candidates, chronological mappings, corrections, source links and regression inputs remain ignored under the run's private directory.
