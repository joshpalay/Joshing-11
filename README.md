# Joshing v11

A daily knowledge game. Five questions a day drawn from your declared interests,
shared with friends.

## Docs

- [Product spec](./_docs/PRD11.md)
- [Architectural decisions](./_docs/ARCHITECTURAL-DECISIONS.md)
- [Database schema](./_docs/0001_initial_schema.sql)
- [Phase status](./_docs/PHASE-STATUS.md)

## Stack

Next.js 16 · TypeScript · Tailwind CSS 4 · Prisma 5 · Supabase (Postgres) · Anthropic API

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
npx prisma migrate dev
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
npx prisma studio  # browse the database
```
