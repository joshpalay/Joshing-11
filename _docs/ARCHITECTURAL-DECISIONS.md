# Joshing v11.0 — Architectural Decisions

This document records foundational technical choices for v11.0.
Every Claude Code session should reference this to stay consistent.

## Stack

- **Framework:** Next.js 16.1.6, App Router, TypeScript (strict mode)
- **Runtime:** Node 20+
- **Database:** Postgres 15+, hosted on Supabase
  - Used as Postgres-only — NOT using Supabase Auth, Storage, Realtime, or RLS
  - Connection: pooled (port 6543) for app, direct (port 5432) for migrations
- **ORM:** Prisma 5.x
- **Migrations:** Prisma Migrate
- **Styling:** Tailwind CSS 4 with @tailwindcss/postcss
- **Components:** shadcn/ui (CLI-installed; source in src/components/ui/)
- **Auth (dev):** Hardcoded sign-in (no SMS, no OTP) — see SMS section below
- **Auth (prod):** Custom SMS OTP (deferred to Phase 5–6)
- **SMS:** Stubbed in Phase 1 — real Twilio integration deferred
- **LLM:** Anthropic API (@anthropic-ai/sdk)
  - Sonnet for: Daily Five generation, domain merge/split
  - Haiku for: grading, categorization, answer suggestion
- **Async jobs:** Vercel Cron (config in vercel.json)
- **Hosting:** Vercel
- **Payments (Plus, deferred):** Stripe

## SMS / Auth Strategy

**Phase 1–4 (development):**
- A `/dev/sign-in` page accepts any phone number and signs you in instantly
- No OTP code generated, no SMS sent, no verification
- If user doesn't exist, they're created
- Route is gated: returns 404 in production
- A stub `sendSms()` function logs to console instead of calling Twilio
- The AuthOtp and SmsLog tables exist in the schema but are unused

**Phase 5–6 (pre-launch):**
- Replace `/dev/sign-in` with the real two-step phone+code flow
- Replace stub `sendSms()` with Twilio implementation
- Wire up rate limiting and OTP hashing
- Remove `/dev/sign-in` from any non-dev environment

This means **all callers of sendSms() and all consumers of session state are 
written normally from Phase 1 onward** — only the implementations change later.

## State Management

- **Server state:** TanStack Query (React Query)
- **Client state:** React Context for cross-cutting; useState for local
- No Redux, Zustand, or MobX

## API Pattern

- Next.js App Router route handlers (`app/api/*/route.ts`)
- All routes return typed JSON
- Validation via Zod on every input
- DB queries live in `src/server/db/`, never in route handlers
- LLM calls live in `src/server/llm/`, never inline

## Conventions

- File naming: kebab-case for files, PascalCase for components
- Imports: absolute via `@/` alias
- All async ops log to `llm_call_log` or `sms_log` for cost/debug tracking

## Environment Variables

Required for local + production:
- `DATABASE_URL` — Supabase pooled connection (Prisma runtime)
- `DIRECT_URL` — Supabase direct connection (Prisma Migrate)
- `ANTHROPIC_API_KEY`
- `JWT_SECRET` — 32+ random bytes, base64
- `NEXT_PUBLIC_APP_URL` — base URL for invitation links

Required only when SMS is enabled (Phase 5+):
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

## Things We Will Not Do

- No native iOS / Android (web-only at launch)
- No groups, games, seasons, public pool, star voting, leaderboards, streaks
- No third-party analytics that surface engagement metrics to users
- No push notifications
- No real-time / WebSocket features
- No file uploads at launch
