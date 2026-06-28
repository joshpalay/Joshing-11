# B-AREA-EXPANSION-01 — Area Expansion (wider + broader, on the daily-summary card)

**Source of intent:** `D-AREA-EXPANSION-01.md` — read its **§9 ratification addendum**, which governs this build and supersedes the original C1/D2/S3/§6.
**Branch:** `claude/area-expansion-game-end-8xn2kc` · **PR:** #1313.
**Status:** READY — Phase 0 (prior-art reconciliation) is **RESOLVED** (see below). Buildable.

---

## 0. Decisions this build inherits (RESOLVED — was the Phase 0 gate)

A code read found a complete expansion feature already shipping on the **daily-summary** surface. Rather than build a second one, this work **extends** it. The reconciled decisions (D §9):

- **R1 — direction: broader.** Candidates go up to the parent (Pride → Moral Philosophy), *in addition to* the existing wider/sibling candidates.
- **R3 — one combined offer, on the existing daily-summary card.** The single `ExpandDomainOfferCard` (inline on `/daily/summary`) presents both **wider** (existing siblings) and **broader** (new parent) candidates. **No `CompletedRecapHeader` chooser is built** (supersedes C1/S3).
- **R2 — write via `addDeclaredInterest` (both targets).** Its chokepoint already writes the rotation row *and* the declared `playerMastery` row. **Do not** add `via:'expansion'` to `openKBDomain` or route the write through it (supersedes D2).
- **R4 — parent overflow, in scope.** Keep Pride (E1). *Also* make the chosen parent the overflow reservoir: when a thin area is exhausted mid-game, draw from its recorded parent instead of unrelated backfill (supersedes §6). Requires a recorded parent link + a migration.

### The existing pieces you are extending (read all of these first)

| Piece | Where |
|---|---|
| Offer card (inline on summary) | `src/app/daily/summary/ExpandDomainOfferCard.tsx`, mounted at `src/app/daily/summary/page.tsx:220` |
| Offer builder + `ExpansionOffer` type | `buildExpansionOffer()` / `daily-summary.ts:54-60,366` |
| Wider candidates (Haiku) | `suggestAdjacentDomains(sourceDomain, broadCategory)` (called `daily-summary.ts:380`) |
| Trigger + stamp | `getPendingExpansionDomains` / `expansionEligibleSince` / `markDomainExpansionOffered` in `src/server/adaptive-difficulty.ts` |
| Accept/dismiss API | `POST /api/daily/expand-domains` (`route.ts`) → `addDeclaredInterest` |
| Diagnostics | `/dev/expansion-offer` (funnel), `/daily/summary/expand-preview` (card preview), `/dev/area-expansion-spec` (this doc) |

---

## Read-first symbol verification (confirmed 2026-06-28 — re-grep before editing)

- `addDeclaredInterest(userId, input)` — `src/server/db/queries/users.ts:274`. The **mandated single chokepoint** for declared-interest writes (CLAUDE.md). Via `upsertDeclaredInterestRow` (`users.ts:171`) it writes the `declaredInterests` row **and** a `playerMastery` row with `territoryType: 'declared'` (`users.ts:214`). Guards: `DeclaredInterestLimitError`, `TooBroadInterestError`, `UnanswerableInterestError` (handled at `expand-domains/route.ts:56-70`). **This is the expansion write — reuse it, don't bypass it.**
- `masterySourceTypeEnum = pgEnum('MasterySourceType', [... 'declared_promoted'])` — `schema.ts:180-188`. Adding `'expansion'` is an **enum-value migration** (hand-written `.sql` + journal reconcile + an instrumentation guard — use the `new-migration` skill; CLAUDE.md enum rules).
- `masteryEvents` write precedent — `promoteDeclaredToDemonstrated` (`src/server/knowledge/open-domain.ts:145-160`): `sourceType`, `metadata`, zero points, deterministic `answerId` dedupe key. Mirror this shape.
- `buildExpansionOffer` / `ExpansionOffer` — `daily-summary.ts:54-60,366`. `candidates: { label; broadCategory }[]`; de-dupes against active interests via the `have` set (`:384-389`).
- `narrowKbThinnessThreshold()` → `getRetrievalConfig().poolDepthThreshold` — `src/server/daily/kb-exhaustion.ts:55`. The shared "thin" boundary; the narrow-KB guard is **OFF by default** (`NARROW_KB_GUARD_ENABLED`, `:47`) — R4 overflow depends on this detection, so note the flag dependency.
- `openKBDomain` — `src/server/knowledge/open-domain.ts:8`. **Not used by this build** (R2). Leave it untouched.

