# Joshing Codebase Audit — Phase 1 Triage

_Date: 2026-05-16 · Scope: read-only, five-lens triage · PRD anchor: PRD-v11.1.md_

---

## 1. Codebase map

**Framework / structure.** Next.js 16.1 (App Router), React 19, TypeScript strict. Source is `src/` split into `app/` (routes + API handlers), `components/` (UI, `ui/` primitives), `lib/` (cross-cutting helpers, LLM glue, ceremony mode), `server/` (domain services: `auth`, `mastery`, `ceremony`, `friends`, `daily`, `feed`, `db/`, `grading`, `adaptive-difficulty`, `replay`). State is server-driven; client components hold local UI state only. Real-time/async is poll-based (no websockets); ceremony runs through a biweekly cron (`src/app/api/cron/biweekly-ceremony/route.ts`). Auth is phone + OTP via JWT session with `invitationAccepted` flag in payload. Styling: Tailwind v4 + OKLch CSS variables; fonts loaded: Montserrat only — Caveat, Playfair Display, and the INK/CREAM/HILITE brand tokens remain absent. Tests: Vitest, colocated `*.test.ts`; coverage strong on mastery scoring, friend invitations, feed visibility; weaker on ceremony mode branching and author-credit correctness.

**Data layer / v11.1 schema additions / prior audit status.** Drizzle ORM + PostgreSQL (Supabase) is authoritative; Prisma is still in `package.json` but unused at runtime (outstanding P3 from prior audit). PRD v11.1 schema additions are implemented: `birth_year` / `grew_up_country` / `grew_up_region` on users; `territory_type` on KB domains; `quip` on `JoshingGameResponse`; `surface_priority_score` on questions; `FeedDismissedDomain` table; `BiweeklyCeremony` unique index on `(userId, cycleStart, cycleEnd)`. Prior audit P0/P1 items now **addressed**: invitation bypass in `verify-otp` (F1.1/F1.2), hardcoded answer-state on all three answer surfaces (F2.1–F2.3), ceremony duplicate-row race (F3.3), Beat 4 visibility leak (F3.4), `DifficultyEstimate` type drift (F4.2), unused `ceremonyModeFromAnsweringCount` (F3.2), deprecated `awards.ts` (F2.6 — deleted; functions moved to `scoring.ts`). Prior audit items still **outstanding**: no app-wide middleware (F1.3), onboarding invitation check absent (F1.4), author-credit model divergence (F2.5). F3.1 (ceremony model) **resolved 2026-05-16** — code is correct, PRD is stale; ceremony is biweekly-personal.

---

## 2. Top-10 risk list

