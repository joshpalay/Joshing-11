# B-GRADE-LATENCY prompts — answer-grading speedups

**Source of intent:** `D-GRADE-LATENCY-01-FINDINGS.md` (diagnosis, 2026-06-12).
Spec target: answer check completes **< 2 s** on the critical path (PRD v11.2 §9.3 / §8.9).

**Why these exist:** the diagnosis found the answer-grading path is usually under
target when warm, but blows past it on (a) perceived latency — the client blocks on the
*entire* route response, not just the grade; (b) cold starts; and (c) a narrow fast path
that sends almost everything to the LLM. These four prompts address those, hardest-hitting
first.

**Order:** `B-GRADE-FASTPATH-01` should land **first** (it adds the instrumentation the
others rely on to prove they helped). Then `B-GRADE-PERCEIVED-01` (highest user-visible
impact), then `B-GRADE-COLDSTART-01` and `B-GRADE-PROMPT-01` in any order. None hard-blocks
another, but every prompt after FASTPATH-01 should cite the hit-rate / step-timing numbers
it produced.

**Hard guardrails (apply to ALL four prompts):**
- **Do not change grading rules or fail direction.** A route may return `WRONG` only on a
  genuine model `WRONG`, never on a timeout, error, or deferred-work failure.
- **Preserve the `unscored` → 503 contract.** `gradeAnswer` returns `{ status: 'unscored' }`
  on any infra failure (`src/server/grading.ts:33-36`); every route turns that into a
  retryable 503 and leaves the slot unanswered (`daily/answer/route.ts:242-253`). Any work
  you defer must not be able to flip a real verdict into a false WRONG if it fails.
- **Anthropic model split is fixed:** Haiku (`claude-haiku-4-5-20251001`) for grading. Do
  not swap to Sonnet (CLAUDE.md).
- Zod on every new API input; DB access stays in `src/server/db/queries/`; LLM calls stay in
  `src/server/llm/` / `src/lib/llm.ts` (CLAUDE.md conventions).

---

## B-GRADE-FASTPATH-01 — Measure the path, then widen the fast path

**Goal:** Turn the diagnosis's *estimates* into measured numbers, then conservatively widen
the exact-match fast path so fewer submissions pay for an LLM round-trip — without changing
fail direction.

**Depends on:** nothing. Ship first; the other three prompts cite its numbers.

### What's already in place

- `gradeAnswer` (`src/server/grading.ts:60-105`) computes a fast path via `exactMatch`
  (`:44-53`) that only does `trim().toLowerCase()` equality against the canonical answer and
  each accepted alternative. Everything else calls `gradeAnswerWithLLM`.
- Each outcome already carries `gradedVia: 'exact' | 'llm'` (`src/server/grading.ts:25`) but
  **nothing aggregates it** — so the real fast-path hit rate is unknown.
- `loggedMessagesCreate` already emits a structured `console.info('[llm]', { scope,
  duration_ms, … })` per grade (`src/lib/llm.ts:253-261`), so per-grade model latency is
  observable; route-level step timing is not.

### Scope

1. **Instrument the fast-path hit rate.** Emit one structured log line per grade recording
   `gradedVia`, whether the submission was empty, and (for `llm`) the grade duration. A
   lightweight `console.info('[grade]', { gradedVia, via_empty, duration_ms })` in
   `gradeAnswer` is enough — no new table. Keep it side-effect-only (never let logging throw
   into the grade path, per the `loggedMessagesCreate` precedent at `llm.ts:248-251`).
2. **Add coarse route-level step timing** to `daily/answer/route.ts` behind a cheap helper:
   stamps for session-validate, question-load, grade, persist, mastery-write, total. Log once
   per request at info. This is the data needed to confirm the §1 path-trace estimates.
3. **Widen `exactMatch` conservatively** — normalization that can only ever add hits for text
   that is *already* the canonical answer, so it cannot accept a genuinely different
   person/place/thing:
   - collapse internal whitespace, strip surrounding punctuation/quotes,
   - fold diacritics (`é`→`e`),
   - drop a single leading article (`the`/`a`/`an`).
   Apply the **same** normalization to the submission, the canonical answer, and every
   accepted alternative. Do **not** add stemming, synonym, or edit-distance matching here —
   those are genuine judgement calls and must stay with the LLM (the leniency rules in
   `llm.ts:599-608` own them).
4. **Unit tests** in the style of `src/server/__tests__/grading-fail-toward-player.test.ts`:
   assert the new normalizations short-circuit (`gradedVia: 'exact'`), assert a genuinely
   different answer still does **not** match (falls through to the LLM), and assert empty
   submissions still score `wrong` deterministically (`grading.ts:70`).

### Do NOT
- Do not let widened normalization accept a wrong-but-close answer — if there's any doubt,
  it must fall through to the LLM, not short-circuit.