---

## Hard guardrails (every phase)

- **Fail toward the player.** A failed write shows **no** "you expanded" confirmation and never loses the source area. The existing card already models this (`ExpandDomainOfferCard` re-enables to `idle` on error, `:75-78`); preserve it. Guard-rejected picks (limit/too-broad/unanswerable) are soft-skipped, not fatal.
- **Additive only (E1).** Never mutate or delete the source area's row. Overflow (R4) *reads* the parent link; it never folds the child away (the silent fold `reconcileProposedDomain` forbids).
- **Reuse the chokepoint (R2).** All declared writes go through `addDeclaredInterest`. No new direct `playerMastery`/`declaredInterests` inserts.
- **Provenance honest (R4).** Every expansion records what expanded into what via the `masteryEvents` `'expansion'` row — that record is also what the overflow reads.
- **Conventions (CLAUDE.md):** Zod on every new/changed API input; DB access only in `src/server/db/queries/`; LLM calls under `src/server/llm/` (Haiku, matching `suggestAdjacentDomains`); no raw hex / no color-only signal / no streak-or-competition copy; never add `src/middleware.ts` (extend `src/proxy.ts`); run `npm run lint`, `npx tsc -p tsconfig.typecheck.json`, and `npm run check:colors` at each phase boundary.

---

## Phases (each ends at an approval gate — stop and report)

### Phase 1 — Broader candidates *(gate: curated map covers virtues/vices; fallback one-level-up; ≤3 combined)*
- Add `suggestBroaderDomains(sourceDomain, broadCategory)` **beside** `suggestAdjacentDomains` (same module; separate fn — different prompt + "one jump only, never two" discipline). Curated virtues/vices→parent map first (B2), constrained Haiku fallback for the long tail. Fails soft to `[]`.
- In `buildExpansionOffer`, merge wider + broader candidates, tag each with a `kind: 'wider' | 'broader'`, de-dupe against the existing `have` set, cap the combined list (3 max, keep at least one broader when available). Extend the `ExpansionOffer` type accordingly.

### Phase 2 — Trigger on thinness too *(gate: thin-area path produces an offer; once-per-area stamp respected)*
- Today the offer fires on the supply-ceiling signal (`expansionEligibleSince`). Add eligibility when a touched area is at/under `narrowKbThinnessThreshold()` (note `NARROW_KB_GUARD_ENABLED` dependency; coordinate with whoever owns the retrieval flip). Keep one offer per resolution via the existing `markDomainExpansionOffered` / `expansionOfferedAt` stamp — an area is offered at most once.

### Phase 3 — Provenance record + migration *(gate: migration reconciles; `masteryEvents` 'expansion' row written; fail-soft proven)*
- Migration: add `'expansion'` to `masterySourceTypeEnum` (hand-written `.sql`, `node scripts/reconcile-drizzle.mjs --apply`, instrumentation guard). Use the `new-migration` skill.
- On accept, after `addDeclaredInterest` succeeds for a **broader** pick, write a `masteryEvents` row on the **target** area: `sourceType: 'expansion'`, `canonicalSubcategory` = parent, `metadata: { expandedFrom: <source> }`, zero points/weight, `answerId` = `expansion:<source>:<target>:<userId>` (idempotent). Mirror `promoteDeclaredToDemonstrated`. Wrap so a provenance failure never produces a false confirmation.

