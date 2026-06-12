# Structural Code Review — 2026-06-12

Two-pass audit: Pass 1 diagnoses structural problems (known suspects confirmed/cleared inline);
Pass 2 provides B-prompts for everything above Medium severity. All claims verified against code
at HEAD of this branch; file:line references are to that state.

---

## Pass 1 — Diagnosis

### Known suspects — verdicts

| Suspect | Verdict | Evidence |
|---|---|---|
| `/activities` entry point fragile | **CLEARED** | Wired three ways: header bell (`src/components/Nav.tsx:145`), home "See all activity →" (`RecentActivitySection.tsx:28`), feed overflow row (`FeedList.tsx:1978`). No query-param or proxy dependencies. The fragility *impression* comes from PRD-D-0 §77, which still says the surface is "not reachable" — doc drift, folded into STRUCT-07. |
| `authored_shared` misnamed/misused | **CLEARED (data model)** | Active write path behind the "Share with all friends" checkbox, reintroduced PR #254 (`src/server/feed/visibility.ts:10-14`, write at `api/questions/route.ts:333-342`). The `'wrote this'` display verb claiming authorship unconditionally is **already an open decision** — DECISIONS.md line 52 / conformance audit §3.2. Not re-opened here. |
| `season_points_start` stale | **CLEARED** | Already renamed to `lifetime_points_baseline` in migration `drizzle/0043_rename_season_points_to_lifetime_baseline.sql`; schema at `schema.ts:427`. Name now matches behavior (frozen baseline, mutated only on domain merge). |
| `JoshingGame*` tables dead | **CLEARED — intentional dormancy** | Creation is feature-gated ("coming soon", `src/app/new-game/page.tsx:8`; PRD-D-0 §78 documents `GAME_CREATION_DISABLED_IN_V11_1`), but read paths (`/games/[id]`, API, summary) stay live for existing rows. Documented deferral, not dead code. Open product question: re-enable or delete (flagged below). |
| Retired vocabulary in tree | **MOSTLY CLEARED** | "Ceremony" and "feed" are **not retired** — ceremony is a live weekly surface (cron, `CeremonyPin`, 9 tests); "feed" is the live home-edition infrastructure per PRD-D-1. "Off-season": zero hits. "Seasons": dead but contained to one `@deprecated`, zero-import file (`src/server/mastery/season-snapshot.ts`) — folded into STRUCT-07. |
| `questionType` hardcoded `'factual'` | **CONFIRMED** | → STRUCT-02. |
| `surfacePriorityScore` dead column | **INTENTIONAL DEFERRAL** | Written on thumbs (`queries/ratings.ts:27,47,52`; `api/feed/[feedItemId]/thumbsup/route.ts:39`), never read for ordering — but DECISIONS.md line 50 logs the weighting model as an open decision. Skipped per rules. The *duplicated write path + runtime DDL shim* around it is a real finding → STRUCT-06. |
| Grader fail-direction trap | **CLEARED** | `gradeAnswer` returns a discriminated union (`GradeOutcome = ScoredGrade \| UnscoredGrade`, `src/server/grading.ts:38`); `UnscoredGrade` has **no `result` field**, so conflating outage with "wrong" is a compile error. All 8 call sites check `status === 'unscored'` and return 503 (or throw `JoshingGameGraderUnavailableError`). Regression test: `src/server/__tests__/grading-fail-toward-player.test.ts`. There is no per-route sibling flag to forget — the type system enforces it. |
| Safety-rejected questions leak via fan-out | **CONFIRMED** | → STRUCT-01. |

### Findings (prioritized)

