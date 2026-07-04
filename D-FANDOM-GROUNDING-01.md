# D-FANDOM-GROUNDING-01 — Reference-Wiki Grounding for Generation & Validation

**Status:** ✅ **RATIFIED + IMPLEMENTED (flag-off)** — 2026-07-03, Josh, in chat.
Ratified set: **A2 + B2 + C(grounding-only) + D1-now/D2-later + E(per-domain daily) + F1.**
Originally drafted on `dev2` against pre-#1364 code; implemented on
`claude/cost-scaling-review-gb93a3` (PR #1364) against the post-refactor seams —
the doc's original code references (e.g. `verify-question.ts` L122–123) are
superseded by the implementation map below.

## Implementation map (what shipped, all default-OFF)

| Piece | Where | Flag |
|---|---|---|
| Retrieval layer + per-domain daily cache (E) | `src/server/daily/domain-reference.ts`, `src/server/db/queries/domain-reference.ts`, `DomainReferencePassage` (migration **0108**) | rides Consumer A's flag |
| Consumer A — generation reference anchor (A2 soft preference, B2 provenance-distinct block) | `buildUserPrompt` reference block + fetch at the post-bank/post-guard call site in `src/server/daily/generate-questions.ts` | `GENERATION_WIKI_ANCHOR_ENABLED` |
| Consumer B — verifier source allowlist (F1) | `buildVerifyRequestParams` in `src/server/quality/verify-question.ts` — reaches BOTH sync and Batch-API verify modes through the shared builder | `VERIFY_WEB_SEARCH_ALLOWED_DOMAINS` (e.g. `wikipedia.org,fandom.com`) |
| Decision C guard — passage prose never persisted into a served question | `questionLeaksPassageText` filter applied before the generation gates | always-on when A is on |
| Telemetry | retrieval ledgered under scope `domain-reference` (tokens + `web_search_requests`, 0105) | — |

**Notes vs. the original draft:**
- The **self-consistency loop** maps onto Consumer B rather than a separate build:
  with the allowlist on, the demote-only batch verifier re-grounds every generated
  question against the same tiered sources that anchored it. No auto-correct,
  `needs_review` only — authority unchanged.
- **Feeding the passage to the generation-time FACTUAL_GATE** (the doc's
  "optionally also"): deferred — the gate is batched across domains and passage
  context would multiply its input tokens; revisit if verifier catch-rate says
  the gate needs it.
- Source tiering + Fandom section-scoping (Trivia / Behind-the-Scenes /
  production / speculation excluded) live in the retrieval system prompt (the
  D1 limitation the doc names — prompt-level scoping, not parser-level; D2 is
  the upgrade path if fanon shows up in passages).
- Retrieval model defaults to the generation tier (`ANTHROPIC_MODEL`), env-
  overridable via `DOMAIN_REFERENCE_MODEL` — retrieval quality is the
  load-bearing risk; one cached call per (domain, day) keeps the delta small.
- Cold-start spend is capped per run (`DOMAIN_REFERENCE_MAX_FETCHES_PER_RUN`,
  default 4); the cache warms over a few runs to ~one retrieval/domain/day
  org-wide.

## Flip order (one lever per surface — see the cost-plan sequencing)

1. Batch-verify Batch API flip completes its clean observation window first
   (`BATCH_VERIFY_ASYNC_ENABLED` — shares the verify surface and its metrics).
2. **Consumer B** (`VERIFY_WEB_SEARCH_ALLOWED_DOMAINS`) — decision-independent,
   cost-neutral, quality lever. Watch metric: `unverifiable` verdict rate; a
   spike on non-wiki-shaped domains = the F1→F2 loosen trigger.
3. **Consumer A** (`GENERATION_WIKI_ANCHOR_ENABLED`) — size the investment after
   `D-SUPPLY-FINITE-SET-01`: under finite-set + human curation, A's value
   concentrates on whatever the machine floor still generates. Watch metrics:
   the factual-gate drop rate and verifier demote rate on anchored domains
   (should FALL), `domain-reference` scope cost (bounded by cache + cap).

## Original decision record

*(as drafted on `dev2`; decisions A–F now ratified per the header)*

**Problem.** The daily generation pipeline generates every question via LLM; the
only per-domain ground truth is up-to-3 admin-authored examples, inert for any
domain no admin has seeded. The deep-specialist ~100%-miss domains (Spy School
Books, Tears of the Kingdom, Tennis) are precisely the unseeded ones — so where
fabrication risk is highest, the LLM generates from unanchored recall. Reference
wikis (Wikipedia, Fandom) have dense structured coverage of these exact domains.

**Framing correction.** A retrieved wiki passage is not a new content tier — it
is a better anchor for a generation step that already exists and currently runs
blind. These remain machine-authored questions and must never render as from a
person; provenance stays machine-honest.

**Design: one retrieval layer, two consumers.** Consumer A: passage sits beside
the authored-examples anchor as a soft grounding block. Consumer B: the same
source allowlist constrains the batch verifier's web-search fallback
(`allowed_domains` is a native hook). Self-consistency: an answer that can't be
re-grounded in the source that seeded it flags `needs_review` — demote-only,
never auto-correct.

**The load-bearing risk.** Retrieval quality is the whole ballgame: a wrong or
fanon passage produces a confidently-wrong anchor AND a verifier that
rubber-stamps it, because both read the same bad source. Source tiering +
section-scoping matter more than anything else here.

**Source tiering (asymmetric authority).** 1. Wikipedia — primary anchor.
2. Fandom — earns its place only where Wikipedia thins out; canon sections only
(never Trivia / Behind the Scenes / Speculation / production). 3. Neither covers
→ the domain stays unanchored (status quo). If only Fandom supports a borderline
answer, that is a `needs_review` flag, not a confident pass.

**Ratified decisions.**
- **A2** — the prompt instructs "prefer facts present in the reference passage"
  (soft anchor, not a span constraint).
- **B2** — the passage is a parallel, provenance-labeled block, distinct from
  authored examples (trusted human canon vs. unvetted retrieved reference).
- **C** — grounding-only posture (CC-BY-SA): passage text is never persisted
  into a served question; enforced by a substring guard on generated
  question_text.
- **D1 now** — reuse `web_search_20250305` with `allowed_domains` for retrieval
  and verification; **D2** (dedicated fetch+parse layer with real
  section-scoping) deferred until drift/fanon shows up.
- **E** — retrieve once per (domain, day); both consumers read the cache.
- **F1** — hard verifier restriction to Wikipedia + Fandom to start; loosen to
  F2 (precedence ordering with general-web fallback) only on a measured
  uncovered-domain gap.

**Explicitly out of scope / DO-NOT.** No strict extractive-constraint pipeline
(option-2, deferred). No provenance change: wiki-anchored questions stay
machine-authored and never render as from a person. Verifier stays demote-only;
wiki grounding never auto-corrects an answer. Never persist source passage text
into a served question. Fandom is never a sole confident grounding for a
borderline verifier call.