### Phase 4 — Card UI: wider + broader *(gate: both groups render; collapses to confirmation; no false pill on failure)*
- Extend `ExpandDomainOfferCard` to render the two candidate groups (e.g. "Branch wider" / "Go broader") off `candidate.kind`. Keep the existing multi-select + accept/dismiss + loading/`done`/`dismissed` states and the preview mode. Copy stays presence-framed, no streak/competition register.

### Phase 5 — Parent overflow (R4) *(gate: exhausted child with a recorded parent draws from the parent, not unrelated areas)*
- When a thin area has a recorded `'expansion'` parent, route mid-game backfill/generation to that parent instead of the generic borrow. Touch points: the narrow-KB backfill (`src/server/daily/kb-exhaustion.ts`) and retrieval grounding / generation selection (`retrieval-grounded.ts`, `generate-questions.ts`). Read these before editing; respect the existing fabrication-suppression behavior — overflow changes *where* backfill comes from, not the safety posture. Add a query helper (in `src/server/db/queries/`) to resolve a domain's expansion parent from the `masteryEvents` records.

### Phase 6 — Wire-up, funnel, dev preview *(gate: full path works in dev; done-when all checkable)*
- Keep all expansion logging under the existing `[expansion-offer]` funnel key (eligible → shown → resolved), now distinguishing wider vs broader accepts. Update `/daily/summary/expand-preview` to exercise both candidate groups so the card is inspectable without a real thin area.

---

## Done-when (grep-/test-checkable)

**Status: all met as of Phase 6 (commit on branch `claude/area-expansion-game-end-8xn2kc`).** The thinness trigger and parent overflow ship behind default-OFF flags (`AREA_EXPANSION_THINNESS_TRIGGER_ENABLED`, `AREA_EXPANSION_PARENT_OVERFLOW_ENABLED`); migration 0094 is journaled but must be applied with `npm run db:migrate` against a live DB.

- [x] A thin-or-supply-capped area touched in a completed round produces **one** combined offer on the daily summary, with both wider and broader candidates (≤3), offered at most once per area (stamp respected). — `selectExpansionSource` + `capExpansionCandidates`; stamp via `getExpansionOfferedDomains` (thinness) / `getPendingExpansionDomains` (supply).
- [x] Accepting a **broader** pick writes — via `addDeclaredInterest` — a `declaredInterests` row **and** a `playerMastery` row with `territoryType='declared'` for the parent, and a `masteryEvents` row `sourceType='expansion'` with `metadata.expandedFrom` = source. — route + `recordAreaExpansion`.
- [x] The source area's `playerMastery` row is **unchanged** (additive E1 — nothing in the path mutates the source row).
- [x] A failed write (incl. guard rejections) shows **no** "you expanded/added" confirmation. — card resets to `idle` on `!ok`; `recordAreaExpansion` fails soft.
- [x] The parent shows as **declared (not demonstrated)** on the portrait until a correct answer lands in it. — `addDeclaredInterest` seeds `territoryType='declared'`.
- [x] With a recorded parent, an exhausted child's mid-game backfill draws from the **parent**, not unrelated areas. — `getExpansionParents` + `selectOverflowParents` (unit-tested) wired into the guard block.
- [x] `openKBDomain` is **not** modified; no `via:'expansion'` exists anywhere (D2 was dropped). — verified by grep.
- [x] Migration reconciles, journal in lockstep, instrumentation guard added. — 0094, reviewed by drizzle-migration-reviewer.
- [x] No raw hex / no color-only signal / no streak-or-competition copy (`npm run check:colors` clean).
- [x] `npm run lint` + `npx tsc -p tsconfig.typecheck.json` clean.
