# D-5 — Question Quality, Difficulty Floor & Verification (SPEC)

**Synthesis spec v1** · feeds PRD / governing spec · precedes build prompts (B1–B4)

This is the *synthesize* stage: it locks the design decisions reached in conversation and grounds them in the audited codebase so build prompts can be written without re-litigating anything. It is not itself a build prompt.

-----

## 1. Problem

Two issues, originally tangled, now separated — plus a third the audit surfaced:

1. **Register / quality.** Generated questions don’t reliably hit the founding-set tone; too many are recognition-trivia (“what year…”).
1. **Volume in narrow domains.** The model runs dry in hyper-specific domains — repeating, reaching, or fabricating once the obvious facts are gone.
1. **Unguarded correctness.** Answer correctness is essentially unverified; the one check fails open. A confidently-wrong question is the on-thesis betrayal — it marks the player who *actually knew* the topic wrong, inverting “wrong answers are connection events.”

The core finding: #1 and #2 share a root cause (an over-low difficulty floor), and #3 must be fixed *with* the floor change, because raising difficulty walks generation straight into the model’s hallucination zone.

-----

## 2. Root cause — what the audit established

Anchors for the builder (verify line numbers at build time):

- **The exemplars already ship.** All 34 founding questions are in the live prompt (`exemplars.ts` → `generate-questions.ts` system prompt and quality gate). Quality is *not* a missing-few-shot problem.
- **The difficulty hint fights the exemplars.** `mapAdaptiveLevelToDifficultyHint` (`adaptive-difficulty.ts`) hardcodes hint text; `normal` → a 0.78 *“casually interested person”* instruction that pulls generation below the exemplar register.
- **The floor is too low and source-blind.** `applyFocusFloor` / `FOCUS_DOMAIN_MIN_DIFFICULTY = 'moderate'` only floors *first contact*, only under `adaptive` mode, and the `territoryType: declared | demonstrated` signal (`daily.ts`) never reaches the prompt or difficulty.
- **The prompt teaches the anti-pattern.** Its own GOOD example is a year question; `year_or_date` is an offered shape; the PRD’s “avoid what-year trivia” rule was never added.
- **Correctness is unguarded.** The stored answer is the model’s own output (temp 0.8). The only check is a fail-open Haiku gate that treats “unverifiable” as OK and returns nothing on error. No grounding, no retrieval.
- **`acceptable_variants` was never built** — a right-but-rephrased answer gets marked wrong.
- **Embedding dedup was never built** — dedup is `fact_key` strings + Haiku + normalized text.
- **A cross-user bank already exists** — `generatedQuestions`, 30-day window, bank-first then regenerate. The seed of the pool.

-----

## 3. Shape of the solution — three interlocking parts

```
        ┌─────────────────────────────────────────────┐
        │                  THE POOL                    │
        │  durable, no decay, unified (machine+human)  │
        │  trust-tiered · scoped · embedding-deduped   │
        └───────────────▲───────────────▲─────────────┘
                        │ populates      │ writes trust
            ┌───────────┴──────┐  ┌──────┴───────────────┐
            │   THE FLOOR      │  │   VERIFICATION       │
            │ signal-keyed     │  │ retrieval-grounded   │
            │ difficulty +     │  │ generation →         │
            │ register fixes   │  │ ask-to-answer →      │
            │                  │  │ human-play           │
            └──────────────────┘  └──────────────────────┘
```

Three load-bearing ideas:

- **The pool makes verify-once-reuse-many affordable.** Retrieval + verification are paid *once* per question and banked forever; every future draw inherits the trust. Without a durable pool, first-cut retrieval would be too costly to run per serve.
- **Raising the floor *expands* usable territory.** An accessible floor forces the model to manufacture trivia from a tiny fact set; an enthusiast floor opens a far larger answerable set. The floor change is also a volume fix.
- **Retrieval prevents; the floor expands; play calibrates.** Retrieval-grounding stops hallucination at the source *and* refills thin domains (the original volume complaint), closing the loop back to the problem we started with.

-----

## 4. Decision ledger

