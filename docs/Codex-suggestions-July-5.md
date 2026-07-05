# Codex Suggestions — July 5

## Overview

This is a read-only architectural review of the current question-generation, serving, verification, and gating code as of July 5, 2026. The implementation has moved significantly beyond a PRD-level version in a good way: it is no longer just “generate five questions,” but a layered supply chain for producing, reusing, validating, and serving trivia.

The current architecture includes:

- prompt-time constraints to make generated questions safer before they exist;
- write-time and batch-time gates to catch poor machine output;
- reuse-first bank selection to avoid unnecessary LLM generation;
- queue-level gates for diversity, repeat avoidance, and cooldowns;
- background verification to sweep already-created stock;
- trust-tier machinery that can eventually decide which surfaces get which quality bar.

The overall recommendation is **not** to simplify this aggressively. The shape is good. The main room for improvement is operational and product-policy clarity:

1. make fail-open / fail-closed policy explicit per surface;
2. surface machine demotions into a real review loop;
3. separate player-serving quality gates from long-term pool-trust gates more cleanly;
4. turn logs into a small dashboard or report so these gates can be operated, not just admired in code.

---

## 1. The generation path is much more robust than a PRD-level implementation would usually be

The generator prompt is doing useful editorial prevention up front: open-recall only, no answer leaks, no gratuitous false-premise scaffolding, fan-salience by tier, strip-the-domain, one clean answer, single ask, named-authority caution, fact keys, subject entities, and shape variety.

The important part is that the prompt is not only style guidance. It is explicitly trying to prevent the same production defects the downstream gates later check for. For example, the prompt bans unnecessary asserted side-facts because those are identified as a major false-premise source.

That is the right posture. The best gate is still: **do not ask the model to produce risky artifacts in the first place.** The downstream checks should be insurance, not the primary author.

The generator also fetches the user’s knowledge base, preferences, previous question texts, previous fact keys, recent domain counts, recent skips, cultural anchor, and answered canonical texts before generation. That means generation is not blind; it adapts to declared interests and recent play history.

The strongest design choice here is the combination of **fact-level identity** and **semantic history** machinery. `fact_key` handles exact conceptual duplicates when it works; recent-history and embedding checks catch phrasing variants. Either one alone would be brittle. Together, they make repeat avoidance much more reliable.

---

## 2. The serving ladder is doing the right thing: bank first, generate second

The daily generation path now tries durable bank stock before falling through to fresh generation. For each requested domain and difficulty, it builds a tier ladder, attempts a bank pick, logs hit/fall-through telemetry, and only continues to LLM generation when no source is found.

The bank query itself is mature. It:

- matches on folded `domain_key`, with exact-string fallback for legacy rows;
- excludes the current user’s own generated stock;
- excludes duplicates;
- excludes content-report-suppressed rows;
- applies trust-tier gating in shadow/enforced mode;
- ranks and filters likely duds before serving.

That “verify once, reuse many” posture is exactly where this product should go.

The code also preserves verification and trust metadata when copying a bank row into a serving `GeneratedQuestion` row, including trust tier, ask-to-answer verification, acceptable variants, source refs, perishable flag, and provider provenance. That prevents bank reuse from becoming a provenance or grading regression.

### Suggested improvement

Treat bank-hit telemetry as an operational metric, not just a debug log. The raw signal already exists: domain, hit vs fall-through, requested tier, served tier, fallback use. The missing piece is a small report answering:

- Which domains are always falling through?
- Which tiers are under-stocked?
- How many bank hits are below the intended trust tier while gating is still off?
- Which domains generate repeatedly but never build durable stock?

---

## 3. The queue-level gates are product-aware, not just quality-aware

The queue orchestrator has a whole-queue diversity gate that applies across authored, house, and generated sources, not per source. That matters because otherwise the system could produce a technically valid queue that still feels repetitive.

It also correctly treats generation as a lossy process. The code acknowledges that quality, factual, and history gates can drop half or more of a batch, so it over-requests and trims survivors.

The top-up loop is the right kind of complexity: it does **not** relax gates just to hit five. It spends additional bounded rounds trying to find more good questions, stops under time/round budgets, and broadens the palette away from already-filled domains to avoid re-mining exhausted favorites.

That is a very good product decision. A short high-quality queue is better than a padded bad queue, but a full high-quality queue is worth an extra round if budget allows.

### Suggested improvement

Make degraded cases more visible to admins. The code has nuanced reasons for shortfall — generic drops, duplicates, answer cooldown, subject cooldown, diversity deflections, gate losses, top-up recovered nothing — but those are mostly internal counters and logs.

If a player repeatedly gets 3–4 questions, the system should be able to say which reason dominates for that user/domain without spelunking logs.

---

## 4. The generation gates are layered well

The generated-question screening phase is comprehensive. It runs multiple gates against the same batch and unions the drop sets:

- intra-batch duplicate detection;
- recent-history duplicate detection;
- quality gate;
- factual gate;
- answered-history semantic duplicate detection;
- deterministic answer-leak backstop;
- answer cooldown;
- subject cooldown.

The independent checks run in parallel, which matters because otherwise the gate stack would destroy latency.

### Quality gate

The quality gate checks for answer leakage, opinion/vagueness, false premise, self-answering, generic-at-tier, multipart questions, and misleading setup.

The tier nuance is important: `GENERIC_AT_TIER` is only judged for moderate/specialist questions, not accessible ones. That prevents “accessible” from becoming artificially ornate while still keeping moderate/specialist questions from collapsing into generic trivia.

### Factual gate

The factual gate is correctly scoped to the two highest-risk factual failures:

- the stated answer is wrong;
- the setup contains a false factual claim even when the answer is right.

The model-tier decision also makes sense. The comments indicate that Haiku missed subtle false-premise cases and Sonnet recovered the major-defect lift, so the factual gate defaults to the stronger model while remaining overridable by `FACTUAL_GATE_MODEL`.

The `max_tokens` truncation guard is a sign the code has been hardened against real failures. Previously, truncated JSON could silently produce an empty drop set and let bad questions through. Now the gate logs loudly if the response hits `max_tokens`.

### Ask-to-answer gate

The ask-to-answer gate is well conceived. It strips the stored answer, asks a cheaper independent model to answer cold several times, then judges whether those cold attempts agree with each other and the stored answer.

Passing earns machine verification; clear contradiction drops the question; ambiguity does not falsely verify.

That is exactly the right role for this gate: it catches “the generator’s answer key is not what a solver would produce,” but it does not pretend to be full factual grounding.

### Suggested improvement

Track the percentage of served generated questions that were served after one or more gates failed open. The system mostly avoids falsely minting trust when a gate fails, but operationally it should be easy to answer:

> How many questions reached players because availability won over verification on this run?

---

## 5. Trust tiers are the right abstraction, but the rollout is intentionally unfinished

The trust-tier gate is a clean boundary:

- self-practice can eventually require `machine_verified` or better;
- friend-facing / convergence / house can require `human_validated` or `author_confirmed`;
- enforcement is behind `VERIFICATION_TIER_GATING_ENABLED`, off by default, and currently shadow-logs what it would filter.

This is exactly how to avoid a dangerous flag flip. The system can measure blast radius before turning enforcement on.

### Suggested improvement

Formalize the pre-flip checklist. Before enabling tier gating, require a concrete report with:

- candidate counts before/after by surface;
- bank hit rate before/after by domain/tier;
- expected Daily shortfall rate;
- top domains that would become under-stocked;
- number of friend-facing items that would disappear.

---

## 6. User-authored questions have a different, sensible gate profile

The authored-question route has a different and reasonable posture from generated questions. It:

- validates payload and rejects answer-in-question at request level;
- categorizes the question;
- rejects generic categories;
- reconciles authored domains against existing domains;
- assesses difficulty;
- vets the question;
- hard-blocks safety failures from fan-out.

The authored vetter is broader than the generated factual gate. It checks factual correctness, quality, safety, and answer leakage, then maps the result onto public eligibility.

The failure posture is also better for authored content than for generated content: if vetting fails, the route falls back to `needs_review`, not auto-publish.

That distinction makes sense:

- generated content is system-owned, so fail-open may be acceptable to keep the Daily queue alive, as long as trust tier stays low;
- user-authored content can be saved for the author but should not silently enter stranger-facing surfaces if vetting is uncertain.

Safety failures are especially strict: the route overrides visibility to blocked and skips all fan-out.

### Suggested improvement

Revisit whether factual failures should remain friend-shareable.

Currently, safety failures are hard-blocked from every surface, while factual, quality, and answer-leaked rejections are public-pool signals and can remain shareable to friends. That may be right for a friend-game product, but it is a product policy that deserves explicit ratification.

A possible policy split:

- **Safety fail:** blocked everywhere.
- **Answer leak:** author can save, but do not fan out automatically.
- **Factual fail:** do not fan out unless the author explicitly overrides after seeing a warning.
- **Quality fail:** lower severity; maybe still shareable.

---

## 7. Background verification is the strongest second net

The batch verifier is demote-only, not write-time. It sweeps both `Question` and `GeneratedQuestion` rows that have not been stamped, skips rows the pure prefilter says do not need verification, and verifies routed rows with a grounded verifier.

This is good architecture because it separates **serving latency** from **long-term supply hygiene**. The player path can stay responsive, while the background verifier gradually improves the pool.

### Prefilter

The prefilter is pure and deterministic. Its goal is to avoid spending LLM/web calls on bare stable facts while routing premise-bearing or adjacent-claim-bearing questions to verification.

It looks for assertion signals such as years, dates, counts, ordinals, superlatives, recurrence, attribution, relationships, and work-location claims.

It then routes to:

- `false_premise` if the stem has a setup clause with assertion signals or multiple signals;
- `extra_fact` if the explanation or answer carries adjacent claims;
- `skipped` if neither applies.