| ID | Area | Problem | Severity | Blast radius |
|---|---|---|---|---|
| **STRUCT-01** | architecture / data model | **Safety-vet gap on the fan-out path — three coupled defects.** The synchronous safety hard-block is correct (`api/questions/route.ts:270-284` short-circuits all fan-out). The hole is the deferred path: (a) when the inline Haiku vet fails, the verdict falls back to `needs_review` (`route.ts:215`), `blockedVisibility` is null, and **fan-out proceeds** — direct-send `feedItems` rows + SMS go out (`route.ts:373-416`); (b) when the cron later detects the safety fail and sets `visibility='blocked'` (`cron/vet-questions/route.ts:86`), already-fanned-out rows are **not retracted**, and `feedItemVisibilityPredicate` **exempts `direct_sent` from visibility checks entirely** (`queries/feed.ts:286-291`), so the blocked question still renders for named recipients; (c) the cron sweep only scans `visibility='public'` rows (`cron/vet-questions/route.ts:43`), so a friends/private question whose inline vet failed is **never re-vetted at all** — the comment at `route.ts:212-213` ("the cron sweep re-vets these") is false for them. No test covers `'blocked'` filtering (`question-visibility.test.ts` checks only public/friends/private) or the deferred-vet → fan-out → cron-block sequence. | **High** — a real content-safety leak to named recipients, but gated on an inline-vet infrastructure failure coinciding with genuinely unsafe content; the synchronous path is correct. | Touches the question-creation route, the vet cron, and the feed visibility predicate that badge counts and `get-feed-page` diagnostics also use. Fixing the predicate alone would regress the legitimate exemption (direct sends to non-followers, `feed.ts:277-285`) — the fix must distinguish `'blocked'` from `'friends'/'private'`. |
| **STRUCT-02** | types / correctness | **`questionType` hardcoded `'factual'` on three grading paths, silently killing personal-question leniency.** `api/daily/answer/route.ts:232`, `api/daily/catchup/answer/route.ts:143` (bot-daily branch), `api/replay/grade/route.ts:74` pass the literal `'factual'`; five other call sites correctly pass `question.questionType` (feed answer, profile answer, milestone, catchup-feed branch, joshing-game). Root enabler: `gradeAnswer` has a **default parameter** `questionType: string = 'factual'` (`src/server/grading.ts:65`) typed as `string`, so omission or hardcoding is invisible to the compiler. Players answering personal-type questions in Daily Five and Replay are graded against the factual rubric instead of the leniency branch (`src/lib/llm.ts:615`). | **High** — silently wrong grading outcomes on the core daily loop; users lose credit the question's author intended them to get. | Grading outcomes feed mastery/points; making Daily stricter→lenient changes scoring distribution. Replay is currently an orphaned surface (no inbound links), so its fix is low-risk. Small diff, but needs the type tightened to prevent recurrence. |
| **STRUCT-03** | architecture | **The answer pipeline is smeared across 8 route handlers instead of living in one server module.** `api/daily/catchup/answer/route.ts` (553 lines), `api/daily/answer/route.ts` (480), `api/questions/route.ts` (448) each inline Drizzle table access, transactions, grading orchestration, mastery writes, author credit, and feed propagation — violating the repo's own conventions (DB access in `src/server/db/queries/`, business logic in server modules). STRUCT-02 is a *symptom*: eight call sites independently assemble the same grade→mastery→propagate sequence, so per-route drift (like a hardcoded `'factual'`) is structurally inevitable. Counter-examples prove the pattern works here: `api/feed/route.ts` (68 lines, delegates to `getFeedPagePayload`), `api/friend-requests/route.ts` (98 lines). | **High** — this is the structural root cause of the per-route inconsistency class; every future answer-path change multiplies by 8. | The answer routes are the core gameplay loop — highest-traffic, highest-stakes code in the app. A big-bang refactor is the riskiest possible change; must be phased with characterization tests first. |
| **STRUCT-04** | testing | **`src/proxy.ts` — the auth, session-refresh, and onboarding gate for every request — has zero tests.** Compounding: this exact file has a documented recurring-regression history (the `middleware.ts` consolidation has been reverted "at least 5 times" per CLAUDE.md and the `check-middleware` skill), i.e. it's the file most likely to be rewritten under pressure, and nothing would catch a broken rewrite. Same gap class: `vet-question.ts`/`vet-verdict.ts` (the safety layer) have zero unit tests — covered under STRUCT-01's remediation. | **High** — untested auth gate × demonstrated rewrite churn = silent lockout/leak risk on every touch. | Test-only change; zero runtime risk. Needs JWT fixtures and a harness for the edge runtime request shape. |
| **STRUCT-05** | styling / components | **`FeedList.tsx` is a 2,054-line client component** owning card rendering, thumbs state/timers, overflow rows, budget logic, and texture-zone composition. It is the single largest file in `src/` and the convergence point of three product seams (home edition, overflow subpages, tier system). D-HOME-PACING-01 and `B-VISUAL-CARD-TIERS-01` both land here next. | **Medium** — works today, but every upcoming home-pacing/tier change pays a coupling tax; splitting *before* those land is much cheaper than after. | The `feed-card-changes` validation agent and `feed-card-audit` skill watch this surface; any split must keep switch exhaustiveness and test parity. Defer the split until D-HOME-PACING-01 is sequenced, then do it as that work's first phase. |
| **STRUCT-06** | data model / conventions | **Thumbs write path is duplicated and a runtime DDL shim lives in the query layer.** `surfacePriorityScore` increments exist in both `queries/ratings.ts:47` and inline in the route handler `api/feed/[feedItemId]/thumbsup/route.ts:39` (convention violation + drift risk between the two). Separately, `queries/questions.ts:88-96` runs `ALTER TABLE … ADD COLUMN IF NOT EXISTS` lazily at query time — the repo's convention places idempotent guards in `src/instrumentation.ts`, not the query layer, and a query-time DDL can mask journal/migration drift. | **Medium** — no user-visible harm today, but two write paths for one signal will diverge, and the DDL shim undermines the migration discipline CLAUDE.md works hard to maintain. | Small, contained. Note: if thumbs is *actually* deprecated (open question below), consolidation may become deletion — confirm direction before spending effort. |
| **STRUCT-07** | dead code / docs | **Residual cruft, all Low:** (a) `src/server/mastery/season-snapshot.ts` — `@deprecated`, zero imports, delete; (b) PRD-D-0 §77 says `/activities` is "not a reachable surface" — false since it shipped (header bell + two more entry points); (c) `/replay` and `/archive` are fully built with zero inbound links — *intentional* deferral per PRD-D-0 §76, but worth a one-line breadcrumb in DECISIONS.md so the next audit doesn't re-litigate them. | **Low** — none of this misleads code, only readers. | Doc edits + one file deletion; trivial. |