- Do not persist the instrumentation to a DB table or add a query to the hot path; logs only.

### Done when
- A measured fast-path hit rate is observable in logs (before/after the widening).
- `exactMatch` covers punctuation/whitespace/diacritic/leading-article variants, with tests
  proving fail-direction is unchanged.
- Route-level step timings for `daily/answer` appear in logs.

---

## B-GRADE-PERCEIVED-01 — Optimistic reveal: stop blocking on non-verdict work

**Goal:** Make the answer *feel* instant by rendering the verdict as soon as it's known,
instead of blocking the player on mastery writes, question promotion, and the queue update.
PRD §8.9 calls for the thread to advance optimistically during grading.

**Depends on:** land after `B-GRADE-FASTPATH-01` so you can quote the perceived-vs-actual gap.

### What's already in place (the problem)

- On submit, the client optimistically pushes the user row + a static `Grading...` typing row
  (`src/app/daily/page.tsx:470-472`, `GameplayChat.tsx:896-921`), then `await`s the **full**
  `POST /api/daily/answer` response before rendering the result (`daily/page.tsx:525-584`).
- The server returns only after: grade → `persistGeneratedQuestion` (2–3 writes,
  `route.ts:269-298`) → `update dailyQueues` (`:374-377`) → `writeMasteryEvent`
  (`:380-393`). The verdict itself is fully known right after the grade + the already-parallel
  `selectInsideJokeForViewer` (`:334-339`).
- The client only needs these fields to render the reveal (`daily/page.tsx:561-584`):
  `isCorrect`, `correctAnswer`, `consolation`, `explanation`, `insideJoke` — **all known
  pre-mastery** — plus `pointsAwarded` and `masteryDelta`, which require `writeMasteryEvent`.
  There's already an 850 ms post-answer pause beat (`daily/page.tsx:585-586`) the points/
  mastery animation could settle into.

### Scope — pick ONE approach with the user before building

**Approach A (server-side, smaller blast radius):** keep the request/response shape, but move
`persistGeneratedQuestion` and `writeMasteryEvent` off the response's critical section using
`after()` (the pattern already used at `route.ts:443`), and return the verdict +
`correctAnswer` + `consolation` + `explainer` + `insideJoke` immediately. Because the client
needs `pointsAwarded`/`masteryDelta` for the mastery beat, either (i) compute `pointsAwarded`
*before* the response (it only needs `priorAnswers` + `basePoints`, both already available at
`:334-356`) and defer only the *write*, or (ii) add a tiny follow-up `GET` the client fires
during the existing 850 ms pause to fetch the settled `masteryDelta`.

**Approach B (client-side, true optimistic advance):** render the verdict the instant the
response's verdict fields arrive and advance the thread per §8.9, letting points/mastery
animate in when they settle. Requires the server change from A(i) so `pointsAwarded` is in the
first response.

Recommended: **A(i)** — compute `pointsAwarded` synchronously, defer the `writeMasteryEvent`
*write* and `persistGeneratedQuestion` via `after()`, return the verdict immediately. Smallest
change that removes the two biggest serial writes from the blocking path.

### Do NOT
- Do not defer the `update dailyQueues` slot-close write in a way that lets a double-submit
  through — the slot must be marked answered before (or atomically with) the verdict reaching
  the client, or guarded against re-answer.
- Do not let a deferred `writeMasteryEvent`/`persistGeneratedQuestion` failure surface as a
  wrong verdict or a 503 — those are already best-effort (`route.ts:285-297, 394-396`); keep
  them swallowing their own errors.
- Do not change the `unscored` → 503 branch: a real grader outage must still hold the answer
  for retry (`route.ts:242-253`).

### Done when
- The reveal renders from a response that no longer waits on `writeMasteryEvent` /
  `persistGeneratedQuestion`.
- Measured (FASTPATH-01 timings) blocking time for the client drops to ≈ session-validate +
  question-load + grade.
- Points/mastery still display correctly (synchronously computed or fetched in the pause
  beat), and a forced mastery-write failure still shows the correct verdict.

---

## B-GRADE-COLDSTART-01 — Answer-path cold-start budget

**Goal:** Cut the cold-start tail on the answer lambda, which the diagnosis flagged as the
worst-case way a sub-2s path blows target (the first request after a scale-to-zero waits
behind the boot-guard chain).

**Depends on:** land after `B-GRADE-FASTPATH-01` so cold vs warm is measured, not assumed.

### What's already in place

