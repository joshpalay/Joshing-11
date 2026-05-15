# Joshing Codebase Audit — Phase 1 Triage

_Date: 2026-05-15 · Scope: read-only, four-lens triage · Deliverable: one page._

---

## 1. Codebase map

**Framework / structure.** Next.js 16 (App Router) with React server components. Source lives under `src/` split into `app/` (routes + API handlers), `components/` (UI, including a `ui/` primitives folder), `lib/` (cross-cutting helpers, constants, LLM glue), `server/` (domain services: `auth`, `mastery`, `ceremony`, `friends`, `daily`, `feed`, `db/`, `grading`, `adaptive-difficulty`, `replay`). State is server-driven; client components hold local UI state only. Real-time/async is poll-based (no websockets); ceremony progression runs through a cron route (`src/app/api/cron/biweekly-ceremony/route.ts`). Auth is phone+OTP via JWT session (`src/server/auth/session.ts`), with a hardcoded `000000` bypass (out of scope per instruction). Styling uses Tailwind v4 with OKLch CSS variables in `src/app/globals.css`; layout font is Montserrat (`src/app/layout.tsx`); Georgia and Courier New referenced inline.

**Data layer & tests.** Two ORMs are declared in `package.json` — **only Drizzle is used at runtime**; `prisma/schema.prisma` exists but no Prisma client is imported anywhere. Drizzle schema (`src/server/db/schema.ts`, ~35 tables) is authoritative and has drifted significantly from the Prisma file. Domains: User, Question, Answer, Group, Game, DailyAssignment/Session, PlayerMastery, MasteryEvent, BiweeklyCeremony, Friendship, FriendInvitation, Challenge*, UserDomainDifficulty, ProfileDomainVisibility. Tests are colocated `*.test.ts(x)` (Node test-runner style); coverage is strongest on mastery (`src/server/mastery/__tests__/`, 7 files), friend invitations, and feed; weakest on ceremony state-machine, ORM idempotency, and route-level auth.

---

## 2. Top-10 risk list

### Invitation system (special focus)

| # | Lens | Severity | One-sentence finding | File hint |
|---|------|----------|----------------------|-----------|
| I1 | Resilience | **P0** | `verify-otp` accepts an empty `invitationToken` and creates the session anyway — there is no invitation requirement at session creation, only a token-validity check when a token is supplied. | `src/app/api/auth/verify-otp/route.ts:54–133` |
| I2 | Resilience | **P0** | `getOrCreateUserForLogin()` auto-creates a User on first OTP success with zero check that any FriendInvitation row references their phone — uninvited phones become full users. | `src/server/auth/user.ts` (called from `verify-otp/route.ts:96–102`) |
| I3 | Resilience | **P1** | No app-wide middleware enforces "accepted invitation" on authenticated routes; each page calls `getSession()` only — once a session exists (see I1/I2), every surface is reachable. | (no `src/middleware.ts`); page guards e.g. `src/app/games/[id]/page.tsx:13`, `src/app/daily/page.tsx` |
| I4 | Resilience | **P2** | Invitation rate-limit uses an in-process `Map` (per-user, per-phone). On multi-instance deploy or restart the cap is lost. | `src/server/friends/invitations.ts` (rate-limit section) |
| I5 | Resilience | **P2** | `/invite/[token]` landing page does not pre-validate the phone-match constraint; mismatch is only caught later inside `acceptFriendInvitation` (line 398), so a wrong-recipient user gets a misleading-but-rendered "valid" landing first. | `src/app/invite/[token]/page.tsx`, `src/server/friends/invitations.ts:365–449` |

### Cross-lens top findings