### Open product questions (flagged, not prescribed)

1. **Is thumbs actually deprecated?** The brief says deprecated; the code is fully live (routes, `questionFeedback` writes, `surfacePriorityScore` writes, FeedList UI). DECISIONS.md treats thumbs→ordering as open, not thumbs as removed. STRUCT-06's remediation shape depends on the answer (consolidate vs. delete).
2. **`'wrote this'` verb on `authored_shared` broadcast** — already open (DECISIONS.md line 52); resolve before D-3 work, per the existing note.
3. **JoshingGame: re-enable or remove?** PRD-D-0 §78 documents the gate, but four tables + a query module + three API routes + two pages are carried for a feature off since v11.1. A decision either way retires real maintenance surface.
4. **`/replay` and `/archive`** — deferred per PRD-D-0 §76; confirm they're still on the roadmap or delete (replay carries one of the STRUCT-02 hardcodes).

### Explicitly NOT findings

- Grader fail-direction (well-engineered; the discriminated union is the correct fix already in place).
- `/activities`, `proxy.ts` routing structure, bottom nav (4 tabs match live surfaces; no `middleware.ts` present).
- Ceremony/feed vocabulary (live product surfaces, not retired).
- `surfacePriorityScore` as a deferral (logged open decision); `lifetime_points_baseline` (already fixed).

---

## Pass 2 — Remediation B-prompts

Issued for the four High findings. Notes on the house format: `Master_App_Instructions-v2.md` does not exist in this repo, and `PRD-v11.2.md` is archived/superseded (`_docs/archive/`, per DECISIONS.md) — each prompt below names the in-repo equivalents (CLAUDE.md, DECISIONS.md, the relevant PRD-D-* spec). Restore the master-instructions reference when handing these off if that file lives outside the repo.

---

### B-SAFETY-VET-01 — Close the deferred-vet fan-out leak (STRUCT-01)

**Context files (read first):** `CLAUDE.md`, `DECISIONS.md`, `PRD-D-6-CONTENT-REPORTING.md`, `src/app/api/questions/route.ts`, `src/app/api/cron/vet-questions/route.ts`, `src/server/db/queries/feed.ts` (the visibility predicates and their comments), `src/server/llm/vet-question.ts`, `src/server/llm/vet-verdict.ts`.

