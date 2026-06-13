# Decisions & Docs Index

A short index of the durable restructure (D-1 / D-2 / D-3 / D-4 / D-5) documentation, and — critically — a
pointer to what is **settled** vs. **still open**, so the next reader doesn’t re-litigate closed
decisions or miss the live thread.

The `PRD-D-*` series **is the current product canon** (the “v12 line”) and supersedes the 10.25/v11.x PRDs.
The older specs are archived under `_docs/archive/` for history: `PRD-v11.2.md` (the last v11 diff, with
v11.3 / v11.4 / v11.5 folded in place — there is no standalone v11.3+ file), `PRD-v11.1.md`, `PRD11.md`,
and `Joshing_PRD_v10_25 (1).md`.

**A “Settled” decision is one that has been *made*, regardless of build state.** Each settled entry carries
a build tag so a made-but-unshipped decision is never mistaken for live behavior:

- `[built]` — live in the default code path.
- `[built, flag-off]` — code merged but gated behind a flag; computed, not yet adopted.
- `[decided, NOT built]` — the call is made; the code does not yet reflect it. **Live behavior still differs.**
- `[built, specced≠as-built]` — something shipped, but it diverges from the decision as written; reconcile pending.

Decision state and build state are tracked independently. The build tags below were verified against live code
by `D-DECISIONS-CONFORMANCE-01` (2026-06-13); where the audit refuted an earlier assumption, the entry says so.

Last updated: 2026-06-13 (post-conformance-audit).

## Durable docs

|Doc                                                  |What it is                                                                                                                                                                            |
|-----------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|`PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md`         |Canonical “what the product is and why”: target capabilities, deferred items, open hypotheses, **amended decisions**.                                                                 |
|`PRODUCT-CANON.md`                                   |Designer-facing product canon. (Stale in §8/§9 as of 2026-06-13 — see canon-edits note at the bottom.)                                                                                |
|`PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md`             |Spec — directional follow + Feed/Daily split.                                                                                                                                         |
|`PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md`              |Spec — niche-match discovery engine.                                                                                                                                                  |
|`PRD-D-3-HOUSE-EDITORIAL-AUTHOR-SPEC.md`             |Spec — house / editorial author (**shipped**; see Settled).                                                                                                                           |
|`PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md`|Spec — Lately skill milestones + the +2 reframe.                                                                                                                                      |
|`PRD-D-5-QUESTION-QUALITY-FLOOR-VERIFICATION-SPEC.md`|Synthesis spec — question quality, difficulty floor, verification stack.                                                                                                              |
|`D-HOME-PACING-01.md`                                |Spec — Home pacing & budget model. **Header says “not yet sequenced” but the code is built (cut-1) and live** — header is stale; see Settled.                                         |
|`_docs/D-FEED-FRIEND-ACTIVITY-01.md`                 |Spec — “From Friends” chronological activity log. **Built (cut-1) and live** despite the “SKETCH/not yet wired” header in `src/lib/friend-activity.ts` — header is stale; see Settled.|

Execution scaffolding (kept separate, not product spec): `docs/build-prompts/`.

> **Note on missing referenced docs:** `Master_App_Instructions-v2.md` and `B-CATEGORY-AUTHORED-RECONCILE-01.md`
> are referenced elsewhere but **do not exist in this branch**. `CATEGORY-HIERARCHY-FINDINGS-01.md` exists but is
> itself stale (it claims the authored path “categorizes blind” — no longer true; see Settled §authored-reconcile).

## Settled decisions (don’t re-open without cause)

- **Directional follow is the primitive.** [built] Symmetric friendship replaced; “friend” = mutual follow. (`PRD-D-1` Decision 1.)
- **Authored-vs-curated provenance is honest.** [built] Forwarded LLM questions get `creatorId: null`, `source: 'curated_sent'`; credit never accrues to the forwarder.
- **Send difficulty travels with the question.** [built] The forwarded question keeps its own `difficultyEstimate`. (`PRD-D-0` §4.1.)
- **Broadcast rolls off after unfollow — won’t fix.** [built] Already-surfaced broadcasts are not retroactively purged on unfollow. (`PRD-D-0` §4.2.)
- **Question quality = floor + verification, shipped together.** [built] Full D1–D11 ledger locked in `PRD-D-5` §4; source strategy is open-web-plus-trust-layer, not a curated corpus. Two as-built deviations (`PRD-D-5` §11):
  - **Embedding provider = Voyage AI `voyage-3.5-lite` (1024-dim), gated on `VOYAGE_API_KEY`** — OFF until the key is provisioned; falls back to deterministic fact_key + Haiku + normalized-text guards.
  - **D9 attribution = universal profile links, sender-only, no friend/stranger gating** — safe because no surface shows a per-author avatar to strangers and the profile page is relationship-gated.
