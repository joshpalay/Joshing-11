# Question lifecycle audit

Date: 2026-09-09

This audit used the current code, read-only database queries, tests, application logs, and saved examples. Player answers and identity fields were not copied into this report.

## The simple story

Joshing starts with topics a player chose, topics a friend chose, and topics the player has shown they know. It tries to reuse a suitable unused question from the question bank. If the bank cannot fill the Daily Five, it asks an Anthropic model to write more questions.

The generator returns JSON. Each question should include its topic, wording, answer, explanation, difficulty, a fact key, a main subject, sub-angle tags, and a question shape. Several checks then look for bad wording, wrong facts, repeated facts, answer leaks, topic drift, and unsuitable difficulty. Some checks use code. Some ask another model. The system saves accepted questions in `GeneratedQuestion`, selects the Daily Five, and stores a snapshot in `DailyQueue.slots`.

When a player answers, the server first checks the canonical answer and saved alternatives. If that simple check cannot decide, a cheaper model judges the answer. The route then saves the reveal in the queue and writes a mastery event. A player can ask for a recheck. An accepted recheck can teach the answer key a new alternative.

Recovered questions are a reveal deck. They are not another graded round. “Learning,” “Review,” and “Solid” are also not three states of one question. “Solid” is a topic mastery tier.

## Current execution path

1. Topic entry and normalization: onboarding, invite seeding, `declaredInterests`, `PlayerMastery`, `domainKey()`, and broad-category normalization.
2. Queue request: Daily API routes call the queue orchestrator.
3. Selection: `queue-orchestrator.ts` and queries in `db/queries/daily.ts` try authored candidates, return questions, and bank questions.
4. Generation: `generate-questions.ts` builds the prompt and calls the configured generation provider.
5. Parsing: `parseQuestions()` reads JSON and turns valid objects into `LlmQuestion` values.
6. Checks: quality, factual, recent-history, batch duplicate, embedding duplicate, cooldown, answer-leak, topic, and difficulty checks run.
7. Storage: accepted generated questions go into `GeneratedQuestion`; played generated questions can be promoted into `Question`.
8. Daily Five: `DailyQueue.slots` stores the selected question references and presentation snapshot.
9. Presentation: Daily components reveal one question at a time, then the answer and explanation.
10. Grading: `grading.ts` checks exact forms and accepted alternatives, then calls the grading model when needed.
11. Saving: answer routes update the surface state and write `MASTERY_EVENTS` and `PlayerMastery` data.
12. Recheck: recheck routes can change a grade and add a newly accepted alternative.
13. Follow-up: difficulty, trust, feed, author credit, return questions, and analytics are updated.

Quality can be lost during generation, parsing, fact checking, or bank reuse. Trust can be lost when saved copies disagree or when a failed check looks the same as a passed check. Time and money are mostly spent on fresh generation and model quality checks. Grading model calls are much smaller and faster.

## Confirmed evidence

### Stored questions

- 2,945 generated rows existed at the time of inspection.
- 2,202 were not suppressed.
- 1,765 had been used in a queue.
- 407 had saved acceptable variants.
- Of 2,202 live rows, 730 lacked `subject_entity` and 1,211 lacked an embedding.
- The bank-copy path did not copy those two fields. This weakened later similarity and subject checks.

### Linked copies

- 760 live `GeneratedQuestion` to `Question` links were inspected.
- 51 linked pairs had different canonical answers.
- 1 pair had different saved alternatives.
- Some differences looked like deliberate later edits. Others were meaningfully different. The write paths did not always update both copies together.

### Verification

- 660 live generated rows had a later verification verdict of `ok` while their trust tier was still `unverified`.
- 9 rows marked `machine_verified` later received `unverifiable` verdicts.
- Trust-tier enforcement was off by default. The code measured the effect before enforcement.
- Gate counters mixed player builds with maintenance work, so a maintenance sweep could look like a player-facing quality failure spike.

### Speed and cost

- Nine recent new builds were measurable over 14 days.
- Median player-visible build time was 25.243 seconds.
- The 95th percentile was 53.8202 seconds. The maximum was 59.095 seconds.
- The nine measured new builds recorded 65 bank hits and 33 misses. All nine reached their recorded target size.
- Recent measured generation calls: 59 calls, about $3.767 estimated total.
- Recent measured quality-gate calls: 364 calls, about $2.0134 estimated total. This number included maintenance traffic and was not a clean player-build cost.
- Recent grading calls: 91 calls. Median time was about 1,014 ms and the 95th percentile was about 1,423.5 ms. Estimated total was about $0.125, or about $0.0014 per call.
- Cost per played question could not be measured honestly from existing aggregate data. The missing link was a clean separation between build traffic, maintenance traffic, reuse, and the final played slot.

### Rechecks

- 63 grade disputes existed: 24 accepted alternatives, 36 rejects, and 3 needing human review.
- The three recent cases were two accepted and one rejected.
- These counts are small. They show real unfair cases, but they are not enough to estimate a stable error rate.

## What worked well

- The Daily Five is a first-class product flow with queue state, retries, fallbacks, and saved reveals.
- The generator uses explicit JSON and multiple quality checks.
- The system has exact-answer and accepted-alternative fast paths before paid grading.
- An unavailable grading model leaves an answer unscored instead of marking it wrong.
- Accepted rechecks can be saved for future players.
- Bank reuse, fact keys, recent history, embeddings, and cooldowns all try to protect novelty.
- Generated provenance uses trust tiers and source references. The repository clearly treats friend attribution and generated attribution as different claims.
- The product copy and mastery code emphasize warmth, reflection, recovery, and topic growth more than competition.