**Goal:** A question that fails (or has not yet passed) safety vetting must never render for any recipient — including named direct-send recipients — and every question must eventually receive a definitive safety verdict regardless of its visibility setting.

**Drift-risk callouts:**
- `feedItemVisibilityPredicate`'s `direct_sent` exemption (`queries/feed.ts:286-291`) is **load-bearing and correct** for `'friends'`/`'private'` visibility (direct sends to non-followers must render — see the comment block above it). The fix must carve out only `'blocked'`, not remove the exemption.
- The predicate is exported and shared with `get-feed-page`'s badge/diagnostic counts — change it in one place only; do not fork a second predicate.
- The cron's `visibility='public'` filter exists to avoid re-vetting already-blocked rows (comment at `cron/vet-questions/route.ts:67-71`). Widening the sweep must preserve "never flip a blocked question back to shareable."
- Cron concurrency is capped at 4 to stay under the DB pool cap of 5 (`CLAUDE.md`, `src/server/db/index.ts:23`). Do not raise it.
- Zod-on-every-input convention applies to any new/modified route input.

**Phases:**
1. **Characterize (no behavior change).** Add failing/red tests that encode the leak: (a) a `direct_sent` feed row whose question has `visibility='blocked'` must NOT be returned by the feed query (extend `question-visibility.test.ts`, which today never tests `'blocked'`); (b) a question created with `sendToFriendIds` while the vet promise rejects ends `needs_review` with fan-out rows written (current behavior, documented as the bug). **⛔ Checkpoint: present the failing tests and the proposed fix shape for approval before changing behavior — the fix choice (gate fan-out on verdict vs. render-time filter vs. both) is consequential.**
2. **Render-time backstop.** Make `'blocked'` filter unconditionally: the `direct_sent` exemption applies to `'public'/'friends'/'private'` only. Verify badge counts (`get-feed-page`) move in lockstep since they share the predicate.
3. **Sweep coverage.** Remove the `visibility='public'` restriction from the vet cron's scan (keep `publicStatus='not_scored'` + not-deleted; add `ne(visibility,'blocked')` so blocked rows are still never re-vetted). Every failed-inline-vet question now gets a definitive verdict.
4. **(Approval-gated, optional hardening.)** Decide whether fan-out should be deferred entirely when the inline verdict is `needs_review` (recipients get the question only after the cron clears it). This changes product behavior (delivery latency on Haiku hiccups) — **do not implement without explicit approval**; present the trade-off instead.
5. Run the full suite + `npx tsc -p tsconfig.typecheck.json`; confirm the Phase 1 tests are green.

**Do NOT:**
- Do not remove or weaken the `direct_sent` exemption for non-blocked visibilities.
- Do not retroactively delete `feedItems` rows in this prompt (retraction policy is a product decision; the render-time filter makes rows inert).
- Do not touch `src/middleware.ts` (must not exist), migrations, or the DB pool cap.
- Do not change what `verdictToBlockedVisibility` considers a safety fail.
- Do not name the triggered safety category in any user-facing copy (existing convention, `route.ts:273-274`).

**Done when:**
- [ ] A `'blocked'` question never renders via any feed path, including `direct_sent`, with a test proving it.
- [ ] Badge/diagnostic counts agree with what renders (shared predicate, test or assertion).
- [ ] The vet cron sweeps `not_scored` questions of every visibility except `'blocked'`, with a test.
- [ ] The misleading comment at `api/questions/route.ts:212-213` is corrected.
- [ ] Full test suite + typecheck green; no new lint errors; codebase deploys clean.

---

### B-GRADE-TYPE-01 — Stop hardcoding `questionType: 'factual'` (STRUCT-02)

**Context files (read first):** `CLAUDE.md`, `DECISIONS.md`, `PRD-D-5-QUESTION-QUALITY-FLOOR-VERIFICATION-SPEC.md`, `src/server/grading.ts`, `src/lib/llm.ts` (the leniency branch near line 615), the three offending routes (`api/daily/answer/route.ts`, `api/daily/catchup/answer/route.ts`, `api/replay/grade/route.ts`), and one correct caller for reference (`api/feed/[feedItemId]/answer/route.ts:103`).