- DB client is a persistent node-postgres `Pool`, `max: 5` (`src/server/db/index.ts:18-25`) —
  do **not** raise `max` (PgBouncer session-mode `pool_size` is 15, shared across workers;
  CLAUDE.md / PR #306). A cold lambda pays full TCP+TLS+PgBouncer handshake on its first query
  (the session lookup at `session.ts:321`).
- `vercel.json` pins **no function region** (only crons) → the answer function inherits the
  project default region; any mismatch with Supabase/Anthropic adds RTT to every step.
- `src/instrumentation.ts` runs ~70 idempotent DB guards sequentially on every cold boot and
  is "the dominant cold-start latency — the first request waits behind them" (CLAUDE.md).
  `SKIP_BOOT_DB_GUARDS=1` skips the chain (migrations still run); it's intentionally left
  unset in preview/dev for auto-repair.

### Scope

1. **Measure cold-start contribution** using FASTPATH-01's step timings: tag whether a request
   was the first on a fresh instance, and capture the boot-to-first-request delta. Quantify the
   guard-chain cost on a real cold boot before changing anything.
2. **Region co-location.** Decide and document the production region for the answer function so
   it sits next to Supabase and is reasonable to Anthropic (US). If the project default already
   does this, record that and move on — do not pin speculatively.
3. **Boot-guard posture for production.** Per CLAUDE.md the guards are defensive redundancy and
   `migrate()` is sufficient on a fully-journaled DB. Propose (with the user's sign-off) setting
   `SKIP_BOOT_DB_GUARDS=1` in **production** while leaving it unset in preview/dev, and/or a
   warmup ping that pays the guard cost off the user's request. This is a config/ops decision —
   surface it via `AskUserQuestion`, don't unilaterally flip a production env var.
4. **Connection warmth.** Confirm the singleton pool (`db/index.ts:16-27`) is actually reused
   across invocations in the deployed runtime; if cold lambdas always re-handshake, note whether
   a keep-warm or a pre-connect at boot is worth it.

### Do NOT
- Do not raise the pool `max` (CLAUDE.md hard rule).
- Do not disable the boot guards in **preview/dev** — they auto-repair partially-recorded
  databases there.
- Do not add a `src/middleware.ts` for warmup or anything else — this repo uses
  `src/proxy.ts` (CLAUDE.md; regression reverted 5+ times).

### Done when
- Cold-start contribution to the answer path is measured and documented.
- A region decision is recorded.
- A boot-guard / warmup posture for production is agreed with the user and applied via config
  (env var or `vercel.json`), with preview/dev guards untouched.

---

## B-GRADE-PROMPT-01 — Trim the grading prompt, fix the stale model comment

**Goal:** Shave the small avoidable output-token cost on the grading call and remove the only
"reasoning-ish" field on a path that's spec'd to have none, plus correct a misleading comment.

**Depends on:** independent; can land any time. Cheapest of the four.

### What's already in place

- `gradeAnswerWithLLM` (`src/lib/llm.ts:579-691`) asks the model for JSON with keys
  `result, confidence, reason, consolation` (`:625`). `reason` is parsed (`:680`) but **never
  surfaced to the user** — it's the closest thing to chain-of-thought on a path the spec says
  should produce only CORRECT/WRONG (+ consolation).
- `max_tokens: 1024`, `temperature: 0` (`:650-651`); the system prompt is ~800 tokens, below
  Haiku's 2048 cacheable threshold, so caching is correctly a no-op (`:642`).
- **Stale comment:** `src/server/grading.ts:5` claims "lenient grader via claude-sonnet-4-6",
  but `GRADING_MODEL` is Haiku (`llm.ts:72`). The code is right; the comment is wrong.

### Scope

1. **Drop the `reason` field** from the grading request and parser (`llm.ts:625, 680`) unless
   FASTPATH-01's logs show it's load-bearing for debugging — if it is, keep it but cap its
   length in the prompt. Removing it trims output tokens and the only post-hoc-justification
   text on the hot path.
2. **Confirm no CoT leakage:** verify the prompt still forbids any text outside the JSON object
   (`:625`) and that the parser tolerates the model's known non-canonical `result` spellings
   (`normalizeGradeResult`, `:521-529`) so trimming the schema doesn't regress the
   "answer-checker taking a breather" false-503 that motivated that coercion (`:507-519`).
3. **Fix the stale comment** at `src/server/grading.ts:5` to say Haiku, matching
   `GRADING_MODEL`.
4. **Re-run** `src/lib/llm.grading.test.ts` and `src/lib/llm.grading.eval.test.ts`; update any
   fixture that asserts on the `reason` key.

### Do NOT
- Do not touch the leniency/strictness rules (`llm.ts:599-614`) — those encode product
  behavior and are out of scope for a latency trim.
- Do not change the model, `temperature`, retry count (`MAX_GRADE_ATTEMPTS`), or the 8 s
  `GRADE_TIMEOUT_MS` here — those are resilience knobs, not part of this prompt.

### Done when
- The grading request no longer asks for an unused `reason` field (or it's explicitly justified
  and length-capped).
- `grading.ts:5` names Haiku.
- Grading unit + eval tests pass.
