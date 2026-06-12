# D-GRADE-LATENCY-01 — Answer Grading Latency Diagnosis

**Date:** 2026-06-12
**Scope:** Diagnosis only — no code changes in this prompt.
**Spec target:** answer check completes in **< 2 s** on the critical path (PRD v11.2 §9.3 / §8.9).

Files examined: `src/server/grading.ts`, `src/lib/llm.ts`, the five answer routes
(`daily/answer`, `daily/catchup/answer`, `feed/[feedItemId]/answer`,
`questions/[id]/answer`, `lately/milestone/answer`),
`src/components/play/GameplayChat.tsx`, `src/app/daily/page.tsx`,
`src/server/auth/session.ts`, `src/server/db/index.ts`, `vercel.json`.

---

## 1. End-to-end path trace (daily/answer, bot slot — the common case)

| # | Step | Where | Sync? | Est. latency (warm) |
|---|------|-------|-------|---------------------|
| 1 | Client optimistically pushes user row + `Grading...` typing row | `daily/page.tsx:470-472` | client | ~0 |
| 2 | `fetch POST /api/daily/answer` (network out) | `daily/page.tsx:525` | serial | RTT 20–60 ms |
| 3 | `getSession()` → `validateSessionToken` → **1 DB query** (userSessions by token) + jwtVerify | `session.ts:321-327` | serial | 20–40 ms |
| 4 | `select` daily queue | `route.ts:117` | serial | 20–40 ms |
| 5 | `select` generatedQuestions (or canonical questions) | `route.ts:158` | serial | 20–40 ms |
| 6 | `resolveCanonicalAnswer` — **conditional 2nd LLM call** (`suggestAnswer`) only if stored answer is "generic" | `route.ts:46-77` | serial (rare) | 0 normally; **+400–900 ms when it fires** |
| 7 | **`gradeAnswer` → fast-path exact-match, else LLM grade** | `grading.ts:60` → `llm.ts:579` | serial | **fast-path ~0; LLM ~400–900 ms typical, up to 8 s timeout × 2 attempts** |
| 8 | `persistGeneratedQuestion` (+ select creator meta) — bot slots only, **≥2–3 DB queries** on the critical path | `route.ts:269-298` | serial | 40–120 ms |
| 9 | `Promise.all([readPriorAnswers, selectInsideJoke])` — **parallelized** ✅ | `route.ts:334-339` | serial (1 RTT) | 20–40 ms |
| 10 | `update dailyQueues` (mark slot answered) | `route.ts:374-377` | serial | 20–40 ms |
| 11 | `writeMasteryEvent` — produces `masteryDelta` returned to client, **≥1–2 DB queries** | `route.ts:380-393` | serial | 30–80 ms |
| 12 | `NextResponse.json(...)` returns | `route.ts:458` | — | RTT back 20–60 ms |
| 13 | Client parses, replaces `Grading...` with result row | `daily/page.tsx:543+` | client | ~0 |

**Deferred correctly, off the critical path (✅):** `updateDomainDifficultyOnAnswer`
(`void` + `.catch`, `route.ts:401`), `promoteDeclaredToDemonstrated` (`void`,
`:419`), `awardAuthorCredit` (`void`, `:428`), `createFeedItemsForFriendsFromAnswer`
(`after()`, `:443`). No analytics/logging blocks the path.

**Happy-path totals (warm lambda):** ~8–10 serial DB round-trips (~250–450 ms) **+ one
Haiku grade (~400–900 ms typical)** ≈ **0.7–1.4 s** — under target when warm and when
the fast path misses. The budget is blown by: (a) cold starts, (b) the rare 2nd inline
LLM call at step 6, (c) Haiku tail latency / a single retry (8 s each), and (d)
**perceived** time, because the client blocks on steps 8–12 it doesn't need to (see §5).

Sequential vs parallelizable: steps 3→5 are inherently sequential (each depends on the
prior id). Step 9 is already parallelized. Steps 8, 10, 11 are sequential *writes* that
do not gate the verdict and are the main reclaimable serial tail (see §4).

---

## 2. Fast-path coverage

`exactMatch` (`grading.ts:44-53`) short-circuits **only** on `trim().toLowerCase()`
string equality against the canonical answer **or** an accepted alternative. Empty
submissions also short-circuit to `wrong` (`grading.ts:70`). Everything else hits the LLM.

