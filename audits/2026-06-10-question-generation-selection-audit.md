# Question Generation & Selection — End-to-End Audit (2026-06-10)

**Method:** read-only. Every claim cites the file read directly; no code changed. Specs used as the
standard: `PRD-D-5` (quality floor + verification, incl. §11 as-built log), `PRD-D-4` (+2 reframe +
milestones), `PRD-D-1` (Daily/Feed split), `PRD-D-0`, `DECISIONS.md`, and the two conformance audits
(`audits/2026-06-02-restructure-conformance-audit.md`, `audits/2026-06-02-d4-plus2-reframe-reaudit-findings.md`).

> **Input gap:** the requested `joshing-SESSION-HANDOFF.md` does not exist anywhere in the repo
> (globbed for `*SESSION-HANDOFF*` / `*handoff*`). This audit proceeds from the PRD-D series +
> CLAUDE.md + code. If a handoff doc lives outside the repo, reconcile against it.

**Effort key:** S = hours, M = 1–2 days, L = multi-day.
**Re-audit key:** 🔁 = touches a conformance-audited surface (the +2 per D-4's explicit warning;
the B1–B5 quality-floor engine per PRD-D-5 §11; restructure provenance surfaces per the 2026-06-02 audit).

---

## Part 1 — Generation: trigger → prompt → call → validation → persistence

### 1.1 The per-user daily pipeline (the dominant path)

**Trigger.** `fillDailyQueueForUser` (`src/server/daily/queue-orchestrator.ts:117`) runs either
(a) synchronously on the user's first `POST /api/daily/queue` of the day (`src/app/api/daily/queue/route.ts`,
`maxDuration` 90s) — the fallback path for new users and cron failures — or (b) from the
`daily-assignments` cron fan-out (all onboarded users, concurrency 4), **scheduled at 17:05 UTC by
GitHub Actions, not Vercel** (`.github/workflows/external-crons.yml:30`). It was deliberately removed
from `vercel.json` on 2026-05-30 because it also sends SMS (not idempotent) and the Vercel Hobby
cron firing alongside the workflow could double-text users; GitHub Actions is its sole scheduler by
design (workflow header, `:20-26`). The route comment's "(vercel.json)" parenthetical is stale. The
workflow also re-fires weekly-ceremony / vet-questions / expire-friend-requests (idempotent, kept in
`vercel.json` as fallback); **pool-refill is the one cron scheduled only by Vercel Hobby** — see C1.

**Source priority before any LLM call.** The orchestrator fills authored → house → generated
(`queue-orchestrator.ts:281-287`), and the generated tranche itself is **bank-first**: for each chosen
domain, `pickBankPicksForDomains` (`generate-questions.ts:1537`) tries `pickBankSource`
(`src/server/db/queries/daily.ts:1449`) — a cross-user draw from the durable `GeneratedQuestion` pool —
before any Sonnet call. Only unfilled domains/slots go to `generateDailyQuestions`.

**Domain choice for the bot tranche** (`generateDailyQuestionsFromKnowledgeBase`,
`generate-questions.ts:1269`): custom mode = user's picks ordered least-recently-mined then by
often/sometimes/blue-moon frequency (`:1313-1329`); random mode = one domain per broad category,
shuffled, demonstrated preferred with declared included at 50% weight (`DECLARED_DOMAIN_WEIGHT`),
soft cap 5 questions/domain/week (`selectDiverseDomains`, `:1209-1267`); first run seeds from declared
interests in selection order (`first-run-seeding.ts`).

**The generation call** (`callLlmOnce`, `generate-questions.ts:846`):

- **Model:** `claude-sonnet-4-6` (`ANTHROPIC_MODEL`, `src/lib/llm.ts:70-74`), `max_tokens: 2000`,
  temperature **0.8**, timeout 35s, chunked at **3 questions/call** run in parallel.
