# Joshing v11

A daily knowledge game. Five questions a day drawn from your declared interests,
shared with friends.

## Docs

- [Docs index & decisions](./DECISIONS.md) — start here
- [Product direction (v12 line)](./PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md) — the `PRD-D-*` series is current canon
- [Architectural decisions](./_docs/ARCHITECTURAL-DECISIONS.md)
- [Database schema](./src/server/db/schema.ts) — Drizzle schema (migrations under [`drizzle/`](./drizzle))
- Superseded v11.x PRDs and audits: [`_docs/archive/`](./_docs/archive)

## Stack

Next.js 16 · TypeScript · Tailwind CSS 4 · Drizzle ORM · Supabase (Postgres) · Anthropic API

## Local setup

**1. Clone and install**

```bash
git clone <repo-url>
cd joshing-11
npm install
```

**2. Set environment variables**

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase pooled connection (port 6543) |
| `DIRECT_URL` | Supabase direct connection (port 5432) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `JWT_SECRET` | 32+ random bytes, base64-encoded (preferred) |
| `AUTH_SECRET` | Alias for `JWT_SECRET` in hosted environments |
| `NEXT_PUBLIC_APP_URL` | Base URL (e.g. `http://localhost:3000`) |

**3. Run database migrations** *(once schema is ready — Phase 1.2)*

```bash
npm run db:migrate
```

**4. Start the dev server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful commands

```bash
npm run build      # production build
npm run lint       # ESLint
npm run format     # Prettier
npx drizzle-kit studio  # browse the database (Drizzle migrations are authoritative)
```
