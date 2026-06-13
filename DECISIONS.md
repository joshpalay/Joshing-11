# Decisions & Docs Index

A short index of the durable restructure (D-1 / D-2 / D-3 / D-4 / D-5) documentation, and — critically — a
pointer to what is **settled** vs. **still open**, so the next reader doesn't re-litigate closed
decisions or miss the live thread.

The `PRD-D-*` series **is the current product canon** (the "v12 line") and supersedes the 10.25/v11.x PRDs.
The older specs are archived under `_docs/archive/` for history: `PRD-v11.2.md` (the last v11 diff, with
v11.3 / v11.4 / v11.5 folded in place — there is no standalone v11.3+ file), `PRD-v11.1.md`, `PRD11.md`,
and `Joshing_PRD_v10_25 (1).md`.

Last updated: 2026-06-11 (D-HOME-PACING-01 aligned — Home page pacing & budget model; see Open below).

## Durable docs

| Doc | What it is |
|-----|------------|
| [`PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md`](./PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md) | Canonical "what the product is and why": target capabilities, deferred items, open hypotheses, **amended decisions**. |
| [`PRODUCT-CANON.md`](./PRODUCT-CANON.md) | Designer-facing product canon: problem, emotional journey, loops, screens, principles, exclusions, evaluation checklist, recent changes, and open product questions. |
| [`PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md`](./PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md) | Spec — directional follow + Feed/Daily split. |
| [`PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md`](./PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md) | Spec — niche-match discovery engine. |
| [`PRD-D-3-HOUSE-EDITORIAL-AUTHOR-SPEC.md`](./PRD-D-3-HOUSE-EDITORIAL-AUTHOR-SPEC.md) | Spec — house / editorial author (**unbuilt**). |
| [`PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md`](./PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md) | Spec — Lately skill milestones + the +2 reframe (fresh questions from friend territory ∪ activity). |
| [`PRD-D-5-QUESTION-QUALITY-FLOOR-VERIFICATION-SPEC.md`](./PRD-D-5-QUESTION-QUALITY-FLOOR-VERIFICATION-SPEC.md) | Synthesis spec — question quality, the difficulty floor, and the verification stack (durable pool + signal-keyed floor + retrieval-grounded generation). Precedes build prompts B1–B4. |
| [`audits/2026-06-02-restructure-conformance-audit.md`](./audits/2026-06-02-restructure-conformance-audit.md) | Read-only conformance audit of the shipped code against the specs (D-1 / D-2 / D-3). |
| [`audits/2026-06-02-d4-plus2-reframe-reaudit-findings.md`](./audits/2026-06-02-d4-plus2-reframe-reaudit-findings.md) | Read-only re-audit of the D-4 +2 reframe against shipped code. |
| [`D-HOME-PACING-01.md`](./D-HOME-PACING-01.md) | Spec — Home page pacing & budget model (edition-not-log, serve-and-overflow, empty-state floor). **Aligned, not yet sequenced into build prompts** — read-and-ratify before any B-prompt is written. |
| [`_docs/D-FEED-FRIEND-ACTIVITY-01.md`](./_docs/D-FEED-FRIEND-ACTIVITY-01.md) | Spec — recast "From Friends" from a topic-grouped 30-day mastery summary into a **chronological activity log** (context-routed burst grouping, held-singles, static cards). **Agreed in discussion, not yet built**; supersedes the deep/breadth domain grouping of `PRD-D-4` §A. |

Execution scaffolding (kept separate, not product spec): [`docs/build-prompts/`](./docs/build-prompts/).

## Settled decisions (don't re-open without cause)

- **Directional follow is the primitive.** Symmetric friendship replaced; "friend" = mutual follow. (`PRD-D-1` Decision 1.)
- **Authored-vs-curated provenance is honest.** Forwarded LLM questions get `creatorId: null`, `source: 'curated_sent'`; credit never accrues to the forwarder. (Conformance audit §2.1.)
- **Send difficulty travels with the question.** The forwarded question keeps its own `difficultyEstimate`. (`PRD-D-0` §4.1.)
- **Broadcast rolls off after unfollow — won't fix.** Already-surfaced broadcasts are not retroactively purged on unfollow. (`PRD-D-0` §4.2.)
- **Question quality = floor + verification, shipped together.** The register/quality and narrow-domain-volume problems share one root cause (an over-low difficulty floor), and the unguarded-correctness problem must be fixed *with* the floor change. The full D1–D11 ledger (durable unified pool, signal-keyed difficulty floor, retrieval-grounded generation, trust tiers) is locked in `PRD-D-5` §4; source strategy is open-web-plus-trust-layer, **not** a curated corpus.
- **Quality-floor build (B1–B5) shipped; D1–D11 built.** The B1–B4 engine pass and the B5 authoring/attribution surface pass are complete (B5 in PR #612). The as-built record — per-prompt status, the embedding-provider choice, and the deviations from the spec as written — lives in `PRD-D-5` §11. Two deviations worth knowing without opening the spec:
  - **Embedding provider = Voyage AI `voyage-3.5-lite` (1024-dim), gated on `VOYAGE_API_KEY`.** Anthropic ships no first-party embedding model, so the pool's semantic-dedup backstop uses Voyage (Anthropic's recommended partner). It is **OFF until the key is provisioned**; without it, dedup falls back to the deterministic fact_key + Haiku + normalized-text guards. (`src/server/llm/embeddings.ts`, `src/server/pool/dedup.ts`.)
  - **D9 attribution shipped as universal profile links, not "display-name-to-strangers."** Per the B5 product decision, everyone gets a profile link, attribution is sender-only, and there is no friend/stranger gating — safe because no surface shows a per-author avatar to strangers and the profile page is itself relationship-gated. Daily Five's gameplay chat stays plain text; its summary page links author names. (`PRD-D-5` §11.3b.)
