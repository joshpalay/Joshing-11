---
name: verify
description: Run this app locally in a fresh container (local Postgres, migrations, seeded session) to verify a change end-to-end. Use when there is no remote DB/env available.
---

# Verify Joshing locally (no Supabase)

Recipe proven 2026-07 in a Claude Code remote container (root shell, Postgres 16 binaries present, no pgvector).

## 1. Local Postgres (must run as the `postgres` system user; scratchpad dirs are not writable by it)

```bash
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/pgdata -U postgres --auth=trust -E UTF8"
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/pgdata -o '-p 5433 -k /var/lib/postgresql -c listen_addresses=127.0.0.1' -l /var/lib/postgresql/pg.log start"
/usr/lib/postgresql/16/bin/createdb -h 127.0.0.1 -p 5433 -U postgres joshing
```

## 2. Migrations — do NOT rely on boot `migrate()` on a fresh DB

Drizzle's migrator runs everything in one transaction and dies on `55P04`
("unsafe use of new value of enum type") because early migrations add enum
values and use them. Instead apply each journaled `.sql` via psql (autocommit
per statement), then mark the ledger applied:

```bash
node -e "for (const e of require('./drizzle/meta/_journal.json').entries) console.log(e.tag)" | \
  while read tag; do psql -h 127.0.0.1 -p 5433 -U postgres -d joshing -v ON_ERROR_STOP=1 -q -f "drizzle/$tag.sql" || echo "FAILED: $tag"; done
```

Expected local failures, both safe to skip: `0063_pool_embeddings` (needs the
pgvector extension; recovered/feed pages don't touch `embedding`) and
`0081_enable_rls_public_tables` (references the retired `CreatorNote` table;
RLS is bypassed by the superuser connection anyway).

Then insert one `drizzle.__drizzle_migrations` row per journal entry
(`hash` = sha256 hex of the file, `created_at` = the entry's `when`) so boot
`migrate()` sees everything applied.

## 3. Env + dev server

`.env.local` (gitignored):

```
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/joshing"
DIRECT_URL="postgresql://postgres@127.0.0.1:5433/joshing"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Start with `SKIP_BOOT_DB_GUARDS=1 npm run dev` (guards are noisy on a
half-local DB; migrate() is a no-op after step 2).

**Turbopack CSS gotcha:** Tailwind v4 auto-scans the repo and compiles the
literal "rounded-[var(--radius-" + "*)]" strings (written split here so THIS
file doesn't retrigger it) inside comments in
`scripts/check-radius-ratchet.mjs` / `CLAUDE.md` / `.github/` into invalid
CSS → every page 500s in dev. Local-only workaround (do not commit):

```bash
printf '/scripts/check-radius-ratchet.mjs\n/CLAUDE.md\n/.github/\n' >> .git/info/exclude
rm -rf .next   # then restart dev
```

## 4. Mint an authenticated session (no OTP flow needed)

The JWT dev fallback secret is `development-only-joshing-session-secret`
(src/server/auth/session.ts). Sign `{ sid, inv: true, onb: true }` with
HS256, subject = user id, and insert a matching `"UserSession"` row (the
token column must equal the JWT exactly). Send it as the `joshing_session`
cookie. `inv`/`onb` true skips the invitation and onboarding redirects in
src/proxy.ts.

Minimal seed for most surfaces: a `"User"` row (id + phone_number), the
`"UserSession"` row, `"Question"` rows, and `"MASTERY_EVENTS"` rows
(`source_type` `live_correct`/`catchup_correct`, `answer_state` as needed,
back-dated `created_at` via `now() - interval '...'`).

## 5. Drive it

- SSR pages: `curl -b "joshing_session=$TOKEN" http://localhost:3000/<path>`.
- Screenshots: Playwright is in node_modules but the pinned browser build is
  absent; launch with `executablePath: '/opt/pw-browsers/chromium'`. Run the
  script from inside the repo (module resolution is by script location).