**Goal:** Every grading call passes the question's real `questionType`; the API makes hardcoding impossible to reintroduce silently.

**Drift-risk callouts:**
- Grading model split is locked: Haiku for grading (`CLAUDE.md`) — do not touch model selection.
- The `unscored`/503 fail-toward-player contract is correct and tested — preserve `GradeOutcome` exactly.
- Daily/catchup routes are the fat handlers targeted by B-ANSWER-PIPELINE-01; keep this diff surgical (parameter plumbing only) so the two prompts don't collide.
- Verify the bot-daily branch's question row actually carries a meaningful `questionType` before plumbing it — if generated dailies are *always* factual by construction, say so and narrow the fix (that branch may be a correct hardcode wearing a bad disguise; **flag, don't guess**).

**Phases:**
1. **Audit + tighten the type.** Change `gradeAnswer`'s `questionType` parameter from `string = 'factual'` to a required union (`'factual' | 'personal'` or whatever the schema enum actually is — read `schema.ts`). Let the compiler enumerate every call site. **⛔ Checkpoint: report what each of the 8 call sites *should* pass (including the bot-daily finding from the drift callout) before changing behavior.**
2. **Plumb the real type** through the three offending paths, selecting `questionType` in the rows those routes already fetch.
3. **Test:** one test per fixed path asserting a personal-type question reaches the grader with `'personal'`; keep `grading-fail-toward-player.test.ts` green.

**Do NOT:**
- Do not alter the leniency prompt text in `src/lib/llm.ts` — this prompt fixes plumbing, not policy.
- Do not refactor the answer routes beyond the parameter (that is B-ANSWER-PIPELINE-01).
- Do not leave a default value on the parameter — required, no fallback.
- Do not change recheck (`src/server/llm/recheck.ts`); it is a deliberately separate path.

**Done when:**
- [ ] `gradeAnswer` requires a typed `questionType`; the literal-`'factual'` call sites are gone or individually justified in a code comment stating the invariant (e.g., "generated dailies are factual by construction").
- [ ] Per-path tests prove the question's stored type reaches the grader.
- [ ] Typecheck, lint, full suite green; grading behavior for genuinely factual questions unchanged.

---

### B-ANSWER-PIPELINE-01 — Extract the shared answer pipeline (STRUCT-03)

**Context files (read first):** `CLAUDE.md` (queries-layer and Zod conventions), `DECISIONS.md`, `PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md`, the three fat handlers (`api/daily/catchup/answer/route.ts` 553 LOC, `api/daily/answer/route.ts` 480 LOC, `api/questions/route.ts` 448 LOC), the two thin exemplars (`api/feed/route.ts`, `api/friend-requests/route.ts`), `src/server/grading.ts`, `src/server/mastery/`, `src/server/feed/create-feed-items-for-answer.ts`.

**Goal:** One server module owns the grade → mastery/credit → feed-propagation sequence; route handlers shrink to validate-authenticate-delegate-respond. This is the highest-risk change in the audit — it rewires the core gameplay loop — so it is gated harder than the others.

**Drift-risk callouts:**
- **This is incremental extraction, not a rewrite.** Behavior must be bit-identical at each phase; any intentional behavior change found along the way gets flagged, not fixed in-flight.
- B-GRADE-TYPE-01 should land first (small, surgical); rebase on it rather than absorbing it.
- Transactions: the daily routes manage multi-table transactions inline — extraction must preserve exact transaction boundaries, or atomicity bugs appear under concurrency.
- DB queue mutations belong in `src/server/db/queries/daily.ts`; orchestration in a new `src/server/answers/` (or similar) module — keep the repo's existing layering vocabulary.
- Do not add a `middleware.ts`; do not touch migrations or the pool cap.