| # | Lens | Severity | One-sentence finding | File hint |
|---|------|----------|----------------------|-----------|
| 1 | Gameplay | **P0** | `/api/daily/answer` and `/api/daily/catchup/answer` hardcode `answer_state` to `first_correct \| incorrect` and never detect `repeat_correct` or `first_correct_after_wrong` — daily players keep earning full credit on repeats, catchup keeps awarding 0.25× on repeats; only `/api/feed/.../answer` does the lookup correctly. | `src/app/api/daily/answer/route.ts:186`, `src/app/api/daily/catchup/answer/route.ts:104`, vs. `src/app/api/feed/[feedItemId]/answer/route.ts:84`; canonical helper `src/server/answer-state.ts:13–31` is unused |
| 2 | Gameplay | **P1** | Author credit (`0.5×`) is awarded for *any* difficulty in `write-mastery-event.ts`; the Moderate/Specialist gate from the rule is not enforced — Accessible questions wrongly mint author credit. | `src/server/mastery/write-mastery-event.ts:107–112`, `src/server/mastery/awards.ts:42–93` |
| 3 | Gameplay | **P1** | The implemented ceremony is a single **biweekly personal** cron payload — Act 1 / Act 2 split, per-game firing, "all active players finished" detection, and mode-specific (group/duo/solo) beat branching do not exist in code. | `src/server/ceremony/fire-ceremony.ts:17–66`, `src/server/ceremony/compute-beats.ts`, `src/lib/ceremony/mode.ts:3–7`, `src/app/api/cron/biweekly-ceremony/route.ts` |
| 4 | Resilience | **P1** | `biweeklyCeremonies` has no unique constraint on `(userId, cycle_start, cycle_end)`; idempotency relies on a time-window query that races a concurrent cron tick or refresh, allowing duplicate ceremony rows. | `src/server/db/schema.ts:755–771`, `src/server/ceremony/fire-ceremony.ts:30–39` |
| 5 | Gameplay / UX | **P1** | Ceremony Beat 4 (best-aligned friend's domains) does not consult `ProfileDomainVisibility`, so a friend's "private" domains can be surfaced when they overlap on one public domain — soft privacy leak. | `src/server/ceremony/compute-beats.ts:236–265`, `src/server/mastery/ceremony.ts:210–253` |
| 6 | Code | **P2** | `src/types/db.ts` exports `DifficultyEstimate = 'easy' \| 'medium' \| 'hard' \| 'very_hard'` while the DB enum is `accessible \| moderate \| specialist` — client-side type lies about the schema. | `src/types/db.ts`, `src/server/db/schema.ts` (DifficultyEstimate enum) |
| 7 | Code | **P3** | Prisma is declared in `package.json` and `prisma/schema.prisma` is shipped, but no `@prisma/client` import exists anywhere — dead ORM next to live Drizzle, with drifted table/field definitions. | `package.json`, `prisma/schema.prisma`, `src/server/db/index.ts` |
| 8 | Code | **P3** | Scoring multipliers (`1.0`, `0.25`, `0.5`) and tier thresholds are inline magic numbers across at least three files; the canonical helper `computeAnswerState` is unused and `awards.ts` logs but does not enforce the Master-tier gate. | `src/server/mastery/awards.ts:42–93,267–273`, `src/server/mastery/write-mastery-event.ts:111`, `src/app/api/daily/catchup/answer/route.ts:73`, `src/server/mastery/tiers.ts:4–9` |
| 9 | UX | **P2** | Design system fonts **Caveat** and **Playfair Display italic** are not loaded anywhere — only Montserrat (body), Georgia (categories), Courier New (mono) actually ship; no `--ink`/`--cream`/`--wrong`/`--hilite` brand tokens, surfaces consume generic `--primary`/`--destructive` instead. | `src/app/layout.tsx:2,7–9`, `src/app/globals.css` (`:root`, `.dark`) |
| 10 | UX / Resilience | **P2** | Loading scaffolds exist for feed/daily, but several major surfaces (`activities`, `knowledge` empty-state, `replay`) lack explicit empty/error states and assume happy-path data; no global error boundary observed under `src/app/`. | `src/app/activities/`, `src/app/knowledge/page.tsx`, `src/app/replay/` |

---

## 3. Proposed Phase 2 deep-dives

1. **Invitation enforcement end-to-end.** Trace every authenticated entry point and prove (or disprove) that a session can exist without a corresponding accepted FriendInvitation. Includes I1–I5 plus a route-by-route guard inventory. _Why: P0 — invitation-only is the product's permanent gate._
2. **Mastery scoring correctness across the three answer routes.** Reconcile `daily/answer`, `daily/catchup/answer`, `feed/.../answer` against a single source of truth; quantify how much credit has likely been over-awarded; audit author-credit difficulty gate and the unused `answer-state.ts` helper. _Why: P0 correctness — directly contradicts the locked scoring rule._
3. **Ceremony state machine: spec vs. reality.** Decide whether the biweekly-personal model is the new spec or whether the two-act game ceremony still needs to land; map all gaps (Act 1/2 split, all-players-finished, mode branching, idempotency unique constraint, Beat 4 visibility leak). _Why: P1 — most of the rule is unimplemented; needs product clarification before fixes._
4. **Data-layer hygiene.** Confirm Prisma is dead, scope removal (deps, schema, migrations folder), and reconcile `src/types/db.ts` with the live Drizzle enums. Inventory remaining schema-drift between client and server types. _Why: P2/P3 — landmine for future contributors and TypeScript guarantees._
5. **Design-system conformance pass.** Map every surface against the locked palette/typography rule, find the missing-font load points, propose brand-named CSS variables, and verify "Other" / generic-category copy never leaks to UI. _Why: P1/P2 — design language is locked but tokens and fonts are inconsistent._

---

_Phase 1 complete. Awaiting approval before beginning Phase 2._