- **Accepted alternatives *are* evaluated on the fast path** (`grading.ts:52`) — but only
  for exact normalized equality. Non-exact alternative matches still reach the LLM, which
  matches the documented known ("alternatives must still reach the LLM grader when not
  exact"). ✅ correct, but narrow.
- **Hit rate is almost certainly low.** Joshing answers are free-text (often voice
  transcribed). Real submissions carry typos ("Bucephelus"), articles ("the Eroica"),
  hedging ("I think it's X"), punctuation, and paraphrase — none of which survive a bare
  `trim/lowercase` equality. The grading prompt's own leniency examples (`llm.ts:599-608`)
  are exactly the cases the fast path *cannot* catch, so by construction most of them fall
  through to Haiku. **Estimate: well under ~30% of non-empty submissions short-circuit.**
- **No instrumentation exists to confirm this.** `gradedVia: 'exact' | 'llm'` is recorded
  on the outcome (`grading.ts:25`) but isn't aggregated anywhere. We are estimating; a
  counter on `gradedVia` would turn this into a measured number.
- **Conservative widening is available** without touching fail-direction: strip surrounding
  punctuation, collapse whitespace, drop leading articles (`the/a/an`), fold diacritics.
  Each of these only *adds* exact hits for answers that are already textually the canonical
  answer — it cannot accept a genuinely different person/place/thing, so fail-direction is
  preserved. This is the cheapest avoidable-LLM win.

---

## 3. The LLM call itself

`gradeAnswerWithLLM` (`llm.ts:579-691`):

- **Model:** `GRADING_MODEL = claude-haiku-4-5-20251001` (`llm.ts:72`). Correct per
  CLAUDE.md (Haiku for grading). ⚠️ **Stale doc:** the header comment in
  `src/server/grading.ts:5` still says "lenient grader via claude-sonnet-4-6" — misleading,
  worth correcting (the *code* is right).
- **Blocking, non-streaming** (`MessageCreateParamsNonStreaming`, `llm.ts:239`). For a
  ~120-token JSON reply, streaming would not meaningfully help time-to-verdict (we need the
  whole object parsed), so blocking is the right call here.
- **Prompt size:** system prompt ~800 tokens (`llm.ts:596-625`). Comment at `llm.ts:642`
  notes it's below Haiku's 2048-token cacheable threshold, so `cache_control` would be a
  silent no-op — caching is correctly *not* used. Input is small; input tokens are not the
  bottleneck.
- **`max_tokens: 1024`** (`llm.ts:650`) — generous headroom so a verbose `reason`/
  `consolation` can't truncate the JSON. You only pay latency for tokens actually produced
  (~120), so this is not itself a latency cost.
- **Chain-of-thought:** none in the strict sense — the prompt forbids text outside the JSON
  object (`llm.ts:625`) and `temperature: 0`. **However** the schema requires a `reason`
  field (`llm.ts:680`) that is read but never surfaced to the user. It's a few extra output
  tokens of post-hoc justification on a path whose only product is CORRECT/WRONG +
  consolation. Minor, but it's the closest thing to "reasoning leaking onto the hot path"
  and is droppable.
- **Timeouts / retries:** `GRADE_TIMEOUT_MS = 8_000` per attempt (`llm.ts:184`),
  `MAX_GRADE_ATTEMPTS = 2` (`llm.ts:188`) → **worst case ~16 s** before conceding to the
  retryable 503. Additionally the Anthropic client is constructed as `new Anthropic({ apiKey })`
  with **no `maxRetries` override** (`llm.ts:130`), so the SDK's default (2 internal retries
  with backoff on 429/5xx/overloaded) runs *inside* each 8 s attempt's `AbortSignal` budget.
  The 8 s ceiling caps it, but on a degraded upstream a single grade can legitimately eat the
  whole 8 s.
- **Region:** Anthropic API is US. `vercel.json` pins **no function region**, so the answer
  lambda runs in the project's default region. If that isn't US-East-adjacent to both
  Anthropic and Supabase, every step adds avoidable RTT.

**Is the prompt heavier than needed for CORRECT/WRONG?** Slightly. The leniency/strictness
rules earn their keep (they encode product behavior), but the `reason` output field and the
consolation-on-every-wrong work add output tokens that the < 2 s path doesn't strictly need.