|#  |Decision                                                                                                  |Status|
|---|----------------------------------------------------------------------------------------------------------|------|
|D1 |Treat register and narrow-domain volume as distinct problems                                              |Locked|
|D2 |Difficulty floor scales with signal strength (declared > demonstrated)                                    |Locked|
|D3 |“Halfway” floor: declaring buys a head start, not the ceiling; depth inferred from play                   |Locked|
|D4 |Fix what the prompt teaches (hint register, year example, `year_or_date`, trivia-of-trivia rule)          |Locked|
|D5 |Floor and verification ship together                                                                      |Locked|
|D6 |Verification stack: retrieval-grounded generation (first cut) → ask-to-answer → human-play                |Locked|
|D7 |A durable pool is the substrate (evolve `generatedQuestions`)                                             |Locked|
|D8 |No decay; evergreen/perishable flag instead                                                               |Locked|
|D9 |Authored questions public-by-default + to friends; attribution full-to-friends / display-name-to-strangers|Locked|
|D10|Build embedding dedup now; unified pool; human beats machine on collision                                 |Locked|
|D11|Empirical human correct-rate overrides the model’s difficulty estimate; feeds the floor                   |Locked|
|—  |Source strategy: open web + trust layer (corroboration + reputation ranking), not a curated corpus        |Locked|

-----

## 5. Component specs

### 5.1 The Pool (substrate) — D7, D8, D9, D10

**Evolve `generatedQuestions` into a durable, unified pool.** Fold human-authored questions (`QUESTIONS` table) and machine-generated questions into one selectable reservoir (kept as separate tables joined at selection, or unified — builder’s call; the *selection layer* must treat them as one pool).

Data-model deltas (per pooled question):

- `trust_tier` — enum: `unverified` → `machine_verified` → `human_validated` → `author_confirmed` (§6).
- `scope` — enum: `friends_only` | `public` (D9). Machine-generated default `public`; human-authored default `public` with a one-tap `friends_only` override at authoring.
- `origin` / `author_id` — null for machine; set for human. Drives attribution.
- `perishable` — bool (D8). Evergreen by default; perishable facts (time-relative: “the latest…”, “who currently…”) are flagged for periodic re-grounding or held out of the durable pool.
- `source_refs[]` — provenance from retrieval (§5.3).
- `empirical_correct_rate` / `n_answered` — feeds D11 and the “nobody got it” smell.

**No decay (D8).** Nothing ages out. Safe because per-user repetition is already prevented by the avoid-list (`recent_questions` / `recent_fact_keys`), and content is overwhelmingly evergreen. Drop the 30-day window as an *expiry*; recency may still inform ranking but never deletion.

**Scope & attribution (D9).** “Public” = playable by other Joshing members, **not** the open web. Authored questions are public by default and signposted at authoring time (“others will be able to play this”). Attribution: **full identity to friends; display name to strangers.** The existing personal/biographical redirect (answer-suggestion `personal` type) now does privacy work, not just quality work — keep it firmly in force.

**Dedup (D10) — build embeddings now.** Replace fact_key-only dedup with an embedding near-duplicate check spanning the *unified* pool. Collision rule: **a human-authored question beats a machine near-duplicate** (higher trust, real voice); the machine version is suppressed.

### 5.2 The Difficulty Floor — D2, D3, D4, D11

**Pass the signal into the prompt and difficulty.** Thread `territoryType` (declared | demonstrated) from `daily.ts` through `buildUserPrompt` and the difficulty mapper. Today it only affects domain *selection* (`DECLARED_DOMAIN_WEIGHT`); it must now affect the *floor* and the prompt instruction.

**Halfway mechanic (D3).** Declaring buys a head start, not the ceiling:

- **Demonstrated domain** → starts low, climbs normally.
- **Declared domain** → starts mid-ladder (engaged-fan rung), with a new **enthusiast rung** open above. Right answers climb into enthusiast/specialist; wrong answers settle within a band but a **hard floor** keeps it off tourist level. Depth is inferred from play — **no onboarding depth question.**
- Make the declared hard floor **partially erodable**: it can move within the upper band but cannot drop to accessible. (Today `applyFocusFloor` only floors first contact and the two-incorrect step-down can erode it; change that for declared domains.)

**The enthusiast rung — definition is the guardrail.** Add a rung above the current ceiling in `mapAdaptiveLevelToDifficultyHint`. Define it as *“what someone who chose to learn this would know — the structure, the famous moments, the second-order facts — not what a scholar or archivist would know.”* This definition is what prevents a swing back to “really REALLY hard.” (Calibration example to bake in — Well-Tempered Clavier: *below floor* = who composed it / key of the first prelude; *enthusiast floor* = the two books of 24, what “well-tempered” refers to, the C-major prelude behind Gounod’s Ave Maria; *above* = five-voice fugues, manuscript variants.)

