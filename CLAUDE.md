# CLAUDE.md

Project-specific guidance for Claude. Keep this file short; reference, don't duplicate.

## ORM & migrations
- **ORM is Drizzle, not Prisma.** Migrations live in `drizzle/`, numbered from `0000_material_lyja.sql` up to the current head (`0061_email_verification_token.sql` at time of writing — run `ls drizzle/*.sql | sort | tail -1` for the live head rather than trusting this number).
- Schema: `src/server/db/schema.ts`. Query helpers: `src/server/db/queries/`.
- Run migrations manually with `npm run db:migrate`. They are also auto-applied at boot from `src/instrumentation.ts`, which additionally pre-applies several idempotent guards for partially-recorded preview/production databases — read that file before adding a new migration that touches enums, NOT NULL columns, or additive columns.
- **Keep `drizzle/meta/_journal.json` in lockstep with `drizzle/*.sql`.** This repo hand-writes migrations (it does not maintain per-migration snapshots), and the runtime migrator only applies migrations listed in the journal — a `.sql` file that isn't journaled is invisible to `migrate()`. After hand-writing a migration, reconcile it with `node scripts/reconcile-drizzle.mjs` (report-only; `--apply` to write the journal entry and mark already-applied rows in `__drizzle_migrations`). New journal `when` values must exceed the previous entry's (the existing entries use synthetic future-dated millis), or the migrator will treat the migration as already-applied and skip it.
- **Boot cost / cold starts:** the ~70 idempotent guards run sequentially on every cold boot and are the dominant cold-start latency (the first request — e.g. `POST /api/auth/request-otp` — waits behind them). Set `SKIP_BOOT_DB_GUARDS=1` to skip the guard chain; `migrate()` still runs, and since every migration is journaled it applies them all on a fresh DB. The guards are purely defensive redundancy — leave the flag unset in preview/dev so they keep auto-repairing partially-recorded databases.

## Database pool — do not raise blindly
- Postgres pool is capped at `max: 5` in `src/server/db/index.ts:23` because Supabase PgBouncer session-mode `pool_size` is 15 and multiple Next worker processes share it. Don't raise this without checking the PgBouncer config first.
- The rationale is documented inline in `src/server/db/index.ts` (the comment above `max: 5`); the cap currently traces to PR #306 (`6065c3e`).

## Routing / middleware — read this before touching
- **This repo uses `src/proxy.ts`, NOT `src/middleware.ts`.** Adding a `middleware.ts` file breaks Next 16's proxy.
- This regression has recurred several times; the canonical consolidation is commit `635abc6` ("merge middleware.ts into proxy.ts for Next.js 16"). Run `git log --grep=middleware -i` for the full history. If you think you need a `middleware.ts`, you don't — extend `src/proxy.ts` instead.

## Commands
- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run lint` — ESLint over `src/`
- `npm run check:fonts` — font ratchet (off-system font-family count must stay ≤ the ceiling in `scripts/check-font-ratchet.mjs`; runs in CI)
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
- **Docs index + settled/open decisions:** `DECISIONS.md` (start here).
- **Canonical product direction (the v12 line):** the `PRD-D-*.md` series (`PRD-D-0` through `PRD-D-5`). These supersede the 10.25/v11.x PRDs.
- **Design system:** `_docs/DESIGN-SYSTEM.md` — tokens, fonts (Montserrat → `--font-sans`), the Ink-on-Cream palette.
- **Type style guide:** `_docs/STYLE-GUIDE-TYPE.md` — the four type voices (Editorial/serif, System/mono, Interface/sans, Brand/script) and the token fix-list. Part 1 of 2; color is deferred to Part 2.
- Architecture overview: `_docs/ARCHITECTURAL-DECISIONS.md` (may contain stale claims — treat as background, not gospel).
- Superseded 10.25/v11.x PRDs and audits are archived under `_docs/archive/`.