- **`/replay` and `/archive` are built but deliberately unlinked.** Both pages render at their URLs with zero inbound links — that is the deferral working as intended (`PRD-D-0` §2), not dead code or broken routing. Don't re-flag them in audits; the open question is only whether they're still on the roadmap or should be deleted (replay carries real grading code that must track the live answer paths while it sits orphaned). (2026-06-12 structural audit, STRUCT-07.)
- **Zod-validation convention applies to structured request bodies.** The CLAUDE.md rule ("Zod on every API input") was reconciled across the API surface (audit finding E, 2026-06-04): the JSON request-body handlers now validate with Zod. Four routes are a deliberate, documented carve-out and keep their existing validators because converting them is high-churn with no safety gain:
  - `GET /api/archive`, `GET /api/feed`, `GET|POST /api/feed/backfill-missing-feed-items`, `GET /api/handle/check` — these take **query params** (always `string | null`), already coerced/clamped/enum-checked inline or routed through purpose-built validators (`decodeFeedCursor`, `handle-validation`).
  - `POST /api/questions` delegates body validation to `readCreateQuestionPayload` (`src/server/questions/create-payload.ts`), a **centralized, unit-tested** validator — already the spirit of the convention, just not literally Zod.
  - `POST /api/onboarding/propose-interests` and `POST|DELETE /api/friend-invitations` retain their hand-rolled validators: both emit several **distinct, field-specific error codes/messages** that a single Zod schema would flatten, and `validateCreateFriendInvitationBody` is exported and covered by its own test suite. Converting later is safe-but-optional; the tests would catch drift.
  - `PATCH /api/declared-interests` retains its parser: each item is a lenient `string`-or-`object` union where **invalid items are dropped, not rejected** (1–5 must survive). Zod can only express that by wrapping the existing per-item parser, which adds ceremony without added safety.

## Open — pick these up

- **Option B (live thread): should the aside amplify a human's `creatorNote` when one exists?** Aside and creator note are independent surfaces today; no code merges them. (`PRD-D-0` §5.)
- **Niche-match production default.** Ships `false`, test-phase `true`; production default is an open decision to revisit after the test. (`PRD-D-2`; `PRD-D-0` §3.)
- **Thumbs-up → surface priority.** No effect on feed ordering yet; computation model and weighting formula undecided. (`PRD-D-0` §3.)
- **House author (Capability 23) + Invariant H-1 guard.** ~~D-3 is spec-only~~ **Update 2026-06-10: the house author has shipped** (`source='house_authored'`, `pickHouseQuestions`, house smoke script) — the conformance audit's §3.1 "UNBUILT" is stale. Remaining open item: verify the `'A friend'` fallback was replaced for house-origin questions and lock Invariant H-1 with a regression test. (Conformance audit §3.1, §5.)
- **Feed verb `'wrote this'` on broadcast.** The `authored_shared` branch claims authorship unconditionally; resolve before D-3. (Conformance audit §3.2.)
- **"From Friends" → chronological activity log.** Agreed in discussion (2026-06-12), spec in `_docs/D-FEED-FRIEND-ACTIVITY-01.md`; **not yet built**. Replaces the deep/breadth domain grouping with context-routed burst cards, held-singles, and static (non-mutating) cards. Open sub-decisions live in that note (burst gap threshold, held-singles state/persistence, completed-card fate, copy).
- **Home page pacing & budget model.** Aligned in discussion but **not yet sequenced into build prompts**: edition-not-log budget, serve-and-overflow for the question zones, removal of the temporal archive, two overflow subpages, and the two-state empty-state switch. Sequence alongside the tier system (`B-VISUAL-CARD-TIERS-01`). (`D-HOME-PACING-01`.)