This is a cost-aware design. It is the right “cheap deterministic router before expensive verifier” shape.

### Verifier

The verifier itself is grounded but not web-happy. It resolves from model knowledge first, then uses web search only when knowledge cannot confidently settle a claim.

It supports optional domain restrictions for web search via `VERIFY_WEB_SEARCH_ALLOWED_DOMAINS`, which is useful if the verifier should read reference-style sources rather than arbitrary web results.

Demotion semantics are conservative:

- `Question` demotion sets `publicStatus = 'needs_review'`, never overwriting the author’s answer.
- `GeneratedQuestion` demotion sets `isDuplicate = true`, the suppression flag the bank honors.

### Suggested improvement

Demotions need a first-class human review surface. A demote-only background verifier is much more powerful if reviewers can see, clear, uphold, and learn from demotions.

Machine demotions should become part of the same operational loop as player reports, or at least a parallel queue with equivalent ergonomics.

---

## 8. Deduplication is multi-layered and generally well designed

There are at least four dedup layers:

1. prompt-level avoid lists, which are advisory;
2. recent-history LLM gate for semantic same-fact detection;
3. fact-key persistence guard for recent history and same-batch duplicates;
4. embedding dedup, which marks pool collisions as duplicate so bank selection will not serve them.

This is the right level of redundancy because LLM-produced identifiers are imperfect and text similarity alone can over-collapse distinct facts.

### Suggested improvement

Watch for false suppression in embedding dedup. The code already passes `factKey` into dedup to avoid collapsing distinct facts about the same work based on shared vocabulary. That is good, but it means dedup quality depends heavily on fact-key quality.

If bank under-supply appears in dense domains, inspect whether embedding dedup is over-suppressing or fact keys are too coarse.

---

## 9. Main improvement list

### A. Make gate outcomes inspectable as a single artifact

The information exists, but it is spread across logs and columns. A compact per-generated-batch record would make the system much easier to operate:

```ts
{
  requested: 10,
  parsed: 9,
  dropped: {
    quality: 2,
    factual: 1,
    answerLeak: 0,
    recentHistory: 1,
    answeredHistory: 0,
    askToAnswer: 1,
    genericDomain: 0,
    underDifficulty: 1
  },
  persisted: 4,
  machineVerified: 3,
  unverified: 1,
  gateFailures: {
    quality: false,
    factual: false,
    embeddings: true
  }
}
```

The improvement is aggregation. It would make it much easier to answer whether short queues are caused by model quality, exhausted knowledge bases, over-dropping factual gates, or thin bank supply.

### B. Decide whether factual failures should be friend-shareable

For authored questions, safety failures are hard-blocked, but factual/quality/answer-leak issues affect public status while remaining potentially shareable to friends. That may be correct, but it should be an explicit product decision rather than an implicit behavior.

### C. Human review is the missing closure loop

Machine demotion without a review queue risks becoming invisible debt. The batch verifier can demote generated questions and user questions, but the product needs a place where those demotions are triaged, corrected, restored, or used to improve prompts.

### D. Make trust-tier flip criteria concrete

Before enabling `VERIFICATION_TIER_GATING_ENABLED`, require a concrete report:

- candidate counts before/after by surface;
- bank hit rate before/after by domain/tier;
- expected Daily shortfall rate;
- top domains that would become under-stocked;
- number of friend-facing items that would disappear.

### E. Separate “availability fail-open” from “trust fail-open”

A lot of gates fail open to avoid blocking the daily queue. That is defensible. But there are two meanings of fail-open:

1. serve it because otherwise the player gets nothing;
2. treat it as verified.

The code mostly avoids the second. That invariant should be made explicit everywhere:

> Gate outage may preserve availability, but must never mint trust.

### F. Use verifier findings to tune the generator

The batch verifier’s reasons can become a feedback source. If demotions cluster around dates/counts, fandom episode placement, relationship claims, quote completions, or named-authority rules questions, those clusters should feed back into the generator prompt and supply strategy.

---

## 10. Overall judgment

The code has moved past the PRD in a good way. The PRD likely described “generate questions, verify them, serve a daily set.” The implementation now has a real supply pipeline:

1. bank-first serving to reuse existing stock;
2. LLM generation only on fall-through;
3. prompt-level prevention;
4. batch quality/factual/history gates;
5. deterministic answer-leak, answer-cooldown, subject-cooldown, and generic-domain guards;
6. ask-to-answer machine verification;
7. embedding/fact-key dedup;
8. background verification with pure prefilter and web fallback;
9. trust tiers with shadow-mode enforcement;
10. queue top-up loops that preserve quality rather than padding.

The remaining work is mostly operational/product closure:

- expose gate health;
- triage machine demotions;
- formalize trust-tier flip criteria;
- decide social policy for flawed authored questions;
- turn verification reasons into prompt/supply improvements.

That is a very solid place to be.
