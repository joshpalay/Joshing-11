# CLAUDE.md

Project-specific guidance for Claude. Keep this file short; reference, don't duplicate.

## ORM & migrations
- **ORM is Drizzle, not Prisma.** Migrations live in `drizzle/`, numbered from `0000_material_lyja.sql` up to the current head (`0061_email_verification_token.sql` at time of writing — run `ls drizzle/*.sql | sort | tail -1` for the live head rather than trusting this number).
- Schema: `src/server/db/schema.ts`. Query helpers: `src/server/db/queries/`.
- Run migrations manually with `npm run db:migrate`. They are also auto-applied at boot from `src/instrumentation.ts`, which additionally pre-applies several idempotent guards for partially-recorded preview/production databases — read that file before adding a new migration that touches enums, NOT NULL columns, or additive columns.
- **Keep `drizzle/meta/_journal.json` in lockstep with `drizzle/*.sql`.** This repo hand-writes migrations (it does not maintain per-migration snapshots), and the runtime migrator only applies migrations listed in the journal — a `.sql` file that isn't journaled is invisible to `migrate()`. After hand-writing a migration, reconcile it with `node scripts/reconcile-drizzle.mjs` (report-only; `--apply` to write the journal entry and mark already-applied rows in `__drizzle_migrations`). New journal `when` values must exceed the previous entry's (the existing entries use synthetic future-dated millis), or the migrator will treat the migration as already-applied and skip it.
- **Boot cost / cold starts:** the ~70 idempotent guards run sequentially on every cold boot and are the dominant cold-start latency (the first request — e.g. `POST /api/auth/request-otp` — waits behind them). Set `SKIP_BOOT_DB_GUARDS=1` to skip the guard chain; `migrate()` still runs, and since every migration is journaled it applies them all on a fresh DB. The guards are purely defensive redundancy — leave the flag unset in preview/dev so they keep auto-repairing partially-recorded databases. **Production posture (B-GRADE-COLDSTART-01):** `SKIP_BOOT_DB_GUARDS=1` is set in the **production** Vercel environment to keep the guard chain off cold starts; preview/dev leave it unset. `register()` logs `[instrumentation boot] { guards_ran, guards_ms, migrate_ms, total_ms }` once per boot so the cost is measurable. Functions are **pinned to `us-west-2`** to colocate with the Supabase project (also `us-west-2`), so Function↔DB requests stay in-region (B-PERF-01, 2026-06-15; previously unpinned/project-default — see `PERF-FINDINGS-01` §1e). Keep this in lockstep with the Supabase region: if Supabase moves, re-pin functions to match.

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
- `npm run check:colors` — color ratchet (off-system hex/rgb/hsl count must stay ≤ the ceiling in `scripts/check-color-ratchet.mjs`; runs in CI)
- `npm run check:spacing` — spacing ratchet (arbitrary `p-[…]`/`m-[…]`/`gap-[…]`/`space-[…]` count must stay ≤ the ceiling in `scripts/check-spacing-ratchet.mjs`; runs in CI. Sizing `h-/w-` is out of scope — see the script header)
- `npm run check:radius` — radius ratchet (literal arbitrary `rounded-[Npx]`/`[Nrem]` count must stay ≤ the ceiling in `scripts/check-radius-ratchet.mjs`; runs in CI. Radius-token consumers — the `var(--radius-*)` arbitrary form — are on-system and not counted. Never spell that form as one contiguous rounded-[…] literal in docs/comments: Tailwind v4 scans the whole repo, and a `*` inside a var() arbitrary compiles into invalid CSS that breaks every page in `next dev`)
- `npm run check:zindex` — z-index ratchet (raw `z-[N]` arbitraries + inline `zIndex ≥ 30` must stay ≤ the ceiling — currently 0 — in `scripts/check-zindex-ratchet.mjs`; runs in CI. Overlay layers go through the `--z-*` scale in `globals.css`: nav 40 < sheet 50 < modal 60 < toast 70 < takeover 80. **Toast sits BELOW takeover**, so a toast rendered while a `fullScreen` `LoadingScreen` is up is painted behind it — and a self-dismissing one burns its timer invisibly and is gone before the loader clears. Gate such toasts on the loading state rather than raising their z-index; this cost two failed fixes in #1607/#1608)
- `npm run check:typesize` — type-size ratchet (arbitrary `text-[Npx]`/`[Nrem]` count must stay ≤ the ceiling in `scripts/check-typesize-ratchet.mjs`; runs in CI. The 13px secondary register is named: use `text-quiet`, never `text-[13px]` — see `_docs/STYLE-GUIDE-TYPE.md` §3. Inline `fontSize:` styles are out of scope — see the script header)
- `npm run format` — Prettier write
- `npm run db:migrate` — Drizzle migrations
- `npm run smoke:daily-catchup` — daily catchup smoke test
- `npx tsc -p tsconfig.typecheck.json` — typecheck convention (this is what produces the `tsconfig.typecheck.tsbuildinfo` churn; do not commit the `.tsbuildinfo` files)

## Conventions
- **Validation:** Zod on every API input. No exceptions.
- **DB access:** queries belong in `src/server/db/queries/`, not inline in route handlers.
- **LLM calls:** centralized under `src/server/llm/` (and `src/lib/llm.ts`).
- **Anthropic model split:** Sonnet (`claude-sonnet-4-6`) for generation; Haiku (`claude-haiku-4-5-20251001`) for grading and categorization. Don't swap these without measuring quality and cost. **Measured exception:** the factual gate (`findFactualFailures`) defaults to Sonnet, overridable via `FACTUAL_GATE_MODEL` — a 2026-06 audit found Haiku-tier misses subtle false-premise questions Sonnet catches, and prompt-tweaks at Haiku didn't help; the gate runs once per generation batch, so the cost delta is small.
- **Reactions are REMOVED product surface (Josh, 2026-07-03).** `QuestionReaction` never landed a row in prod, and the feature — along with the wrong-answer *reaction-rate* "north-star" metric built on it — is retired, not broken. Do NOT fix the reaction write path, build against the table, or gate decisions on the reaction-rate queries in older docs (`docs/thinking/PRE-BUILD-VALIDATION.md` §2, the session-summary/thinking docs, and `_docs/` predate this). Qualitative evidence (e.g. the Robyn hand-authoring test) + product judgment carry those gates instead.
- **`_salvaged/`** is excluded from TypeScript (`tsconfig.json`) and ESLint (`eslint.config.mjs`). **Never edit anything inside it.**
- **`PHONE_HASH_SALT`** is required in production (enforced at boot in `src/instrumentation.ts`). Used by `src/server/lib/phone-hashing.ts` and the client-side hashing path B-Friends-4 will add. Rotating it invalidates every `ContactHash` row and every persisted `User.phone_hash`.

## Further reading
- **Docs index + settled/open decisions:** `DECISIONS.md` (start here).
- **Canonical product direction (the v12 line):** the `PRD-D-*.md` series (`PRD-D-0` through `PRD-D-5`). These supersede the 10.25/v11.x PRDs.
- **Design system:** `_docs/DESIGN-SYSTEM.md` — tokens, fonts (Montserrat → `--font-sans`), the Ink-on-Cream palette.
- **Type style guide:** `_docs/STYLE-GUIDE-TYPE.md` — the four type voices (Editorial/serif, System/mono, Interface/sans, Brand/script) and the token fix-list. Part 1 of 2.
- **Color style guide:** `_docs/STYLE-GUIDE-COLOR.md` — Part 2 of 2: the five color jobs (grading reserved, neutrals, category, gold accent, link/brand) and the color fix-list. Rules locked; some hex values still to set.
- Architecture overview: `_docs/ARCHITECTURAL-DECISIONS.md` (may contain stale claims — treat as background, not gospel).
- Superseded 10.25/v11.x PRDs and audits are archived under `_docs/archive/`.