---

## 4. Blocking work that shouldn't be (or needn't gate the verdict)

The verdict (`isCorrect` + `consolation` + `correctAnswer` + `explainer`) is fully known
right after step 7. Everything after it that runs *before* `NextResponse.json` is delaying
the reveal:

- **`writeMasteryEvent` (step 11)** is awaited before the response *because* its
  `masteryDelta` is returned and drives the client's mastery animation. It is the strongest
  "blocking-but-could-be-deferred" candidate — but deferring it means the UI either animates
  optimistically or fetches the delta in a follow-up. Real coupling, not an oversight.
- **`persistGeneratedQuestion` (step 8, bot slots)** runs 2–3 writes on the path. The
  *verdict* doesn't need it; `canonicalQuestionId` is only needed for `readPriorAnswers`
  (mastery state) and propagation. The reveal could be returned before promotion completes.
- **`update dailyQueues` (step 10)** is genuinely needed (marks the slot answered to prevent
  double-submit and to rebuild the result row). Keep on path.
- **`resolveCanonicalAnswer`'s inline `suggestAnswer` LLM call (step 6)** is the worst
  offender *when it fires* — a second serial model call before grading even starts. It only
  triggers on "generic" stored answers, so it's a tail spike, not a constant, but it
  doubles model latency on those questions. Candidate for a background repair job rather than
  inline.

**Explainers are NOT generated inline ✅.** Confirmed across all answer routes: explainers
are read from stored columns (`route.ts:203-206`, `feed/answer:240-242`) — never generated
on the answer path. Matches spec (explainers are End-of-Session). `grep` for
`generateExplainer`/`categorizeQuestion`/`generateReflection` on answer routes returns only
`gradeAnswer`/`suggestAnswer`. Categorization and feed fan-out are likewise deferred. ✅

**Cross-route note:** `feed/[feedItemId]/answer` is *less* optimized than `daily/answer` —
it runs `readPriorAnswers`, an `existingMastery` select, `writeMasteryEvent`, a 2-write
transaction, **and** `selectInsideJokeForViewer` all **serially** after the grade
(`feed/answer:124-244`), where daily parallelizes the prior-answers + inside-joke pair.
That's ~2 extra serial round-trips on the feed answer path.

---

## 5. Client perceived latency — the biggest lever

**The thread does not optimistically advance.** On submit, `daily/page.tsx:470-472` pushes
the user's answer and a static `Grading...` typing row (`GameplayChat.tsx:896-921`) and then
**blocks on the entire route response** (steps 2–12, i.e. grade *plus* persist *plus* mastery
*plus* queue write) before rendering the result (`daily/page.tsx:543`). The player stares at
`Grading...` for the whole critical path, not just the grader.

PRD §8.9 calls for the thread to advance optimistically during grading. Two independent wins
here, both independent of actual grader time:
1. **Decouple the reveal from the non-verdict writes** — return the verdict as soon as
   step 7 finishes and let mastery/persist settle async (see §4).
2. **Advance the thread / show progress** per §8.9 instead of a frozen `Grading...` block —
   even without changing server time, perceived latency drops.

This is the single highest impact/lowest-risk item: it doesn't touch grading rules or
fail-direction at all.

---

## 6. DB round-trips on the grading path

**daily/answer (bot slot, happy path):** ~8–10 serial round-trips —
session(1) → queue(1) → question(1) → [grade] → persist+meta(2–3) → priorAnswers+joke(1,
parallelized) → queue update(1) → mastery(1–2). Warm, that's ~250–450 ms of DB. The answer
key + alternatives come back in the **single** question `select` (steps 5) — not fanned out
— so that part is already optimal (`acceptableVariants`/`acceptedAlternatives` are columns on
the row). ✅

**feed/answer:** ~6–7 round-trips, more of them serial-after-grade than daily (see §4).

Cold vs warm: every count above assumes a warm pool. On a cold lambda each of these is the
first use of a freshly opened PgBouncer connection (see §7).

---

## 7. Cold starts / serverless