## Main problems and causes

### 1. Meaningful punctuation could disappear during grading

Example: the old normalizer treated `C` and `C++` as equal. It also collapsed `C major` with `C# major`, `5` with `-5`, and `1 5` with `1.5`.

Cause: **Confirmed.** `normalizeForMatch()` removed all punctuation before exact comparison.

### 2. Question copies could disagree

The generated copy and promoted canonical copy could keep different answers or alternatives. Different screens could then grade the same wording differently.

Cause: **Confirmed.** Several edit and recheck paths wrote only one store. Admin edits were not atomic across both stores.

### 3. Reused questions lost useful metadata

A bank copy kept many trust fields but dropped `subject_entity` and `embedding`.

Cause: **Confirmed.** Those fields were absent from `BankSource` and the insert that creates the per-player copy.

### 4. A failed model check could resemble a clean check

Some gate parsers returned an empty drop set for malformed JSON. That is the same data shape as “the check ran and found no problem.”

Cause: **Confirmed.** The parsers did not always validate required response fields or record an invalid state.

### 5. Later verification and trust could disagree

A background verifier could say `ok` without promoting an unverified generated row. A later `unverifiable` verdict also had no staged serving rule.

Cause: **Confirmed.** Verification stamping and trust-tier stamping were separate. The serving gate read the trust tier only.

### 6. Generation instructions contained a contradiction

The prompt described `name_multiple` as a supported shape and also told the model not to emit it. The normal parser would accept it even though grading does not have a deterministic list rule.

Cause: **Confirmed.** The shape appeared in the prompt, type list, and examples while a nearby sentence held it back.

### 7. Topic attribution was too broad

Onboarding said a friend picked all shown topics, even when some rows had `fromCatalog: true`, meaning Joshing added them.

Cause: **Confirmed.** One sentence covered the whole mixed list.

### 8. A stale queue snapshot could overwrite a newer one

The answer route read the whole slot array, changed one slot in memory, and wrote the whole array back. A simultaneous bonus append or answer could be lost.

Cause: **Strongly supported.** The update checked only the queue id. It did not check that the stored slot array was still the version that had been read.

### 9. Retry layers multiplied model calls

The model helper retried internally and the browser retried a 503. One submission could therefore cause more calls than either layer’s limit suggested.

Cause: **Confirmed.** Both retry loops were active.

### 10. Exact cost per played question was unknown

Cause: **Confirmed.** Gate telemetry did not separate real Daily Five builds from maintenance, and usage rows did not provide a complete final-play attribution chain.

## Implemented plan

1. Preserve meaningful symbols in deterministic answer matching and log a safe reason code.
2. Copy subject and embedding metadata during bank reuse.
3. Update linked answer alternatives and admin edits together.
4. Require valid `fact_key` and `question_shape` values, stop generating unsupported list questions, and log missing subject or sub-angle metadata. Those optional fields are not enforced yet because the existing supply often lacks them.
5. Treat malformed model-check output as an explicit failed or invalid check.
6. Promote successfully verified generated rows without lowering stronger human trust.
7. Add a default-off hold for later `unverifiable` rows, with shadow counts before enforcement.
8. Separate player-build gate counts from maintenance counts with a small additive migration.
9. Add compare-and-set protection to Daily queue answer saves.
10. Make the browser own bounded grading retries so server and browser retries do not multiply.
11. Label catalog topics as coming from Joshing.
12. Add a private, offline grading comparison that uses invented examples and makes no model calls.

## Risks and safeguards

- Stricter `fact_key` and `question_shape` validation can reject more model output. The existing generation retry and bank fallback remain in place. Missing subject and sub-angle metadata is measured but accepted for now, because enforcing it against the current supply would be risky.
- Holding `unverifiable` questions could thin the bank. The new rule is off by default and reports how many rows it would hold.
- A compare-and-set conflict asks the player to look at the refreshed question again. This is safer than silently overwriting a newer answer or bonus slot.
- Background verification now promotes only `unverified` rows. It does not lower `human_validated` or `author_confirmed` trust.
- The migration is additive. Existing gate rows remain under the `unknown` scope. New player and non-player rows are separate.
- The answer matcher still sends uncertain spelling, aliases, abbreviations, synonyms, dates, and paraphrases to the model. Broad deterministic guesses were avoided because they could accept a wrong answer.

## Rollback

- Matching, parser, copy, retry, and attribution changes can be reverted independently.
- `VERIFICATION_UNVERIFIABLE_HOLD_ENABLED` defaults off and can remain off without changing serving.
- `VERIFICATION_TIER_GATING_ENABLED` remains unchanged and off by default.
- Migration `0145_gate_drop_scope.sql` can be rolled back by dropping the three-column constraint and `scope` column, then restoring the old `(day, gate)` constraint.
- No production rows were modified during this audit or test run.

## Remaining unknowns

- A stable false-positive and false-negative grading rate needs a larger, labeled evaluation set.
- Question quality by model cannot be compared honestly without running the same blinded prompts and rubric after explicit permission to spend model calls.
- Cost per played question needs a final link from build and reuse records to played slots. This change separates contaminated gate counts but does not complete that full attribution chain.
- The mastery event and queue slot are still stored by separate helpers. The compare-and-set prevents stale queue overwrites, and mastery ids prevent double credit, but a database outage between the two writes can still leave a saved slot without its mastery event. A true single transaction would require a larger refactor of the shared mastery writer.