**Phases:**
1. **Characterization tests first.** Before moving any code, add route-level tests for the three fat handlers covering: correct answer, wrong answer, `unscored` (503), already-answered/dedup, and the points/mastery side effects. These are the safety net; without them this refactor is gambling. **⛔ Checkpoint: present coverage and get approval on the proposed module boundary (one `submitAnswer` orchestrator vs. per-surface variants) before extraction.**
2. **Extract the orchestrator** and migrate ONE route (suggest `api/daily/answer` — large but simpler than catchup). Diff the behavior under the Phase-1 tests. **⛔ Checkpoint: approval before migrating the rest.**
3. **Migrate the remaining answer routes** one per commit (catchup's two branches, feed answer, profile answer, milestone, joshing-game can delegate where it fits its error contract).
4. **Shrink `api/questions/route.ts`** by moving creation orchestration (categorize → vet → create → fan-out) into a server module, preserving the B-SAFETY-VET-01 ordering guarantees if that has landed.
5. Full suite, typecheck, lint, `npm run build`.

**Do NOT:**
- Do not change any user-visible behavior, status codes, or response shapes.
- Do not migrate more than one route per commit; every commit leaves the app deployable.
- Do not "improve" grading, points, or propagation logic while moving it — flag, don't fix.
- Do not let the orchestrator grow route-specific branches; if a surface genuinely differs, that difference stays in its route.

**Done when:**
- [ ] One server module owns grade→mastery→propagate; answer routes are ≤ ~120 lines of validate/delegate/respond.
- [ ] Characterization tests written *before* extraction still pass unmodified.
- [ ] No inline Drizzle table access remains in the migrated handlers (queries-layer convention restored).
- [ ] Every commit in the sequence builds and passes the suite (verified, not assumed).

---

### B-PROXY-TESTS-01 — Test the auth gate before it gets rewritten again (STRUCT-04)

**Context files (read first):** `CLAUDE.md` (routing/middleware section — the recurrence history is the whole motivation), `src/proxy.ts` (134 lines, read fully), commit `635abc6` (`git show`), `vitest.config.ts` / `vitest.setup.ts`.

**Goal:** A test suite that fails if `src/proxy.ts`'s observable contract changes: who gets in, who gets bounced where, and which paths are exempt. Given this file has been regressed "at least 5 times," these tests are the tripwire CLAUDE.md's prose warning has failed to be.

**Drift-risk callouts:**
- Test-only prompt: **zero changes to `src/proxy.ts`** unless a test reveals an actual bug — in which case stop and report, don't fix.
- Never create `src/middleware.ts`, including in test fixtures or mocks.
- JWT fixtures must be self-contained test keys — no real secrets; respect that `PHONE_HASH_SALT` and session config are env-dependent (stub the env in setup).
- The matcher config (`proxy.ts:132-136`) is declarative and not directly executable in vitest — test the exported function's behavior per-path and assert the matcher array literally (snapshot), which still catches accidental edits.

**Phases:**
1. Build the harness: construct edge-style `NextRequest`s with/without session cookies; fixture JWTs for valid, legacy-missing-`inv`-claim, and expired sessions.
2. Cover the contract: unauthenticated → `/login` with `next` param preserved; exemptions (`/login`, `/invite/*`, `/u/*`) pass through logged-out; legacy session → refresh redirect; incomplete onboarding → refresh→`/onboarding` bounce; authenticated+onboarded → pass-through; matcher exclusions (`/api/auth`, `/api/cron`, `/api/share`, `/share`, `/images`) asserted.
3. Add a guard test that `src/middleware.ts` does not exist (one `fs.existsSync` assertion — cheap, and it automates the `check-middleware` skill's manual check in CI).

**Do NOT:**
- Do not modify proxy behavior, the matcher, or any route.
- Do not import server-only modules that drag the DB into the test (the proxy must stay edge-light; if a test forces a DB import, that's a finding to report).
- Do not snapshot entire response objects (brittle); assert status + `Location` + the specific cookie/claim behavior.

**Done when:**
- [ ] Every branch in `proxy.ts` (auth, exemption, legacy-session, onboarding, pass-through) has at least one test; ~8–12 tests total.
- [ ] The no-`middleware.ts` guard test exists and runs in the default suite.
- [ ] Suite green locally; no production code changed.

---

*Audit conducted 2026-06-12. Verified findings: hardcoded `'factual'` literals, the `direct_sent` visibility exemption, the cron's `visibility='public'` scan filter, fan-out ordering in the create route, and line counts were all confirmed by direct file reads, not just sub-investigation reports.*
