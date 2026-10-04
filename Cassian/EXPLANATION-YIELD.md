# Cassian: explanation removal and usable-question yield

Updated 2026-10-04. This is an admin-only experiment follow-up. The ordinary game, its explanations, its gates, and its no-repeat rules are unchanged.

## Why measure yield

Removing an explanation can save more than its output tokens. A correct question and key can be rejected because the explanation adds a false side claim. If another question must be generated to fill the slot, the relevant saving may include another writer call, checks, and possibly source retrieval. A fixed-size screen alone cannot measure that replacement cost because it does not fill rejected slots.

Count three mechanisms separately:

1. **Direct call saving:** shorter writer output and a shorter factual-gate input/output, holding the source packet and question/key constant.
2. **Gate-yield saving:** a sound question/key becomes eligible after an explanation-only rejection disappears. A new machine pass is *not* automatically a sound question.
3. **Replacement saving:** fewer additional generation rounds and source fetches are needed to deliver the same number of independently accepted, novel questions. Record the topic-to-first-usable-question time as well.

## Completed saved-question replay

`scripts/cassian-explanation-replay.ts` rechecked the original 24 immutable question/key snapshots with the same Sonnet 5.5 factual-gate model. It removed the explanation from the gate input and the explanation-specific rule from the gate prompt. The source packets, questions, answers, writer outputs, quality-gate results, and deterministic checks were not regenerated. Raw replies and candidate identities remain in ignored `_scratch/Cassian/cassian-pilot-2026-10-03/no-explanation-replay.json`. The existing `CassianRun` ledger capped every paid replay call; its first request was rejected with a provider 400 before inference, reconciled at $0, and retried under a distinct ledger key after using the application's model-parameter sanitizer.

| Measure | Original pilot | No-explanation gate replay |
| --- | ---: | ---: |
| Saved candidates checked | 24 | 24 |
| Automatic core-gate eligible | 10 | 13 |
| Factual-gate drops | 7 | 5 |
| Factual-gate cost | $0.197073 | $0.151923 |
| Invalid gate verdicts | 0 | 0 |

The replay cost **$0.151923** of additional Cassian budget. Its factual-gate calls cost $0.045150 less than the original factual-gate calls, but this is a paired prompt replay, not an isolated token-price calculation: model reply length and decisions changed too. Writer-output saving and replacement saving were **not** measured by this replay. The complete experiment ledger was $2.057908 spent and $0 reserved after replay and twelve answer-grading calls, leaving $7.942092 under the $10 lifetime cap. These are internal list-price estimates, not provider invoices.

Independent source review of the **three newly machine-eligible** snapshots found:

- **One genuine explanation-only recovery:** the question/key were sound; the original explanation asserted a false biographical detail.
- **One original gate false rejection:** the question/key and original explanation were sound, but the original gate incorrectly objected to the explanation. This shows gate variability or fallibility, not a factual benefit from removing explanations.
- **One unsafe new pass:** the question's setup still mixes two different scenes. The no-explanation gate missed that error.

Thus **3/24 machine recoveries is not a usable-question gain of 3/24**. In this small, retrospectively audited set, one recovery clearly came from eliminating an erroneous explanation. The same replay also shows why the factual gate must continue to check the question and key. Do not project this single case into a monthly saving.

Illustration only: if all 13 new machine passes were sound, the original $1.900013 pilot cost divided by 10 passes ($0.1900) would change to a counterfactual ~$1.854863 divided by 13 ($0.1427). That **overstates usable yield** because one recovered item is invalid and because no answer-only writer or replacement round ran. Do not use that figure as a result or monthly forecast.

## Completed answer-only creation measurement

The bounded follow-up in [ANSWER-ONLY-CREATION.md](ANSWER-ONLY-CREATION.md) generated new questions with and without explanations from three frozen source packets. Both arms produced one independently usable question after their allowed replacement rounds; neither met two of three topic targets. Answer-only saved about half a cent per attempt in this tiny sample but made one extra attempt, so it cost more for the same usable-question count. No control candidate failed because of its explanation. The production explanation remains unchanged.

## Protocol for any larger prospective measurement

Before any ordinary-game change, a larger, fixed-topic **admin-only answer-only creation arm** would need to reproduce the completed pilot's source/quality controls on a new sample. Freeze the writer model, topic brief, difficulty, source packet, novelty exclusions, and quality/factual checks across arms. The control writes the current question/key/explanation; the treatment writes question/key without an explanation. Keep the factual gate's question/key checks in both. Do not simply strip an explanation from an already-written response and call that a generation comparison. Use an answer-only parser for the treatment; do not weaken the production parser.

For each arm, set the same target number of **usable, novel questions**, and allow the same bounded number of replacement rounds. Save every attempt, including malformed output, answer/key failure, explanation-only failure, other gate hold, duplicate, timeout, and no-result. Use the same source packet until it is genuinely unusable; record any extra source fetch separately. Stop at the pre-reserved budget limit and report any unfilled slots rather than silently changing topics or gate standards. Reviewers rate questions without seeing the arm or gate verdict; independently verify the answer, setup, and any explanation before calling an item usable. Existing Cassian exposures and production history still exclude repeats.

Report by arm: attempts, generation calls, source fetches, source cost, writer cost, gate cost, explanation-only holds, independently verified usable unique questions, rejected-but-sound questions, replacements, unfilled slots, total dollars per usable question, and request-to-first-usable latency. Report human ratings and narrow-topic coverage alongside those numbers. Attribute a saved replacement call only when the fixed usable-question target actually required one in the control and not in the treatment. Because shared retrieval dominates this pilot, show results both with shared-source allocation and incremental replacement/source cost. Never count a gate pass alone as a usable question.

The completed small creation follow-up is **not** approval to remove explanations from the ordinary game. More paid creation comparisons should be weighed against bank supply and retrieval work after the bank rollout has enough builds to measure.
