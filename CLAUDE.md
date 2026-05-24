# CLAUDE.md

Project-specific guidance for Claude. Keep this file short; reference, don't duplicate.

## ORM & migrations
- **ORM is Drizzle, not Prisma.** Migrations live in `drizzle/` (currently `0000_material_lyja.sql` through `0034_territory_type_enum.sql`).
- Schema: `src/server/db/schema.ts`. Query helpers: `src/server/db/queries/`.
- Run migrations manually with `npm run db:migrate`. They are also auto-applied at boot from `src/instrumentation.ts`, which additionally pre-applies several idempotent guards for partially-recorded preview/production databases — read that file before adding a new migration that touches enums, NOT NULL columns, or additive columns.

## Database pool — do not raise blindly
- Postgres pool is capped at `max: 5` in `src/server/db/index.ts:23` because Supabase PgBouncer session-mode `pool_size` is 15 and multiple Next worker processes share it. Don't raise this without checking the PgBouncer config first.
- See commit `2aafbb1` ("prevent PgBouncer EMAXCONNSESSION by capping pool connections") for context.

## Routing / middleware — read this before touching
- **This repo uses `src/proxy.ts`, NOT `src/middleware.ts`.** Adding a `middleware.ts` file breaks Next 16's proxy.
- This regression has been fixed at least five times: commits `c02a980`, `95157a1`, `8c8a6f7`, `b5d8e7d`, `635abc6`. If you think you need a `middleware.ts`, you don't — extend `src/proxy.ts` instead.

## Commands
- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run lint` — ESLint over `src/`
- `npm run format` — Prettier write
- `npm run db:migrate` — Drizzle migrations
- `npm run smoke:daily-catchup` — daily catchup smoke test
- `npx tsc -p tsconfig.typecheck.json` — typecheck convention (this is what produces the `tsconfig.typecheck.tsbuildinfo` churn; do not commit the `.tsbuildinfo` files)

## Conventions
- **Validation:** Zod on every API input. No exceptions.
- **DB access:** queries belong in `src/server/db/queries/`, not inline in route handlers.
- **LLM calls:** centralized under `src/server/llm/` (and `src/lib/llm.ts`).
- **Anthropic model split:** Sonnet (`claude-sonnet-4-6`) for generation; Haiku (`claude-haiku-4-5-20251001`) for grading and categorization. Don't swap these without measuring quality and cost.
- **`_salvaged/`** is excluded from TypeScript (`tsconfig.json`) and ESLint (`eslint.config.mjs`). **Never edit anything inside it.**
- **`PHONE_HASH_SALT`** is required in production (enforced at boot in `src/instrumentation.ts`). Used by `src/server/lib/phone-hashing.ts` and the client-side hashing path B-Friends-4 will add. Rotating it invalidates every `ContactHash` row and every persisted `User.phone_hash`.

## Further reading
- Architecture overview: `_docs/ARCHITECTURAL-DECISIONS.md` (may contain stale claims — treat as background, not gospel).
- PRDs and audits: top-level `PRD-*.md` files.