- **House author shipped.** [built] `source='house_authored'`, `pickHouseQuestions` (called from the live queue at `queue-orchestrator.ts:269`), `buildHouseSlot`, smoke script. The conformance audit’s §3.1 “UNBUILT” is **stale**.
- **House-origin questions never render peer copy (Invariant H-1).** [built, regression-tested] **Audit correction: this is closed, not open.** `'A friend'` cannot reach house questions — house questions are non-feed-eligible (`visibility.ts:64,78`) so the unguarded fallback is unreachable, and where house renders, author resolution is centralized in `resolveAuthorDisplay` (house→`'Joshing'`, ending in `assertNever`). Asserted by `questions-types.test.ts:51-54` and `GameplayChat.house.test.tsx:46`.
- **`/replay` and `/archive` are built but deliberately unlinked.** [built] Zero inbound links by design (`PRD-D-0` §2), not dead code. Open question is only whether to revive/delete; replay carries live grading code that must track the answer paths while orphaned. *(Caveat: `archive` still renders live thumbs buttons — see the `surfacePriorityScore` entry.)*
- **Home is a budgeted edition, not a log.** [built, cut-1] `D-HOME-PACING-01` ratified; the budget edition is live (`src/server/home/select-edition.ts`, `build-edition.ts`, rendered via `FeedList` with a `budget` prop). Caps: Direct 3 / Playables 4 / Texture 8; single `TodaysFiveCard` hero; one rotating panel; composer footer. Serve-and-overflow: direct → `/for-you`, playables → `/from-friends`, both back-navigable. **Refill-from-queue is silent and confirmed in code:** Home and subpages read the same queries; answering calls `router.refresh()` and Home re-windows top-N — no ghost states, no manual clear (`OverflowSubpageSync.test.tsx`, `FeedListBudget.test.tsx`). Temporal archive removed from the budgeted path (`groupItemsByRecency` runs only on the logged-out `!budget` branch). *Resolves the canon’s §9 item 6.* **Drift note:** `PersonActivityCard` / `groupActivityByFriend` are still imported in `FeedList.tsx` but inert on the budgeted home (`groupableFriendId` returns null for feed/milestone rows) — behavior is correct, but the symbols are present-but-defanged, not removed.
- **“From Friends” is a chronological activity log.** [built, cut-1] Live: `/from-friends` → `getFriendActivity` → `deriveFriendActivity`, recency-ordered. Replaces the deep/breadth domain-grouped mastery summary (the old `deriveLatelyMilestones` still exists but has no production call site here). Context-routed burst grouping, held-singles, static cards, inline play (`PendingPlayablesList` → `InlineAnswerFlow`) all present. As-built sub-decisions: burst gap **45 min**; held-singles **pure re-derivation, no table** (solo release 5d, flush-to-mixed at 2 singles, 35d window); completed cards roll off at **30 days**, no history view; copy is **one shared lead set, not per-context** (context is computed but unused). ⚠️ **Open defect, not a decision:** the shipped lead copy still contains competition-register phrases (“on a roll,” “on a streak,” “on a tear,” “killing it” in `activity-stream.ts:858-871`) that the locked discovery-register rule prohibits. Tracked in Open.
- **Authored-question categorization reconciles against existing domains.** [built, flag-off] **Audit caveat: ships behind `RECONCILE_AUTHORED_DOMAINS`, flag-OFF (shadow-log only) — the fold is computed but not yet adopted.** When on, the authored path reconciles using **both** `convergeDomain` (pg_trgm `similarity()`) and `reconcileProposedDomain` (Haiku), sequential/short-circuiting; the fold is **silent** (no client-facing confirm; `category_overridden` appears in zero `.tsx`). Reuses the shared helpers, not a reimplementation. Decided against and confirmed out: no middle tier, no parent/child edge or roll-up, no schema change. Generated/onboarding paths untouched. *(The `CATEGORY-HIERARCHY-FINDINGS-01.md` “categorizes blind” claim is stale.)*
- **Directed-question card retires the triangle border.** [built, specced≠as-built] The triangle-mat frame on directly-sent cards is gone (`DirectSentCard` uses `variant="bordered"`). Broadcast (“added a question”) cards stay the plain default — CONFIRMED. **But the edge-bar treatment we specced did not ship:** there is no left HILITE/amber edge-bar, and the eyebrow is gold sans **“Sent directly to you”**, not Courier “SENT TO YOU.” The specced design and the as-built card diverge; reconciling them (decide which is canon) is in Open. The Friend Play bar question is moot — no Friend Play card renders an edge-bar on the feed surface at all.
- **Color system: grading and category colors are to be separated by construction.** [decided, NOT built] **Audit correction — the decision stands but the build never landed; the collision is still live in the default.** Decided: WRONG moves to a true red out of the terracotta family; category color = top-level domain with leaves inheriting; the mastery triangle encodes completion (fill) + is decorative-hashed, never correctness (the only correctness-colored shape is `GeometricProgress` dots, which is correct). **As-built reality:** the default `:root` still holds the colliding values — `--game-wrong-strong:#c33d14` (`globals.css:109`) vs `--cat-literature:#c0392b` (`:119`). The de-collided true-red (`#c1121f`) lives only inside an inert `:root[data-palette="proposed"]` block that **nothing in live code activates**; `PaletteToggle` was repurposed to a card-bg cycler and is still mounted marked “TESTING ONLY — remove before shipping.” `B-VISUAL-PALETTE-PROMOTE-01` / `LITERAL-TO-TOKEN-01` do **not** exist in the repo. Leaf-inheritance (`getPortraitDomainColor`) and the triangle rule *are* live. **This is the top remediation item** — see follow-up B-prompt below.
- **`surfacePriorityScore` is a dead column — for surfacing.** [built, blocked-on-thumbs-UI] Thumbs feedback does not affect feed ordering: the feed orders strictly by `desc(sourceEventAt), desc(id)`; nothing reads the column for ranking, and it’s excluded from the question view DTO. **Audit correction: it cannot simply be dropped yet** — `QuestionRatingButtons` (still POSTing to it) remains live on **two surfaces**, `games/[id]/summary/page.tsx:371` (a linked surface) and `archive/page.tsx:414` (unlinked). Daily summary was migrated to a Heart writing `questionFeedback` only. Removal sequence: rewire/remove those two button surfaces → drop the 4 `ratings.ts` writes → drop the column. (Replaces the former Open “Thumbs-up → surface priority.”)
- **Zod-validation convention applies to structured request bodies.** [built] JSON request-body handlers validate with Zod (audit finding E, 2026-06-04). Four documented carve-outs keep their existing validators (query-param routes already coerced/clamped; `POST /api/questions` via centralized unit-tested `readCreateQuestionPayload`; `propose-interests` and `friend-invitations` emit distinct field-specific error codes a single schema would flatten; `PATCH /api/declared-interests` drops-not-rejects invalid items). Converting later is safe-but-optional; tests catch drift.