- **DB driver is node-postgres `Pool`** (`db/index.ts:18-25`), capped at `max: 5` (PgBouncer
  session-mode `pool_size` is 15, shared across Next workers — do not raise blindly, per
  CLAUDE.md / PR #306). This is a **persistent TCP pool**, not the serverless HTTP driver, so
  a cold lambda pays full TCP + TLS + PgBouncer handshake on its first query (step 3) before
  any work begins.
- **No region pinning** in `vercel.json` → the answer function inherits the project default
  region. Any mismatch between that region and Supabase/Anthropic adds RTT to *every* step.
- **Boot guard chain is the dominant cold-start cost.** Per CLAUDE.md, `src/instrumentation.ts`
  runs ~70 idempotent DB guards sequentially on every cold boot, and "the first request waits
  behind them." A cold `POST /api/daily/answer` therefore eats the guard chain *plus* the
  grade — this is how a normally-sub-2s path blows past target on the first hit after a scale
  to zero. `SKIP_BOOT_DB_GUARDS=1` skips the chain (migrations still run); it's intentionally
  left unset in preview/dev for auto-repair, but it (or a warmup ping) is the lever for cold
  tail latency in production.

---

## Ranked speedup opportunities (effort × impact)

| Rank | Opportunity | Effort | Impact | Notes |
|------|-------------|--------|--------|-------|
| 1 | **Optimistically advance the thread + decouple the reveal from mastery/persist writes** (§5, §4) | Low–Med | **High (perceived)** | Return verdict at step 7; settle mastery/persist async or animate optimistically. Pure perceived-latency; touches no grading rule. |
| 2 | **Cold-start budget: region-pin the answer function + warmup / `SKIP_BOOT_DB_GUARDS` strategy** (§7) | Med | **High (tail)** | The ~70-guard boot chain + unpinned region are the worst-case latency, not the median. |
| 3 | **Broaden fast-path normalization conservatively** (strip punctuation, articles, diacritics, collapse whitespace) (§2) | Low | Med | Removes avoidable LLM calls. Only adds exact hits for already-canonical text → fail-direction safe. |
| 4 | **Add instrumentation**: aggregate `gradedVia` (fast-path hit rate) + route-level step timing | Low | Med (enabling) | Converts every estimate in this doc into a measured number; prerequisite to confidently doing #1/#2. |
| 5 | **Trim grading prompt: drop the unused `reason` field; confirm no CoT leakage** (§3) | Low | Low–Med | Fewer output tokens; removes the only "reasoning-ish" output on the path. |
| 6 | **Move `resolveCanonicalAnswer`'s inline `suggestAnswer` repair to a background job** (§4) | Med | Med (tail) | Eliminates the rare but brutal 2nd-serial-LLM-call spike. |
| 7 | **Defer `persistGeneratedQuestion` off the verdict response** (§4) | Med | Low–Med | Verdict doesn't need it; only mastery/propagation do. |
| 8 | **Align `feed/answer` with `daily/answer`'s parallelization** (§4) | Low | Low–Med | Parallelize priorAnswers + inside-joke + mastery reads; ~2 fewer serial round-trips. |

**Do-not-touch guardrails (honored by all of the above):** none of these change grading
rules or fail-direction. The existing `unscored` → 503 design (`grading.ts:33-36`,
`route.ts:242-253`) must be preserved by any deferral — a route may only return WRONG on a
genuine model WRONG, never on a timeout/error of deferred work.

---

## Recommended next B-prompt(s)

1. **`B-GRADE-PERCEIVED-01` — Optimistic reveal & write decoupling.** Implement §5+§4 rank-1:
   advance the thread per §8.9 and return the verdict before non-verdict writes settle, while
   preserving fail-toward-player and the 503-on-outage contract. *(Highest value.)*
2. **`B-GRADE-COLDSTART-01` — Answer-path cold-start budget.** Region-pin the answer function,
   decide the `SKIP_BOOT_DB_GUARDS` / warmup posture for production, measure cold vs warm.
3. **`B-GRADE-FASTPATH-01` — Fast-path widening + instrumentation.** Conservative
   normalization (rank-3) plus the `gradedVia` hit-rate counter and per-step timing (rank-4),
   shipped together so the widening is measured.
4. *(Optional, fold into above)* **`B-GRADE-PROMPT-01`** — drop the `reason` field, verify no
   CoT leakage, fix the stale Sonnet comment in `grading.ts:5`.
