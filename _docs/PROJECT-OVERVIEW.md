# Joshing v11 — Project Overview

## Product
**Joshing** is a daily knowledge game. Each day a user answers 5 questions drawn from their declared interest domains, tracks mastery per domain, and sees friends' answers in a social feed. Biweekly "ceremonies" celebrate achievements. Web-only, phone-based signup. Focus is trivia + social learning — no leaderboards, no streaks.

## Tech Stack
- **Framework:** Next.js 16.1.6 (App Router, strict TS)
- **DB:** Postgres 15+ on Supabase (pooled for app, direct for migrations)
- **ORM:** **Drizzle** (NOT Prisma — the README is stale on this point). Migrations in `drizzle/` (0000–0036, ~36 files), auto-applied at boot from `src/instrumentation.ts`.
- **Styling:** Tailwind CSS 4, shadcn/ui primitives in `src/components/ui/`
- **LLM:** Anthropic SDK. **Sonnet (`claude-sonnet-4-6`)** for generation; **Haiku (`claude-haiku-4-5-20251001`)** for grading/categorization. Centralized in `src/server/llm/` and `src/lib/llm.ts`.
- **Auth:** Custom JWT (dev: hardcoded phone; prod: SMS OTP, partially stubbed). `jose` + `bcryptjs`.
- **Validation:** Zod on every API input (mandatory).
- **State:** TanStack Query (server), React Context + useState (client)
- **Async:** Vercel Cron
- **Test:** Vitest
- **Host:** Vercel

## Source Layout (`src/`)
- `app/` — Next App Router pages + API routes
- `components/` — feature React components; `components/ui/` are shadcn primitives
- `server/` — backend domain logic, organized by area:
  - `db/schema.ts` + `db/queries/` (queries must live here, not in route handlers)
  - `llm/` (generation, grading, categorization, answer suggestions)
  - `auth/`, `activity/`, `answers/`, `ceremony/`, `daily/`, `feed/`, `friends/`, `grading/`, `knowledge/`, `mastery/`, `play/`, `profile/`, `questions/`, `replay/`
- `lib/` — utilities (game constants, ceremony helpers, categorization, onboarding, validation)
- `types/` — shared TS types
- `proxy.ts` — request proxy (Next 16). **Do NOT add `middleware.ts`** — it breaks the proxy (regression fixed 5 times: c02a980, 95157a1, 8c8a6f7, b5d8e7d, 635abc6).
- `instrumentation.ts` — startup hook that auto-applies migrations plus idempotent guards for partially-migrated preview/prod DBs. Read this before adding migrations that touch enums, NOT NULL columns, or additive columns.
- `env-check.ts` — env var validation

## Routing
**Pages**: `/` (home), `/login`, `/daily` (+ `/setup`, `/summary`, `/catchup`), `/feed`, `/friends`, `/invite/[token]`, `/knowledge` (+ `/[domain]`), `/games/[id]` (+ `/summary`), `/new-game`, `/archive`, `/replay`, `/ceremony/[ceremonyId]`, `/share/ceremony/[token]`, `/account` (+ `/profile`, `/preferences`, `/notifications`, `/privacy`), `/users/[id]` (+ `/knowledge`), `/questions`, `/activities`, `/creator-notes/new`, `/dev/*`.

**API areas (`src/app/api`)**: auth (request-otp, verify-otp, refresh-session, me, logout), account, daily (queue/status/answer/skip/reset/feedback/preferences/recheck/summary/catchup), feed (+ dismiss-domain, friend-coverage, backfill), questions (+ critique, suggest, suggest-answer, send), joshing-games, ceremony (+ viewed, share-token), friends (+ friend-requests, friend-invitations), knowledge (+ tidy), declared-interests, creator-notes, reactions, replay, cron (daily-assignments, weekly-ceremony), bank, breadcrumb, activities, archive, onboarding, users (+ domain-exclusions), telemetry, admin/backfill-domains.

## Data Model (main tables in `src/server/db/schema.ts`)
- **users**, **userSessions** — accounts + JWT sessions
- **questions**, **generatedQuestions**, **questionReactions**, **questionRatings**, **questionFeedback**, **questionAudienceTags** — content + signals
- **creatorNotes** — author → answerer notes
- **gradeDisputes** — contested grades
- **playerMastery**, **masteryEvents** — per-domain tier + atomic skill events
- **dailyQueues**, **dailyPreferences**, **skippedDailyQuestions** — today's 5 questions
- **userDomainDifficulties**, **userDomainExclusions**, **userQuestionBank**, **declaredInterests** — personalization
- **friendships**, **friendInvitations** — social graph
- **joshingGames**, **joshingGameRecipients**, **joshingGameQuestions**, **joshingGameResponses** — multiplayer
- **feedItems**, **feedDismissedDomains** — social feed
- **biweeklyCeremonies** — achievement celebrations
- **activityItems** — notifications
- **profileDomainVisibility** — per-domain privacy
- **critiqueUsageDaily**, **smsLogs**, **otpCodes** — rate limiting + auth

## Conventions (from CLAUDE.md)
1. **Drizzle, not Prisma.** Migrations in `drizzle/`; run with `npm run db:migrate` (also auto-applied at boot).
2. **`src/proxy.ts`, NOT `middleware.ts`.** Extend the proxy instead.
3. **DB pool capped at `max: 5`** in `src/server/db/index.ts:23` because Supabase PgBouncer session-mode `pool_size=15` is shared across Next workers. Don't raise without checking PgBouncer.
4. **Zod on every API input.** No exceptions.
5. **DB queries in `src/server/db/queries/`**, never inline in routes.
6. **LLM calls centralized** in `src/server/llm/` + `src/lib/llm.ts`.
7. **Sonnet for generation, Haiku for grading.** Don't swap without measuring quality + cost.
8. **`_salvaged/` is excluded** from TS (`tsconfig.json`) and ESLint. Never edit.

## Commands
- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run lint` — ESLint over `src/`
- `npm run format` — Prettier write
- `npm run db:migrate` — Drizzle migrations
- `npm run smoke:daily-catchup` — daily catchup smoke
- `npx tsc -p tsconfig.typecheck.json` — typecheck (do NOT commit `.tsbuildinfo`)

## Docs / PRDs
- **`_docs/ARCHITECTURAL-DECISIONS.md`** — background (treat as reference, may be stale)
- `_docs/DESIGN-SYSTEM.md`, `_docs/SALVAGE-MANIFEST.md`
- **Current product canon (v12 line):** `DECISIONS.md` + the `PRD-D-*.md` series (`PRD-D-0`–`PRD-D-4`) at repo root.
- Active backlog: `PRD_BACKLOG.md`. Recent audits live in `audits/`.
- Superseded specs/audits (v11.x and earlier): `_docs/archive/` (`PRD11.md`, `PRD-v11.1.md`, `PRD-v11.2.md`, `PRD-AUDIT.md`, `PRD-V11.1-AUDIT{,-2,-4}.md`, `PRD-11.1-MASTER-ALIGNMENT-AUDIT{,-2}.md`, `PHASE-STATUS.md`).