**Fix what the prompt teaches (D4).**

- Rewrite the difficulty-hint strings so they anchor to the engaged-fan / enthusiast register, not “casually interested person.” (This is the shared lever between D3 and D4.)
- Demote the year-question GOOD example; use a substance-over-recall exemplar (the “what does Sally Seton represent” style already present).
- Keep `year_or_date` available but instruct: use only when the date itself is meaningful, never as a default.
- Add the trivia-of-trivia rule: prefer “what is X / why does X matter” over “what year / what number / what label.”
- *Open knob:* how hard to suppress dates (see §7).

**Empirical difficulty override (D11).** Once a question has real human correct-rate, that beats the model’s `difficulty_estimate` and feeds back into floor calibration. The pool teaches the floor what is actually easy — the loop that makes the floor self-correcting.

### 5.3 Verification & Generation (fused) — D5, D6, source strategy

Generation and verification partly merge: retrieval-grounded generation writes *from* sources, so the floor’s prompt work (§5.2) now operates on retrieved context, not a bare domain label. The stack, top to bottom:

**1) Retrieval-grounded generation (first cut, prevention).**

- The model writes questions *from* retrieved source material; the answer is anchored to the source, not parametric memory.
- **Source strategy: open web + trust layer, not a curated corpus.** Domains are unbounded and idiosyncratic; a corpus dies on coverage, and coverage gaps are exactly where the model falls back to memory and hallucinates. The trust layer:
  - **Corroboration** (the ask-to-answer principle applied to sources): a fact must appear in **≥2 independent, reputable sources** to anchor a question. Single-source facts are dropped.
  - **Reputation ranking:** prefer editorially-accountable sources (Wikipedia-with-citations, Britannica, .edu, institutional/primary); exclude known junk.
  - **Provenance:** store `source_refs[]`; the explainer becomes source-backed, not model-asserted; gives an audit trail for disputes.
- **API tooling:** Anthropic Messages API **server-side web search tool** (current `web_search_20260209`; prior `web_search_20250305`), runs inside the generation call, Claude-driven, returns citations natively (= provenance), `max_uses` caps searches/request, ~$10/1k searches + tokens, admin-enabled in Console. Pair with the **web fetch tool** to pull a specific source. Model `claude-sonnet-4-6` supports it. Ref: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>
- **Residual risk — AI-contaminated / circular sources:** sites copying the same wrong AI-generated “fact” can falsely corroborate. Mitigate by weighting toward editorially-accountable / pre-AI-authority sources, requiring *independent* (non-mirror) corroboration, and leaning on human-play as the final backstop.

**2) Ask-to-answer (secondary net).** Strip the answer, send the question *cold* to a separate call (ideally a different model) 2–3×, compare. Agreement with each other and the stored answer → pass; disagreement → drop. Catches the model misreading its own retrieved source. (Note its blind spot — *stable* hallucinations — is covered by retrieval above.)

**3) Human-play promotion (calibration + ground truth).** Trust climbs with real play: `machine_verified` → `human_validated` after N correct answers. The inverse is a signal: a question *nobody* in the domain gets right is a hallucination smell, not a hard question — flag for review/demotion. Surfaces the existing “Nobody got this” view as a QA signal. Free; uses stored history.

**Cheap knobs.**

- Generate/derive the **answer at low temperature** (0.8 is fine for question variety, too loose for facts).
- **Fail by stakes, not uniformly:** fail-open for self-practice (low cost), fail-closed for friend-facing (a wrong question to a friend is a broken promise). *Cross-reference:* the known grading-fails-to-“wrong”-on-outage behavior is the same fail-in-the-brand-safe-direction principle — align it in the same pass.
- **Build `acceptable_variants`** so a right-but-rephrased answer isn’t marked wrong (the smaller betrayal in the same family).

**Deferred (not first cut):** enthusiast-as-verifier (one-tap “you know this — is it right?”). Retrieval covers its safety purpose; it reverts to optional relational enrichment.

-----

## 6. Trust tiers & surface eligibility (connective tissue)

