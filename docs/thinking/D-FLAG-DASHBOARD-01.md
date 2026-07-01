# D-FLAG-DASHBOARD-01 — Decision Record

**Status: PROPOSED — NOT RATIFIED. Do not write a build prompt from this yet.** This doc is deliberately drafted while the direction is still settling, as a *thinking tool*: seeing the decisions concretely is often the fastest way to tell whether the direction is right. Ratify only after the concept note (`CONCEPT-master-authored-canonical-sets.md`) has had time to settle.

**Implements (near-term slice of):** the concept note's §6b flag dashboard — the *first* Phase-1 build, chosen because it is urgent (a growing debt), small (mostly surfacing existing infrastructure), and it *finishes a feature already half-shipped* (the batch-verify cron demotes into a surface no one reads).

**Migration head at draft:** `0097`. This doc likely introduces **no migration** (it reads existing columns; see Decision E).
**Source of truth:** live code, not this doc. Every symbol below was verified against the repo on this pass; re-verify before building.

---

## 1. Why this is the first build

Three-a-day (Josh's number) machine demotions from `batch-verify-questions` currently land in `needs_review` / `verificationVerdict = 'demoted'` — **a state the review surface does not read.** Verified: `getOpenReportsForReview` (`src/server/db/queries/content-reports.ts:377`) selects `.from(contentReports).where(status = 'open')` and nothing else. So:

- The **player-report** stream has a home: `/admin/reports`, a working queue + action API (uphold / dismiss / reverse), a rich read query (question text, answer, category, incorrect-kind, reporter note, suggested answer), admin-gated.
- The **machine-demotion** stream has **no home** — it demotes into a void. Some of those demotions are *good questions the verifier got wrong*, now out of circulation with no human path back.

This is the "features landing dark" pattern from Josh's own canon: the flagger (batch-verify cron) was built in one session, the review surface in another, and nobody wired them together. This build wires them.

## 2. What already exists (verified — do NOT rebuild)

- **Surface:** `/admin/reports` (`page.tsx` + `AdminReportsClient.tsx`) — open-report queue + blocked/actioned list.
- **Action API:** `/api/admin/content-reports` — `uphold`, `dismiss`, `reverse`, zod-validated, gated, conflict-handled.
- **Read queries:** `getOpenReportsForReview` (open player reports, joined to question/answer/reporter, inappropriate-sorted-first) and `getBlockedQuestionsForReview` (the actioned list).
- **Gate:** `isAdminUser` — an **`ADMIN_USER_IDS` env allowlist** (comma-separated `users.id`), not a role column. Widening to Robyn = adding her id to the env var.
- **Un-demote precedent:** `restoreRecoveredQuestion` (`src/server/db/queries/recovered-questions.ts:184`) already restores a set-aside question. The "restore from demote" action has a pattern to follow, not invent.

**The player-report half of the flag dashboard substantially exists. The delta is small.**

## 3. The delta to build (a two-panel admin view)

**The admin view is two panels on one page:** *Panel A — "questions needing you"* (reactive: clear flags) and *Panel B — "where your craft is wanted"* (proactive: thin + demanded domains). Both are Phase 1; both are mostly surfaces over existing infrastructure.

### Panel A — the flag queue (four bounded pieces)

1. **Merge the machine stream into the read.** Add a second leg to the review queue: questions/generatedQuestions where `verificationVerdict = 'demoted'` (equivalently `publicStatus = 'needs_review'` on the human table), unioned with the existing open `contentReports`. Machine rows carry the verifier's reasoning where player rows carry the reporter note. Same card shape.
2. **Add two actions.** Today: uphold / dismiss / reverse (built for reports). Add **edit** (open + rework the question) and **restore-from-demote** (verifier was wrong → clear `needs_review` back to live, following the `restoreRecoveredQuestion` pattern).
3. **Widen the gate.** `ADMIN_USER_IDS` → add Robyn's `users.id`. Phase 1 = Josh + Robyn as generalist reviewers. (Decision C: keep it env-allowlist, or introduce a real "crafter" concept.)
4. **Reframe as a shared queue.** From "admin moderation" to "questions needing you" — merged both streams, worked collaboratively.

### Panel B — the demand panel ("where your craft is wanted") — ALSO Phase 1

5. **Rank domains by demand × shallowness.** Show where players are active AND the set is thin — a prioritized crafter worklist, an *invitation* to author where it produces the most player value. **The telemetry already exists** (this is why it's Phase 1, not deferred): `getThinActiveDomains` / `getDurablePoolDepthForDomains` (`retrieval-demand.ts`) already compute thin-and-active domains (built to tell the *refill machine* where to spend budget — same intersection, now feeding the *crafter* instead), and `declared-interests` / `PLAYER_MASTERY` / `MASTERY_EVENTS` carry the demand side. Largely query-and-display. **Guardrail — invitation, not obligation:** "here's where you're wanted, if you want it," shown alongside the crafter's own declared loves; never "make what's popular" (the engagement-farm register the product rejects). Each row links into authoring for that domain (the coverage-map/cue-feed workbench, which is later — for Phase 1 the panel can simply surface the list). Ties to the "you're out → add one yourself" loop: a player exhausting a domain *is* the demand signal that lights up this panel.

## 4. Settled frame (from the concept note + this session — not open here)

- **Two streams, one queue.** Player reports + machine demotions merged; sorted by what needs attention.
- **Generalist reviewers.** Josh + Robyn review *all* domains, not just their own, leaning on the verifier's evidence. Viable *because* it's ~3/day. (Domain-routed review is Phase 2, with the community layer — explicitly deferred.)
- **Machine flags, human decides.** Every action is the human acting on a concern the machine or a player raised. The machine never empties the queue.
- **Fail toward the player.** Flagged = out of circulation *pending review*, never silently deleted; recovery path mandatory.

## 5. Open decisions (RATIFY THESE — and the point of sitting on the doc)

### A — Does "retire" hard-delete or soft-tombstone?
Live `uphold`-on-inappropriate does a hard `visibility: 'blocked'` write. Canon is soft/reversible (and `reverse` already un-blocks, suggesting it's recoverable).
- **A1 (recommended):** all removals soft + reversible (tombstone, `reverse`-able). Confirm `blocked` is truly recoverable and make the machine-stream "retire" match. Never a hard `DELETE`.
- **A2:** keep hard-block for upheld-inappropriate (offensive content maybe *should* be hard-gone), soft everywhere else. Splits the model — needs a reason.

**Recommendation A1** — fail-toward-player + territory-is-cumulative canon both point to reversible.

### B — What exactly does "restore from demote" write?
The verifier demoted a question to `needs_review`; the human says it's fine.
- **B1 (recommended):** clear back to the pre-demote live state (`publicStatus` → its prior value / `not_scored`/`eligible_pending` as appropriate), stamp `verificationVerdict` so it isn't re-swept, following `restoreRecoveredQuestion`.
- **B2:** restore *and* mark author-confirmed (elevates trust). Maybe too strong for a generalist reviewer judging a domain they don't master.

**Recommendation B1** — restore to live, don't over-elevate; a generalist un-demote isn't a mastery endorsement.

### C — Gate: env allowlist or a real "crafter" role?
- **C1 (recommended for Phase 1):** keep `ADMIN_USER_IDS`, add Robyn. Zero new machinery. Correct for two people.
- **C2:** introduce a `crafter` role/flag now, anticipating Phase 2. More surface area, premature — Phase 2's community model isn't decided (concept note §9 wide open).

**Recommendation C1** — hardcode two people via env; build the role when the community model that needs it is actually decided.

### D — Does the machine stream show the verifier's *evidence*?
The batch-verify cron may have web-search corroboration behind a demotion.
- **D1 (recommended):** surface the verifier's reason + any source it cites, so a generalist can judge a domain they don't know from the evidence. This is what makes generalist review *work* at all.
- **D2:** show only "verifier flagged: answer_key" with no evidence. Cheaper, but forces the reviewer to re-research — defeats the generalist model.

**Recommendation D1** — evidence is the whole reason a non-expert can adjudicate; check what the cron actually persists and surface it.

### E — Migration or no migration?
Believed **none** — reads existing columns (`verificationVerdict`, `publicStatus`, `contentReports.*`). Confirm during READ-FIRST; if a stamp column is needed to mark "human-reviewed a demotion," that's the only candidate, and it may already exist (`reviewedAt`/`reviewDecision` on `contentReports` cover reports; the machine stream may need an equivalent). **Decision: prefer reusing existing stamp columns; introduce a migration only if the machine stream genuinely can't record "human cleared this."**

## 6. Explicitly deferred (NOT this build)

- Domain-routed review (flags → the domain's master). Phase 2, needs the community model.
- The full authoring functions (coverage map, cue feed, commission, expansion rail). Panel B *surfaces* the thin+demanded list in Phase 1; *authoring into* those domains is the later workbench build.
- The player-facing "you're out → add one yourself" contribution flow (concept note §6c). Related to Panel B (a player exhausting a domain feeds the demand signal), but the player-side authoring UI is its own build. **HARD REQUIREMENT when built — authorship-exclusion invariant:** a question is never served to its author (`authorId !== playerId`) at *every* serving surface (daily five, catch-up, friend-play). Authoring spends the question outward; it never returns to its author. This also means authoring builds *contributor* standing, never *play* mastery. Easy to state, easy to forget at one surface — enforce everywhere.
- Bulk actions (select-many, restore-all). Unneeded at 3/day — a one-at-a-time queue suffices. Revisit only if volume rises.
- Any "crafter role" abstraction (Decision C2).

## 6a. Panel B open decisions (small — ratify with the rest)
- **F — What does "demand" mean for a crafter worklist?** `getThinActiveDomains` defines "active" as declared-in-last-N-days (a *refill-budget* notion). A crafter worklist may want "players actively *playing* and hitting bottom" (Ari's behavior) instead. Small query adjustment; decide the definition.
- **G — Does "shallow" count human-authored depth?** The pool-depth query counts machine-pool (`generatedQuestions`). For a crafter, "shallow" should mean "few *good* (human-authored) questions," so blend in the human count. Otherwise Panel B points at domains that are machine-thin but human-rich, or vice versa.

## 7. Done-when (for the eventual build prompt — not this doc)

- The review queue shows BOTH open `contentReports` AND `verificationVerdict='demoted'` questions, one merged list.
- `edit` and `restore-from-demote` actions exist; restore clears `needs_review` back to live per Decision B.
- Robyn's id in `ADMIN_USER_IDS`; both can review.
- No hard `DELETE` path; all removals reversible per Decision A.
- Machine rows show the verifier's evidence per Decision D.
- Migration only if E proves one is needed.

## 8. DO-NOT

- DO NOT build from this doc until it is ratified (it is a thinking artifact today).
- DO NOT add domain-routing, authoring panels, bulk actions, or a crafter-role abstraction (all deferred, §6).
- DO NOT introduce a hard-delete path (Decision A).
- DO NOT elevate a generalist restore to author-confirmed (Decision B).
- DO NOT unpause the supply work — this is unrelated and the pause holds.