- **Color system: de-collided palette is the default.** `[built]` WRONG is a true red out of the terracotta family (`--game-wrong-strong: #c1121f`), de-collided from the brand/link orange and from Literature's category mark (which moved to bordeaux `--cat-literature: #7d2c3f`); Language moved off the CORRECT green to teal (`--cat-language: #2e6e7e`). These were formerly inert behind `:root[data-palette="proposed"]`; they are now the base `:root` values in `src/app/globals.css` and the `data-palette="proposed"` block is deleted. `SharePortraitCard.tsx`'s hardcoded html2canvas scale is re-synced value-for-value (kept in lockstep by comment). Category color = top-level domain with leaf inheritance via `getPortraitDomainColor` (unchanged). (`D-DECISIONS-CONFORMANCE-01` §5; built 2026-06-13 in `B-VISUAL-PALETTE-PROMOTE-01`.)

## Open — pick these up

- **Land the palette promotion for real.** [highest priority] The grading/category collision is **live in the default** (`#c33d14` vs `#c0392b`); the fix is inert behind `data-palette="proposed"`. Promote proposed→default, retire the still-mounted `PaletteToggle`, **and** re-sync `SharePortraitCard.tsx`‘s hardcoded hex (html2canvas can’t read CSS vars — it currently mirrors the OLD scale and would drift the instant the palette flips) in the same prompt. Minor tail: `DomainCircle.tsx` still hardcodes `#d4cfc7` / `#c8c0b0`. See B-prompt `B-VISUAL-PALETTE-PROMOTE-01`.
- **From Friends copy violates the discovery-register rule.** Remove “on a roll / on a streak / on a tear / killing it” from `activity-stream.ts:858-871`. This is a defect against a locked decision, not an open product question — but it needs a prompt.
- **Reconcile the directed-card spec vs as-built.** Doc/spec describe an amber/HILITE edge-bar + Courier “SENT TO YOU”; code shipped a gold sans “Sent directly to you,” no bar. Decide which is canon (the sub-decisions were flagged provisional, so this may resolve as a doc update rather than a code change).
- **Adopt or hold `RECONCILE_AUTHORED_DOMAINS`.** The authored reconcile is built but flag-off (shadow-log only). Decide when to flip after reviewing the shadow-log duplication numbers.
- **Option B: should the aside amplify a human’s `creatorNote` when one exists?** Aside and creator note are independent surfaces today; no code merges them. (`PRD-D-0` §5.)
- **Niche-match production default.** Ships `false`, test-phase `true`; production default open, revisit after the test. (`PRD-D-2`.)
- **Feed verb `'wrote this'` on broadcast.** The `authored_shared` branch claims authorship unconditionally; resolve. (Conformance audit §3.2.)

## Known-stale source claims

Corrected at the source when next editing those files:

- **Conformance audit §3.1 — “house author UNBUILT.”** Stale; house author is live.
- **`D-HOME-PACING-01.md` header — “not yet sequenced into build prompts.”** Stale; built cut-1 and live.
- **`src/lib/friend-activity.ts:1-6` — “SKETCH / not yet wired in.”** Stale; wired and live.
- **`CATEGORY-HIERARCHY-FINDINGS-01.md` — authored path “categorizes blind.”** Stale; reconcile path exists.
- **`PRODUCT-CANON.md` §9 item 6 — Home-pacing-vs-tiers sequencing “unresolved.”** Stale; sequenced and built.