- **System prompt** (`SYSTEM_PROMPT`, `:65-199`), `cache_control: ephemeral`: factual/single-answer
  rules, no-multiple-choice, no-answer-leak, **trivia-of-trivia rule**, **fan-salience rule (Rule 1,
  tier-dependent: required at moderate/specialist, optional at accessible)**, **strip-the-domain test
  (Rule 2, all tiers)**, one-clean-answer, named-authority rule, calibration pairs, **44 style
  exemplars** (`exemplars.ts`), granularity rules, repetition rules + `fact_key` contract, 10-shape
  catalog (`name_multiple` held back — grading can't handle it), `sub_angles` contract, JSON return
  schema. Rough size **~3–4k tokens** (the inline comment at `:843` saying "~1500 tokens" is an
  undercount — either way it clears the 1024-token Sonnet cache threshold).
- **User prompt** (`buildUserPrompt`, `:277-390`): domain list, per-domain difficulty instruction
  (from `mapAdaptiveLevelToDifficultyHint`, `src/server/adaptive-difficulty.ts:124-172`), territory
  register block (DECLARED = enthusiast register / INTRODUCED = newcomer, `:347-361`), sub-angles
  already covered, then the avoid lists: **up to 80 recent question texts + up to 200 fact keys**
  (`RECENT_QUESTION_TEXT_LIMIT`/`RECENT_FACT_KEY_LIMIT`), both scoped to the viewer's own
  `GeneratedQuestion` history (`getRecentDailyQuestionTexts`/`getRecentFactKeys`,
  `queries/daily.ts:1356,1624` — last 200 rows, no time bound). Rough size **~4–6k tokens**, repeated
  per chunk and per top-up round, **uncached**.
- **Token footprint per call:** ~8–10k in / ≤2k out. A typical 5-slot build with bank misses and
  over-request ×2 issues **2–4 of these calls**; each top-up round (≤4) issues more.

**Parsing/validation.** `parseQuestions`/`parseBaseQuestion` (`:409-474`): structural field checks,
generic-answer and generic-subcategory rejection, `fact_key` normalization (null logged, not fatal),
sub-angle/shape normalization. Then **five gates** over the batch:

| Gate | Model / kind | Direction | Notes |
|---|---|---|---|
| `findBatchDuplicates` (`:507`) | Haiku, max 200 tok, temp 0 | fail-open | intra-batch same-fact |
| `findRecentHistoryDuplicates` (`:761`) | Haiku, max 200 | fail-open | vs last 30 avoid entries — "the actual enforcement boundary" for semantic dedup |
| `findQualityFailures` (`:573`) | Haiku, max 500; system **includes the full 44-exemplar block** | fail-open | only 4 defect classes: ANSWER_LEAKED / OPINION_OR_VAGUE / FALSE_PREMISE / SELF_ANSWERING |
| `findFactualFailures` (`:691`) | Haiku, max 500 | fail-open; UNVERIFIABLE = OK | only wrong-answer check on this path |
| `findAnswerLeaks` (`:734`) | deterministic string check | fail-closed | answer-in-question backstop |

**Verification + extras at persist** (`generateDailyQuestions`, `:874-1174`):

- **Ask-to-answer** (`ask-to-answer.ts`): per candidate, **3 cold Haiku calls** (60 tok, temp 0.7) +
  **1 batched Haiku judge** (600 tok, temp 0). PASS → `trust_tier='machine_verified'` +
  `acceptable_variants` seeded; contradiction → dropped; outage → fail-open, row stays `unverified`.
- **Aside** (`generateInsideJoke`, `llm.ts:886`): **Sonnet**, 160 tok, one per candidate — runs in
  parallel *with* ask-to-answer, so it's also paid for rows ask-to-answer then drops.
- **Domain reconcile** (`reconcileProposedDomain`, `src/lib/questions/categorization.ts:23`): Haiku,
  256 tok, 3s race, one per persisted row.
- **Persist** into `generatedQuestions` (`schema.ts:582`) with `factKey` belt-and-suspenders dedup,
  `expiresAt` = next daily reset (the durable pool ignores it — see 2.1), then
  `embedAndResolveDuplicate` (`src/server/pool/dedup.ts`) — Voyage `voyage-3.5-lite` embedding +
  nearest-neighbour + human-beats-machine collision, **no-op until `VOYAGE_API_KEY` is provisioned**
  (PRD-D-5 §11.3c; currently the deterministic guards are the only dedup).

**Cache/regeneration:** every fresh row is banked durably and becomes cross-user stock; per-user
repetition is avoid-list driven. Nothing else on this path is cached. **No Message Batches API
anywhere in the repo.**

### 1.2 The +2 bonus path (D-4 §B)

`generateBonusQuestionsForDomains` (`generate-questions.ts:1438`), called by the orchestrator after the
core five (`queue-orchestrator.ts:552-570`). Per chosen friend-shaped domain (≤2): **bank-first**
(accessible tier), else `generateDailyQuestions([domain], 1, …, 'normal')` — the full pipeline above
for one question. Notably it passes **no** `domainTerritoryTypes`, **no** `subAnglesByDomain`, **no**
`domainSkips` (`:1481-1493`), and the `'normal'` preference maps to the accessible hint: *"someone
with a passing interest … not deep cuts"* (`adaptive-difficulty.ts:131`). It does fold the viewer's
authored texts into both avoid paths (`:1445-1458`). Frequency: 0–2 Sonnet pipelines/user/day on bank
miss.

### 1.3 Retrieval-grounded pool refill (B3 — built, OFF)

`/api/cron/pool-refill` (09:00 UTC daily) → `retrieval-grounded.ts`. **Default disabled**
(`RETRIEVAL_GROUNDING_ENABLED=false`, `retrieval-config.ts:66`) and also requires
`RETRIEVAL_SYSTEM_USER_ID`. When on: targets domains that are *thin* (pool depth < 8 non-duplicate
fact-keyed rows) *and* recently served (14d), ≤50 domains/run, Sonnet + server-side `web_search`
(≤3 searches/question, 3 questions/domain), `SYSTEM_PROMPT + GROUNDING_SYSTEM_ADDENDUM`
(retrieve-first, ≥2 independent hosts incl. ≥1 reputable, `source_refs` provenance), screened by the
same gates + ask-to-answer, persisted durable (`expiresAt` 2999) at `machine_verified`. Hard spend
ceiling **$2/day** default. While this is off, thin-domain refill happens only as a side effect of
per-user retail generation, ungrounded.

### 1.4 Other generation-adjacent calls per user-day (play + authoring)

| Call | Model | Size | Fires | Cached? |
|---|---|---|---|---|
| `gradeAnswerWithLLM` (`llm.ts:579`) | Haiku, 1024 tok | ~1k in | per answer (~5–7/day) | no |
| `generateBreadcrumb` (`generate-breadcrumb.ts:60`) | Haiku, 120 tok, 3s | small | per answer reveal | in-memory LRU (500), per-process |
| `recheckAnswerWithLLM` (`recheck.ts:60`) | **Sonnet**, 400 tok | ~1k | per appeal (rare) | no |
| `vetQuestion` (`vet-question.ts:105`) | Haiku, 400 tok | ~1k | per authored submit + nightly cron (batch 25 @ 4) | persisted to `publicStatus`/score |
| `categorizeQuestion` (`llm.ts:695`) | **Sonnet**, 300 (+2 refinements) | ~1k | per authored question | system cached |
| `suggestAnswer` / `generateSuggestion`+`verifySuggestion` | Sonnet (+Haiku verify) | ~1–1.5k | per authoring draft | no |
| `suggestTags`, `cleanQuestion`, `assessQuestionDifficulty` (`llm-difficulty.ts:39`) | **Sonnet** | small | per authored question | no |
| `proposeInterests` / `canonicalizeInterest` / `expandBroadInterest` / `assessInterestAnswerability` (`interests.ts`) | Sonnet 1600 / Haiku ×3 | ~1–2k | onboarding, once-ish per user | proposeInterests system cached |
| `suggestAggressiveDomainMerges` (`mastery/ceremony.ts:444`) | Sonnet, 1200 tok | ~1–2k | weekly per user | no |
| `generateFactualReflectionExplanation` (`llm.ts:1025`) | Sonnet, 400 | small | per recapped question | **persisted & reused** |

**Rough worst-case per-user-day at launch** (thin bank, synchronous build, both bonus slots miss):
~6–8 Sonnet calls (2–4 generation chunks + ≤2 bonus + asides amortized) + **~40–60 Haiku calls**
(4 gates ×1–2 batches, 3×N cold answers + judges, N reconciles, 5–7 grades, breadcrumbs). With warm
bank hit-rates this collapses to ~5–10 Haiku (grading) and 0–2 Sonnet. **Bank hit rate is therefore
the single biggest cost variable** — see C5/B1.

---

## Part 2 — Selection: how questions reach the player

### 2.1 Daily Five core (`fillDailyQueueForUser`, `queue-orchestrator.ts:117-572`)

1. **Authored picks** (`pickEligibleAuthoredQuestions`, `queries/daily.ts:919`): SQL filter
   `publicStatus='eligible_pending'` + `visibility='public'` + domain ∈ viewer's knowledge base +
   not content-reported; over-fetch ×6; **order: `publicEligibilityScore DESC, createdAt DESC`**, then
   TS re-rank by social tier (friend < friend-of-friend < public). Dedup: every past queue slot,
   answered history, anything ever sent via feed. Trust-tier gate (`verification-gating.ts`,
   `FRIEND_FACING_TIERS = human_validated|author_confirmed`) is **shadow-mode only by default**.
2. **House picks** (`pickHouseQuestions`, `queries/daily.ts:1194`): `source='house_authored'`,
   `creatorId IS NULL`, same KB constraint, `createdAt DESC`, same shadow tier gate. (Note: house
   authorship now exists in code — the 2026-06-02 conformance audit's "D-3 UNBUILT" finding is stale.)
3. **Generated** fills the remainder (bank-first → Sonnet, Part 1.1).
4. **Diversity cap:** ≤2 per subcategory (`DAILY_QUEUE_MAX_PER_SUBCATEGORY`), `'often'` domains
   exempt; deflected picks go to a reserve used only for backfill.
5. **N<5 backstop** (`:361-413`): top-up loop, ≤4 rounds within a 45s budget, each round re-runs the
   bank-first + Sonnet path requesting `min(shortfall×2, 10)`; stops early if a round recovers
   nothing. Then reserve backfill; **≥3 slots persists short; <3 throws → 503 (retryable)**. Gates
   are never relaxed to pad the floor.
6. **Difficulty:** per-domain ladder (`userDomainDifficulties`): 2-correct step up / 2-incorrect step
   down; declared domains seed *and* erosion-floor at moderate, demonstrated seed at moderate but can
   erode to accessible (`adaptive-difficulty.ts:210-409`) — conforms to PRD-D-5 D2/D3. There is **no
   batch-level tier mix** (a day can be all-accessible or all-specialist), and **authored/house picks
   carry no difficulty filter at all**.

### 2.2 Drawing from stock: `pickBankSource` (`queries/daily.ts:1449-1514`)

Predicates: exact `canonicalSubcategory` **string equality** (no `domainKey` folding, unlike
`getRecentDomainCounts` which folds precisely because variants leak), exact `difficultyEstimate`
tier, `factKey IS NOT NULL`, `userId <> viewer`, `is_duplicate=false`, not content-reported. Window:
**newest 50, Fisher–Yates shuffled**; first row passing the viewer's fact-key/authored-text avoid
sets wins. Durable (no age exclusion — D8 honored; recency only biases the window). **No ranking by
`trustTier`, `empiricalCorrectRate`, `nAnswered`, or feedback signals.** A serve **inserts a copy row**
for the viewer — and the copy **omits `insideJoke`, `trustTier`, `askToAnswerVerified`,
`acceptableVariants`, `sourceRefs`** (`generate-questions.ts:1566-1581`), so reused questions lose
their aside, their grading variants, and their earned trust tier (copy defaults `unverified`).

### 2.3 The +2 (D-4 §B as amended)

Domains from `getFriendDomainsForBonus` (`queries/friend-presence-domains.ts:208`): across followed
users, merge territory (declared+demonstrated KB) ∪ recent activity per (friend, domain); rank
**both > territory-only > activity-only**, tie-break recency then strength; respects KB-section and
per-domain visibility and the viewer's resting domains; top 2. Fill = bank-first then fresh accessible
generation (Part 1.2); a non-accessible bank pick **shrinks the slot** (belt-and-braces — the bank
query is already accessible-constrained); generation failure shrinks, never routed through the N<5
backstop. Slots carry presence attribution (`presence_source_*`). Conforms to D-4/A-2 as written.

### 2.4 Milestones (Lately) and catch-up — pure reuse, no generation

- **Milestones** (`queries/lately.ts:173`): read-derived from `friend_answered` feed items (correct,
  followed answerers, 30-day window, ≤500 rows), grouped per (friend, domain), deep/breadth split in
  `deriveLatelyMilestones`; click-through serves the **literal** canonical questions (≤5/line), full
  credit via `/api/lately/milestone/answer`, repeat answers score 0. No LLM calls.
- **Catch-up** (`queries/daily.ts:480-702`): 7-day window over (a) unanswered+unskipped past queue
  slots and (b) incorrectly-answered feed items not yet caught up; joined to the stored question rows;
  deterministic ordering + dedup by question id; 7-day expiry. No LLM calls (grading on answer only).

### 2.5 Where selection triggers fresh generation vs. stock — the current line

| Surface | Stock first? | Fresh generation when |
|---|---|---|
| Daily core bot slots | yes (bank per domain+tier) | bank miss per domain; all top-up rounds |
| Daily +2 | yes (accessible bank) | bank miss per domain |
| Authored/house slots | always stock | never |
| Catch-up | always stock (your own missed rows) | never |
| Milestones | always stock (friend's literal rows) | never |
| Pool refill cron | n/a (writes stock) | thin+active domains — **currently disabled** |

---

## Part 3 — Findings

### 3.1 Quality levers (prioritized)

| # | Finding | Effort | Re-audit |
|---|---|---|---|
| **Q1** | **Fan-salience is prompt-only — nothing enforces it.** Rules 1–2 (fan-salience, strip-the-domain) exist only in `SYSTEM_PROMPT`; the Haiku quality gate checks exactly four defect classes and none of them is "generic at moderate/specialist". **Fixed 2026-06-10 (BP-4):** GENERIC_AT_TIER added as a 5th defect class on the existing gate call — judged only at moderate/specialist, never accessible, clear-cut-only, fail-open preserved; per-candidate `tier=` threaded into the gate body (`difficulty_estimate`, the same field serving/scoring use). Plumbing pinned by unit tests; rubric behavior pinned by opt-in live evals (`quality-gate.eval.test.ts`) — **run `npm run test:evals` with a key before relying on the rubric** (not run in the build env, no key). | S–M | 🔁 B2/B4 |
| **Q2** | **The +2 is structurally the most generic slot.** It generates at the `'normal'` hint — *"someone with a passing interest … not deep cuts"* — where fan-salience is explicitly optional, and it's the slot showcased as "from {Name}'s world". The accessible hint string still anchors "passing interest" (the very register PRD-D-5 D4 flagged), softened only at higher rungs. Open product decision (flagged, not resolved): should the +2 target *accessible-but-fan-salient* (Rule 1 required, difficulty easy) rather than plain accessible? | M | 🔁 +2 (D-4 explicitly warns) |
| **Q3** | **Context that would sharpen salience exists but never reaches the prompt:** (a) ~~`domainSkips` is dead code~~ **fixed 2026-06-10** — `getRecentSkipCountsByDomain` (7-day window, domainKey-folded) now feeds the calibration block on the core daily path, pinned by `skip-calibration-prompt.test.ts`. (b) The +2 call passes no territory hint, no sub-angles, no friend-context (`:1481-1493`) — the picker knows the friend's domain strength/recency and discards it (held for the +2-register decision, BP-8). (c) ~~mastery tier/points never reach the prompt~~ **fixed 2026-06-10 (BP-5)** — per-domain tier/points/correct-count ride the existing `getKnowledgeBase` read into a salience-only strength block. (d) ~~cultural anchor never reaches generation~~ **fixed 2026-06-10 (BP-5)** — `getCulturalAnchor` (queries/account.ts) feeds an era/regional salience-only block; both blocks carry explicit never-difficulty framing and are pinned by `prompt-context-signals.test.ts`. | S each | (b) 🔁 +2 |
| **Q4** | **Bank reuse silently degrades quality fields.** The bank-pick copy omits `acceptableVariants` (right-but-rephrased answers get marked wrong again on reused rows — the exact betrayal B4 fixed), `insideJoke` (aside vanishes on reuse), and `trustTier`/`askToAnswerVerified` (earned trust resets to `unverified`, which will mis-gate if/when tier gating flips on). **Fixed 2026-06-10:** `BankSource` now carries `insideJoke`/`trustTier`/`askToAnswerVerified`/`acceptableVariants`/`sourceRefs`/`perishable` and the serving-copy insert persists them; play stats deliberately not copied (accrue per row). Re-audit of the B1/B4 surface still warranted. | S | 🔁 B1/B4 |
| **Q5** | **Selection can't tell good stock from bad.** `pickBankSource` shuffles the newest 50 and serves the first non-repeat — ignoring `empiricalCorrectRate`/`nAnswered` (the D11 "nobody got it" smell is computed but unused here), `trustTier` (gate is shadow-only), and thumbs feedback. A confidently-wrong or dud question recirculates cross-user until reported. Lever: order candidates by trust tier desc, then exclude `empiricalCorrectRate=0 ∧ nAnswered≥5`, then shuffle. | M | 🔁 B1/B4 |
| **Q6** | **The friend-facing trust bar from PRD-D-5 §6 is not enforced.** `VERIFICATION_TIER_GATING_ENABLED` defaults off; authored/house/bank picks serve in shadow mode, so friend-facing surfaces serve `eligible_pending` (one Haiku vet) below `human_validated`, contra the spec's acceptance list ("questions cannot reach friend-facing below human_validated"). This is a deliberate staged rollout, not a bug — but it's an **open product decision** (flip date + promotion threshold N + what % of stock would be filtered; the gate already shadow-logs `wouldFilter` counts to answer that). | S to flip | 🔁 B4 |
| **Q7** | **Tier-split intent isn't enforced at the queue level.** Difficulty floors are per-domain; there's no per-day mix policy, so a queue can be 5 accessible questions on a high-skill day off-domain, and **authored/house picks bypass difficulty entirely** (no filter in `pickEligibleAuthoredQuestions` — already noted as a gap in PRD-D-1's verified-facts table). Open product decision: is a daily tier mix (e.g., floor ≥1 moderate+ for engaged users) wanted, and should authored picks respect the player's per-domain ladder? | M | 🔁 (queue is audited surface) |
| **Q8** | **Repetition leak across tables.** ~~Canonical questions answered via feed sends or milestone click-throughs never enter the avoid lists~~ **fixed 2026-06-10 (BP-6):** `getRecentAnsweredCanonicalTexts` (masteryEvents → questions join, 30-day window, ≤100 rows, `source<>'daily_generated'`, deduped) feeds both generation paths' avoid lists — domain-scoped via domainKey and capped at 25 entries (C3 budget), advisory-only (no gate/persist-guard changes). Pinned by `answered-canonical-avoid.test.ts`. 🔁 avoid-list substrate widened — flag for the next B1–B5 pass. | M | 🔁 B1–B5 |
| **Q9** | **The prompt fights its own exemplars.** Several of the 44 exemplars are wiki-salient by the prompt's own definition ("What is the title of Beethoven's Third Symphony?", "most famous opera house in Venice", "main character's name in Metroid") — fine as accessible-floor models, but they're presented unconditionally as the register to mimic, and the quality gate explicitly whitelists their styles. Tension between the curated founding set and Rule 1 at moderate+. **Open product decision** — the set is product-owner-curated; options are tier-tagging exemplars or trimming, not silently editing. | S–M | 🔁 B2 |

### 3.2 Cost levers (prioritized)

| # | Finding | Effort | Re-audit |
|---|---|---|---|
| **C1** | **Cron scheduling is split across Vercel and GitHub Actions, with two sharp edges.** `daily-assignments` *is* scheduled — 17:05 UTC via `.github/workflows/external-crons.yml` (sole scheduler by design; removed from `vercel.json` 2026-05-30 to avoid double-SMS) — so the pre-build fan-out runs; only the route comment is stale. The edges: **(a) the workflow curls the one non-idempotent route with `--retry 2 --retry-all-errors --max-time 300`** (`external-crons.yml:86-89`) while the route's `maxDuration` is also 300 and it sends SMS/email **even for `existing` queues** (`daily-assignments/route.ts:91-99`) — a client-side timeout with the function still running retries the run and re-texts every already-processed user, exactly the double-send the 2026-05-30 change tried to prevent. **Fixed 2026-06-10:** the nudge is now gated on the invocation having freshly built the queue, making the route retry-safe (route.ts + workflow header note). **(b) `pool-refill` is the only cron left solely on Vercel Hobby best-effort scheduling** — the unreliability the workaround exists for. Moot while retrieval is off (C6); add it to the workflow when C6 flips. | S | — |
| **C2** | **Per-batch LLM fan-out is wide:** 4 separate Haiku gate calls + 3×N cold answers + judge + N Sonnet asides + N Haiku domain-reconciles per generation batch. Mergeable: the 4 gates share input format and could be 1–2 calls with a combined rubric (also gets Q1's fan-salience check for free); asides are paid even for rows ask-to-answer drops (sequence aside *after* the verdict, or only for rows that will actually serve); ~~`reconcileProposedDomain` is per-row but keyed only on (domain, userId) — memoize per batch~~ **memoized per batch 2026-06-10**. | S–M | 🔁 B4 (gates) |
| **C3** | **Oversized, repeated user prompt:** ~4–6k tokens of avoid lists (80 texts + 200 fact keys) resent verbatim in *every* chunk and *every* top-up round, uncached. The code itself calls the prompt list "advisory" — the Haiku history gate + persist-time fact-key guard are the enforcement. Levers: trim prompt lists to entries relevant to the chunk's domains; or move the stable avoid block into a cached system segment; or cut limits (80→30 / 200→80) and lean on the gates. | M | 🔁 B2 |
| **C4** | **No Message Batches API** anywhere, yet three workloads are batch-shaped with no latency requirement: the daily pre-build fan-out (C1), `vet-questions` cron, pool refill. 50% token discount + smoother rate limits. (Per-user on-demand builds must stay synchronous.) | M | — |
| **C5** | **Bank hit rate is depressed by exact-match predicates:** raw string equality on `canonicalSubcategory` (no `domainKey` fold — spelling variants like "90's Hip-Hop"/"90's Hip-Hop" miss stock the repo elsewhere folds for precisely this reason), exact difficulty-tier match (no adjacent-tier fallback even when the floor allows it), `factKey IS NOT NULL`, 50-row window. Every miss is a full Sonnet pipeline. Folding domains alone is cheap and safe; tier-adjacent fallback needs a floor-respecting rule (small design). | S–M | 🔁 B1 |
| **C6** | **Retrieval-grounded refill is built, capped at $2/day, and OFF** — so thin domains refill at retail (per-user, ungrounded, unprovenanced Sonnet) instead of wholesale (batched, corroborated, `machine_verified`). Same for Voyage embedding dedup (key not provisioned): the paid path runs while the cheap dedup backstop is off. **Open operational decisions:** provision `VOYAGE_API_KEY`, `RETRIEVAL_SYSTEM_USER_ID`, flip `RETRIEVAL_GROUNDING_ENABLED`. | S (flip) | — |
| **C7** | **Sonnet on categorization-flavored calls,** against the CLAUDE.md split (Haiku for grading/categorization): `categorizeQuestion`, `suggestTags`, `resolveCanonicalSubcategoryWithLLM`, `cleanQuestion`, `assessQuestionDifficulty` are all Sonnet. Authoring-path volume is low today, so this is a measured-swap candidate (CLAUDE.md: don't swap without measuring), not an urgent leak. | S–M each, after eval | — |
| **C8** | **Over-request surplus pays full verification:** the ×2 over-request runs asides + ask-to-answer + reconcile on all candidates, then trims. Surplus rows do land in the bank (future value), but a lazy option — verify/aside on first *serve* for surplus rows — would shift that spend to questions that actually surface. | M | 🔁 B4 |
| **C9** | **Prompt cache coverage — resolved as correctly-shaped (2026-06-10):** the generation system block (~3–4k tok) is cached and clears Sonnet 4.6's 2048-token minimum; it earns during the 17:05 fan-out. The Haiku gates are **deliberately uncached**: `claude-haiku-4-5`'s minimum cacheable prefix is **4096 tokens** and every gate system prompt (quality gate ~2k, the rest smaller) is under it — a marker would be a silent no-op (verified against the prompt-caching reference). Documented in code at the `callLlmOnce` cache comment; the stale "1024-token threshold / ~1500 tokens" comment corrected. Gate caching only becomes viable if gates are merged (deferred C2) and the merged prompt clears 4096. | — | — |

### 3.3 Generation-vs-selection balance (prioritized)

| # | Finding | Effort | Re-audit |
|---|---|---|---|
| **B1** | **The biggest combined win is making the pool the primary source and per-user generation the true backstop.** All the pieces exist (durable pool, trust tiers, empirical rates, refill cron, embedding dedup) but the operating point is inverted: refill and embeddings are off (C6), bank predicates leak hits (C5), bank selection is quality-blind (Q5), and reuse strips quality fields (Q4). Fixing those four together shifts the line decisively toward verified, ranked reuse — better questions *and* an order-of-magnitude fewer Sonnet calls per user-day at launch scale. | L (composite) | 🔁 B1/B3/B4 |
| **B2** | **Top-up rounds regenerate before exhausting stock.** Rounds 2–4 of the N<5 backstop re-enter the full bank-then-Sonnet path per domain, but a round that fails on its chosen domains never tries *other* eligible KB domains' bank stock or an adjacent difficulty tier before burning another Sonnet round with the full avoid-list prompt (C3). A "stock-sweep before round 2" step is a contained change. | M | 🔁 (orchestrator) |
| **B3** | **Surfaces that correctly never generate:** catch-up, milestones, authored/house slots. No change wanted — preserve this in any refactor (D-4's de-dup-by-construction depends on milestones staying literal). | — | — |
| **B4** | **The +2's bank-first is right but its shrink rule wastes a slot in one edge:** a non-accessible bank pick nulls the slot *without* falling through to Sonnet ("the bank answered" — `generate-questions.ts:1475-1478`). The bank query is accessible-constrained so this should be rare; if shrink telemetry shows it firing, the deliberate trade (slot loss vs. one Sonnet call) is an open product call, currently decided toward cost. | S (telemetry first) | 🔁 +2 |
| **B5** | **Asides: generated fresh per question, lost on reuse** (Q4). The current line — generate-once-at-creation — is the right cost shape; it just needs the copy to carry it. If Option B (aside amplifies human `creatorNote`, `PRD-D-0` §5) lands, that's the moment to revisit aside provenance wholesale. | S | — |

---

## Part 4 — Open product decisions (flagged, not resolved)

1. **Flip `VERIFICATION_TIER_GATING_ENABLED`?** The PRD-D-5 acceptance bar (friend-facing ⇒
   `human_validated`) is shadow-only. Needs: promotion-velocity read from the shadow `wouldFilter`
   logs, and the `human_validated` threshold N (spec recommends 3-correct).
2. **Enable retrieval grounding + Voyage embeddings** (`RETRIEVAL_GROUNDING_ENABLED`,
   `RETRIEVAL_SYSTEM_USER_ID`, `VOYAGE_API_KEY`) — spend posture is pre-capped ($2/day default).
3. **+2 register:** accessible-only as today, or accessible-with-fan-salience-required? And should
   friend territory context shape the *content* of the +2 question, not just the domain?
4. **Daily tier mix:** should the five carry a difficulty-mix policy, and should authored/house picks
   respect the player's per-domain ladder (they currently bypass difficulty entirely)?
5. **Exemplar curation:** tier-tag or trim the wiki-salient exemplars vs. Rule 1 (product-owner set —
   needs owner sign-off, not a code decision).
6. **`name_multiple`:** still held back pending multi-answer grading; decide whether to build grading
   support or drop the shape from the prompt.
7. ~~**`daily-assignments` scheduling**~~ — **resolved 2026-06-10:** scheduled at 17:05 UTC via GitHub
   Actions (`.github/workflows/external-crons.yml`), its sole scheduler by design. Residual items
   folded into C1 (retry-vs-SMS edge; pool-refill left on Vercel Hobby).
8. **Backstop posture below 3 slots** stays 503-and-retry (never relax gates) — reaffirm or revisit
   at launch traffic.

## Part 5 — Doc/repo hygiene noted in passing

- `joshing-SESSION-HANDOFF.md` referenced in the task does not exist in-repo.
- `src/app/api/cron/daily-assignments/route.ts` comment says "Scheduled at 17:05 UTC (vercel.json)" —
  the schedule is real but lives in `.github/workflows/external-crons.yml` (moved 2026-05-30); update
  the parenthetical so the next reader doesn't repeat this audit's detour.
- `generate-questions.ts:843` "~1500 tokens" system-prompt comment is a material undercount.
- The 2026-06-02 conformance audit's "house author UNBUILT" (§3.1) and `DECISIONS.md`'s matching open
  item are stale — `source='house_authored'` + `pickHouseQuestions` + a house smoke script now exist.
- `domainSkips` threading in `generate-questions.ts` is dead code until a caller populates it (Q3a).
