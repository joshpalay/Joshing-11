# Cassian answer-only creation trial

Completed 2026-10-04. This was an offline, admin-only learning run. It did not write candidates to the game or shared bank, change production prompts or gates, or use new source retrieval. Raw prompts, topic choices, questions, replies and source-by-source audit remain in ignored `_scratch/Cassian/explanation-creation-2026-10-04/` on the experiment workspace.

## Design

Three frozen topics covered broad, niche and very narrow interests. Each arm used the same saved reference passage, Sonnet 5.5 writer, difficulty, prior-question snapshot and existing quality gate. The control requested a question, answer and explanation; the answer-only arm requested a question and answer. The factual gate checked question and key in both arms, and also checked the explanation in the control. The answer-only parser reused the production question-shape validation with a private placeholder, then removed that placeholder before checking or saving the candidate. Production parsing was unchanged.

The target was one independently usable new question per topic per arm. Each arm could make at most two attempts per topic; an independently reviewed failure triggered one replacement. A source review checked the question and answer, and any control explanation. A machine pass alone did not count. Existing bank and original-pilot facts were excluded from the prompt and checked after generation; a human reviewed semantic overlap. The source passages came from the original pilot, so this run measured **zero new retrieval calls**; the earlier source cost is shown separately below for full-creation context.

## Observed outcome

| Measure | With explanation | Answer only |
| --- | ---: | ---: |
| Writer attempts | 5 | 6 |
| Automatic core-gate passes | 2 | 1 |
| Independently usable, novel questions | 1 | 1 |
| Topic targets still unfilled after two attempts | 2 of 3 | 2 of 3 |
| Writer cost | $0.157809 | $0.165633 |
| Quality + factual-gate cost | $0.059977 | $0.066416 |
| Incremental cost for this run | **$0.217786** | **$0.232049** |
| Cost per attempt | $0.043557 | $0.038675 |
| Mean writer elapsed time per attempt | 3.66 s | 3.04 s |

Answer-only attempts averaged $0.004882 less and 0.62 seconds faster at the writer-plus-gate and writer stages respectively, but the arm made one more attempt and cost $0.014263 more overall. Those tiny differences are not reliable speed or price estimates from five or six calls. The original source packets cost $0.236248 combined; allocating half to each arm would make full-creation costs $0.335910 and $0.350173. That allocation is illustrative, not new spend. It does not include the time to fetch sources in this trial because the sources were already saved.

The completed run cost **$0.449832** in the durable Cassian ledger, with $0 reserved. The lifetime experiment total is **$2.509409 of $10**, leaving **$7.490591**. Amounts are internal list-price estimates, not a provider invoice. The private checkpoint and ledger agree on 11 candidates and 33 paid writer/gate calls.

## What the review found

- No control question failed **because of its explanation**. This small run therefore observed no explanation-driven replacement saving. The earlier saved-question replay had found one explanation-only recovery, but that event did not recur here.
- Both arms missed two topic targets. Familiar, textbook-style facts were a larger yield problem than explanation text in this batch. One control stem included part of its answer; another effectively supplied its answer in the clue.
- The quality gate held one independently usable answer-only question because it treated any description of a named method as giving away the name. It also passed a comparably generic control question while holding other generic questions. The factual gate gave a categorical rejection to a very narrow historical answer for which credible specialist sources disagree. Another answer-only hold claimed the key appeared verbatim in a stem that did not contain it; that stem was still too generic to use. Gate reasons need auditing independently of the final keep/reject decision.
- An initial human review had applied the generic-fact rule inconsistently across arms. The audit was corrected before the allowed replacement was run. All eleven candidates now have a source-audit record. One reviewer made these judgments; the owner has not rated this new batch.

## Decision

Keep the production explanation, writer and gates unchanged. The answer-only arm saved a little per attempt but did not improve fixed-target cost or verified yield here. The next learning work should focus on why generic questions pass the quality gate, why sound questions are held, and where the bank lacks eligible unseen stock. Re-run the read-only bank audit after at least 20 post-deployment builds. Any larger answer-only comparison would need a fresh, balanced source-audited sample and a gate rubric that distinguishes a legitimate term-recall question from one that supplies its answer.