|Tier              |Earned by                                       |Eligible surfaces                                  |
|------------------|------------------------------------------------|---------------------------------------------------|
|`unverified`      |freshly generated, pre-checks                   |none (internal only)                               |
|`machine_verified`|retrieval-corroborated + ask-to-answer agreement|self-practice (Daily Five)                         |
|`human_validated` |N humans correct in play                        |friend-facing, Convergence                         |
|`author_confirmed`|human-authored, answer asserted by author       |friend-facing (author’s graph); public per D9 scope|

Source quality modulates entry: a well-corroborated, authoritative-source question enters at `machine_verified`; a thinly-sourced one is held back until human play. The big global machine pool therefore starts lower-trust on average and leans on machine-verification to earn its way up; the friend-scoped authored content is higher-trust but less-shared — which mirrors the real social structure (you trust your friends’ questions more).

-----

## 7. Open spec-level knobs (recommended starting values, server-configurable)

|Knob                               |Recommended start                            |Notes                          |
|-----------------------------------|---------------------------------------------|-------------------------------|
|Corroboration count                |2 independent reputable sources              |raise if contamination shows up|
|Source reputation seed list        |curated allow/deny seed                      |expand empirically             |
|Ask-to-answer samples / agreement  |3 samples, require unanimous + match stored  |tune for cost vs strictness    |
|`human_validated` threshold N      |3 correct (with ≥1 wrong tolerated)          |watch promotion velocity       |
|“Nobody got it” smell threshold    |0% correct over ≥5 domain-holders            |flag, don’t auto-delete        |
|Enthusiast rung definition         |text in §5.2                                 |the calibration guardrail      |
|Date-suppression aggressiveness    |prefer-substance, dates only when meaningful |don’t ban dates                |
|Declared start rung / erosion floor|start engaged-fan; floor cannot drop below it|                               |
|Answer temperature                 |low (≈0.2)                                   |separate from question temp    |
|Perishable refresh cadence         |re-ground on serve if older than X           |or hold out of durable pool    |

-----

## 8. Suggested build phasing (one B-prompt each)

Dependencies: verification needs the pool’s trust tiers; retrieval feeds the pool’s entry tier; the floor depends on nothing new.

- **B1 — Pool substrate.** Durable (drop expiry), trust-tier + scope + perishable + source_refs + empirical-rate fields, embedding dedup, human-beats-machine collision, unified selection layer. *Ship first; everything else writes into it.*
- **B2 — Difficulty floor + register.** Thread `territoryType` into prompt + difficulty; add enthusiast rung + partial-erosion floor; rewrite hint strings; demote year example / gate `year_or_date`; add trivia-of-trivia rule.
- **B3 — Retrieval-grounded generation + provenance.** Web search tool inside generation; corroboration + reputation ranking; write `source_refs`; source-backed explainer.
- **B4 — Verification stack.** Ask-to-answer gate; human-play promotion + “nobody got it” flag; low-temp answer; fail-by-stakes; `acceptable_variants`; surface gating by tier; D11 empirical override.

-----

## 9. Out of scope / explicit do-not (guardrails)

- **No leaderboards of any kind** (hard product constraint).
- **No curated source corpus** (rejected on coverage — D-source).
- **No onboarding depth question** (depth is inferred from play — D3).
- **No silent global pooling of authored questions** — public is signposted, with a friends-only override (D9).
- Enthusiast-as-verifier, full Friend-Play / gifting reuse: **Phase 2**, not this spec.
- Don’t add tables/fields beyond those named here without flagging.

-----

## 10. Acceptance (“Done When”)

- [ ] Pool is durable (no expiry), unified at selection, embedding-deduped, with trust/scope/perishable/provenance/empirical-rate fields populated.
- [ ] Declared vs demonstrated reaches both the prompt and the difficulty floor; declared domains start at engaged-fan and cannot erode to accessible.
- [ ] Difficulty-hint strings, the GOOD example, and `year_or_date` no longer model recognition-trivia; trivia-of-trivia rule present.
- [ ] Generation is retrieval-grounded with ≥2-source corroboration and stored provenance; explainer is source-backed.
- [ ] Ask-to-answer gate live; questions cannot reach friend-facing below `human_validated`; “nobody got it” flags for review.
- [ ] Answer derived at low temp; verification fails closed for friend-facing; `acceptable_variants` honored in grading.
- [ ] Empirical correct-rate overrides `difficulty_estimate` and feeds the floor.
- [ ] No leaderboard, no curated corpus, no onboarding depth prompt introduced.