| # | Lens | Severity | Finding (one sentence) | File hint | Likely fix side |
|---|------|----------|------------------------|-----------|-----------------|
| 1 | Gameplay | **P1** | Author-credit logic implements an empirical-rate windowed scheme with no difficulty filter, diverging from the PRD-locked rule (0.5× difficulty, moderate/specialist only, one credit per question per answering player); `AUTHOR_CREDIT_WEIGHT = 0.5` is defined in constants but unused, so the Master-tier gate receives wrong inputs. | `src/server/mastery/scoring.ts:70–94`, `src/server/mastery/constants.ts:36–41` | discuss |
| 2 | Resilience | **P1** | `verify-otp` explicitly grants any existing user a session with `invitationAccepted: true` regardless of actual invitation history — pre-fix accounts and race-window orphan rows (provisional user created but invitation claim lost) are permanently grandfathered; no downstream route re-validates invitation state. | `src/app/api/auth/verify-otp/route.ts:113–127` | discuss |
| 3 | Resilience | **P1** | Onboarding page renders for any authenticated user with `onboardingComplete = false` without verifying invitation membership — a belt-and-suspenders check the PRD permanently requires but the code omits. | `src/app/onboarding/page.tsx:8–32` | code |
| 4 | Gameplay | ~~P1~~ **RESOLVED** | ~~The PRD two-act ceremony does not exist in code — only a biweekly personal cron.~~ **Confirmed 2026-05-16: ceremony is biweekly-personal. Code is correct; PRD sections describing per-game ceremony are stale and must be rewritten. No engineering action required.** | `src/server/ceremony/fire-ceremony.ts`, `src/app/api/cron/biweekly-ceremony/route.ts` | PRD update |
| 5 | Resilience | **P1** | No `src/middleware.ts` exists; once a session is minted, every authenticated surface is reachable with no middleware-level invitation re-check — regression in a future auth path would silently re-open the gate. | (no file) | code |
| 6 | Gameplay | **P2** | Catch-up recovery (`first_correct_after_wrong`) compounds two 0.25× multipliers — `CATCHUP_SURFACE_WEIGHT × RECOVERY_STATE_WEIGHT = 6.25%` of live base — but the PRD is silent on how catch-up and recovery combine; may be unintentional. | `src/app/api/daily/catchup/answer/route.ts:122–128`, `src/server/mastery/constants.ts` | discuss |
| 7 | UX | **P2** | Caveat (handwriting) and Playfair Display italic are still not loaded; `INK`, `CREAM`, and `HILITE` brand tokens are not encoded in CSS; body font is Montserrat rather than the spec's Inter. | `src/app/layout.tsx`, `src/app/globals.css` | code (fonts) / discuss (Inter vs Montserrat) |
| 8 | Code | **P3** | PRD v11.1 §10 specifies `feed_items.source_result` as `enum correct \| incorrect, nullable`; the schema stores it as unconstrained `text`, allowing any string to be silently persisted. | `src/server/db/schema.ts:683` | code |
| 9 | Code | **P3** | `AUTHORED_SHARED_FEED_SOURCE_TYPE` is still exported from `visibility.ts` despite PRD v11.1 explicitly killing authored-shared writes at the application layer — live read filters include it as legacy, but the export misleads future contributors about what is still active. | `src/server/feed/visibility.ts:6` | code |
| 10 | Spec Drift | **P3** | Daily quips are stored in the JSONB queue slot rather than a typed DB column; PRD §8.1.14 says "stored on the answer record" to enable consistency on refresh — the slot is the de-facto answer record for Daily but prevents quip-level analytics. | `src/app/api/daily/answer/route.ts:218–220` | PRD |

---

## 3. Proposed Phase 2 deep-dives

1. **Author-credit model resolution.** Map exactly what `creatorMasteryAwardForNthCorrect` computes vs. the PRD-locked rule; quantify how the gap affects Master-tier reachability; confirm the per-answerer idempotency path. _Why: P1 correctness directly affecting the game's most prestigious tier._

2. **Re-login / invitation gate completeness.** Enumerate every path by which a session can exist without a validated accepted invitation — pre-fix orphan accounts, race-window users, token-less re-logins — and propose a remediation policy. _Why: residual gap in the P0 invitation-only model that the May 15 fix didn't fully close._

3. **Ceremony state machine — two-act vs. biweekly.** Determine definitively which model is current spec; if two-act, map the entire implementation gap (new table, all-players trigger, Act 1/2 fire logic, mode branching); if biweekly-only, list which PRD sections require rewriting. _Why: the largest unresolved architectural question; no engineering action is well-defined until this is settled._

4. **Design-system conformance pass.** Map every primary surface (home, daily, ceremony, knowledge, feed) against the locked palette/typography rules; verify tier-anchored circle sizing (§8.4.8) is implemented; confirm "Other"/"General" labels never reach the UI. _Why: the brand register is a locked product principle with no exception, and the font/token gap spans all surfaces._

5. **Onboarding LLM cultural anchor.** Read `src/app/api/onboarding/propose-interests/route.ts` and confirm it combines birth year, geography, and warm-up answers to generate hyper-specific culturally-anchored candidates as specified in §7.3; check fallback behavior when geography produces insufficient signal. _Why: the §7.3 onboarding revision is a PRD v11.1 feature with non-trivial LLM prompt requirements; it has not been verified at the implementation level._

---

_Phase 1 complete. Awaiting approval before beginning Phase 2._
