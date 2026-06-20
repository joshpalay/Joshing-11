# PERF-FINDINGS-01 — Load-Time Diagnosis

**Prompt:** D-PERF-LOAD-DIAGNOSE-01 (read-only diagnosis → ranked causes → sequenced `B-PERF-*` fix slate).
**Date:** 2026-06-15.
**Method:** Vercel deployment/runtime-log pull (MCP) · Supabase performance advisors · `pg_stat_statements` (6.5 weeks, reset 2026-04-29) · `pg_stat_user_tables` · code correlation of the §12.6 surfaces.
**Targets (PRD §12.6, now in `_docs/archive/PRD11.md`; the active product line is `PRD-D-*`):**

| Surface | Target |
|---|---|
| Home screen load | < 1.5s |
| Daily Five reveal | < 800ms |
| Answer grading (deterministic) | < 200ms |
| Answer grading (LLM) | < 2s |
| Feed load | < 1s |
| Knowledge page load | < 1.5s |
| Daily question page (4G) | < 2s |

---

## 0. Headline — the requested baseline cannot be measured (and why that is itself the finding)

**There is no production traffic to measure.** Evidence:

- The Vercel project (`prj_dUeTvrYMpC18eJyal5JMfVz37l0N`) reports **`live: false`**.
- Every one of the last 20 deployments has **`target: null`** (preview). None is a production promotion.
- **`get_runtime_logs` for `environment: production` over 7 days returns "No logs found."** There are no serverless/edge function invocations to derive p50/p95/p99 from.

So the Phase-1 deliverable as literally specified — a per-route p50/p95 table from Vercel function-duration logs — **does not exist yet and would have to be invented.** Per the prompt's "do not guess" rule, this doc does **not** fabricate one. The honest baseline table is:

| Route | p50 | p95 | Target | Gap | Dominant cost |
|---|---|---|---|---|---|
| *(all routes)* | — | — | per §12.6 | **unmeasured** | **no production traffic / no RUM instrumented** |

**This is the most important result of the investigation:** the project is about to launch against numeric latency targets it has never measured. The first `B-PERF-*` item is therefore not a code fix — it is *standing up measurement* so §12.6 stops being aspirational. Everything below is the real, non-log evidence that *is* available, and it is enough to pre-empt the likely offenders before launch.

---

## 1. Real evidence that *does* exist

### 1a. Database query telemetry (`pg_stat_statements`, since 2026-04-29)

The database is the only layer emitting real timing data. After filtering out Postgres-catalog/introspection noise, **every application query (Drizzle-generated, quoted identifiers) is fast:**

| App query (truncated) | calls | mean | notes |
|---|---|---|---|
| `select … from "DailyQueue" where user_id=$1 and queue_date<=$2 …` | 1,334 | **11.2 ms** | home + daily hot path |
| `FeedItem ⋈ User … max(sourceEventAt) … group by` | 13 / 9 | 24 / 19 ms | feed presence aggregation |
| `Question … embedding <=> $1 … order by` (pgvector dedup) | 1,634 | **5.0 ms** | generation-time dedup, not a page path |

No application query exceeds ~25 ms mean. There is **no app-level N+1 and no slow app query** visible in 6.5 weeks of data.

**Caveat that matters:** these numbers are at toy scale. `pg_stat_user_tables` shows the live row counts are tiny — `User` 35, `Friendship` 10, `FeedItem` 2,284, `Question` 462, `DailyQueue` 166. At this size a sequential scan is microseconds, so the timings above tell you nothing about behaviour at 10k+ users. They confirm *the code isn't doing anything pathological*, not *the queries will hold up under load*.

### 1b. The slowest lines in the DB are **not the app**

The top consumers of total DB time are platform/PostgREST catalog introspection, driven by the Supabase dashboard and schema-cache reloads — not request paths:

| Query | calls | mean | % of all DB time |
|---|---|---|---|
| `SELECT name FROM pg_timezone_names` | 47,357 | 95.7 ms | **69.5%** |
| `WITH RECURSIVE … base_types …` (introspection) | 47,357 | 21.5 ms | 15.6% |
| `pks_uniques_cols` / `pks_fks` / role-settings introspection | 47,357 | 2–3 ms | ~7% |

These would *not* appear on a user request and are not actionable in app code. Flagging them so a future reader does not "optimize" `pg_timezone_names` — it is platform overhead.

### 1c. Cold-start guard chain — the one real, structural latency risk

`src/instrumentation.ts` is **1,477 lines** of ~70 idempotent DDL guards (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `ALTER TYPE … ADD VALUE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, …) run **sequentially on every cold boot**. `pg_stat_statements` proves they run constantly — sampled execution counts of single guard statements:

- `ALTER TYPE "MasterySourceType" ADD VALUE IF NOT EXISTS 'curator_credit'` — **4,427 calls**
- `ALTER TABLE "Question" ALTER COLUMN "category" SET DEFAULT …` — **4,260 calls**
- `ALTER TABLE "DailyPreference" ADD COLUMN IF NOT EXISTS …` — **1,743 calls**
- the FeedItem `CHECK` / `ADD COLUMN` guards — 475 / 1,037 calls, the CHECK one at **72 ms each**

Thousands of executions = thousands of cold boots, each paying ~70 sequential DB round-trips before the first request (e.g. `POST /api/auth/request-otp`) is served. This is exactly the cost documented as **B-GRADE-COLDSTART-01** in `CLAUDE.md`.

Mitigation already exists: `SKIP_BOOT_DB_GUARDS=1` skips the chain (`migrate()` still runs; all migrations are journaled). Per `CLAUDE.md` this **is** set in production and intentionally left unset in preview/dev. The boot logs `[instrumentation boot] { guards_ran, guards_ms, migrate_ms, total_ms }` once per boot — so the cost is *measurable the moment a production cold start happens*, but (see §0) no production boot has been logged yet to confirm the flag's effect.

### 1d. Schema forward-risk — unindexed foreign keys (Supabase performance advisor)

Zero latency impact today (tables are tiny), real impact at scale, cheap to fix. FKs without a covering index, by table:

- **`FeedItem`** — `questionId`, `sourceUserId`, `joshingGameId` (three; directly on the Feed-load path)
- `ActivityItem.actorUserId` (From-Friends stream)
- `Friendship.requestedByUserId`, `Friendship.removedByUserId`
- `JoshingGameQuestion.questionId`, `JoshingGameResponse.questionId`
- `SkippedDailyQuestion.question_id`, `SkippedDailyQuestion.generated_question_id`
- `FriendInvitation.inviteeUserId`, `DAILY_REFINE_DECISION.queue_id`

Advisor link: <https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys>

The advisor also lists ~12 **unused** indexes (`Question_embedding_hnsw_idx`, `ContactHash_phoneHash_idx`, `idx_users_phone_hash`, several `Friendship`/`SkippedDailyQuestion` partials, …). "Unused" here means "no traffic yet," not "useless" — several back features that haven't launched (B-Friends contact-hash, pgvector dedup at volume). Do **not** drop these pre-launch; revisit post-traffic.

### 1e. Region colocation — the prompt's #1 suspect — **RESOLVED (regions colocated, 2026-06-15)**

Cross-region Function↔DB round-trips are the most common Vercel latency cause. At diagnosis time this could **not** be confirmed from the available tools:

- Supabase project: `grixooyecvnugpxvcbct.supabase.co` (region not exposed via the URL or MCP).
- Vercel `get_project` returned no region pin; functions relied on the **Vercel project default region** (not pinned), which did not necessarily match Supabase.

A cross-region default would land a 30–80 ms RTT on *every* query — and the home/daily paths issue several per render.

**Resolution (B-PERF-01, 2026-06-15):** Supabase confirmed in **`us-west-2`**. The Vercel functions region — previously unpinned (relying on the project default, which was not colocated with `us-west-2`) — was **explicitly pinned to `us-west-2`** so Function↔DB requests stay in-region. Functions and DB are now colocated and the cross-region RTT this section warned about is eliminated. Because this changes a platform default `CLAUDE.md` documented as intentionally unpinned, the corresponding `CLAUDE.md` line was updated in the same change so doc and reality agree.

---

## 2. Code correlation (Phase 2) — the usual offenders are already handled

Read the §12.6 surfaces. Credit where due: the structural anti-patterns the prompt screens for are **not present**.

- **`src/proxy.ts`** does **no per-request DB work.** It reads `inv`/`onb` straight from the JWT (`readSessionClaims`, signature-verify only). The steady-state authed navigation costs one JWT verify (sub-millisecond), tagged via `Server-Timing: proxy;dur=…`. ✅
- **`getSession()`** (`src/server/auth/session.ts`) is wrapped in React `cache()` — collapses layout+page+nested-RSC resolutions to **one** `validateSessionToken` DB read per request (single indexed lookup on `userSessions.token`). ✅
- **Home (`src/app/page.tsx`)** already streams: three `<Suspense>` boundaries with skeletons, and `TodaysFiveSection` runs its 3 queries in **`Promise.all`** (queue + preferences + catchup). First paint does not block on the slowest query. ✅
- **Home feed (`buildHomeEdition`)** runs its 5 upstream fetches in **`Promise.all`**; `getFeedPagePayload` runs pinned/non-pinned/count in `Promise.all` and resolves viewer answer-state via a **single batched** `getViewerAnswerStatusForQuestions(userId, ids[])` — not per-row. Recent commits (`perf(feed): collapse three surface-count queries into one`, `drop redundant getDismissedDomains query`) confirm this path has had deliberate perf passes. ✅
- **Daily page (`src/app/daily/page.tsx`)** is a client component that fetches `/api/daily/queue` after mount. The "Daily Five reveal" long pole is **synchronous LLM generation** on first-ever queue build (Sonnet, seconds), not a query — it is retried with backoff and shown behind a deliberate loading state. This is inherent product cost, not a regression; the <800ms reveal target applies to an already-built queue, which the DB data shows resolves in ~11 ms. ⚠️ (waterfall note below)

**One latent waterfall (low priority):** the daily page renders shell → hydrates → *then* `fetch`es the queue (`setTimeout(0)` in `useEffect`). For an existing queue this adds a client round-trip the home page avoids by reading server-side. Acceptable today; candidate for an RSC/prefetch pass if the daily-page-load target is missed once measured.

---

## 3. Ranked root causes (highest impact first)

1. **No measurement exists.** §12.6 is unenforced; the team is flying blind into launch. (Evidence: §0.)
2. **Region colocation unverified.** Highest *potential* per-request latency, cheapest fix if mismatched, currently unknown. (§1e.)
3. **Cold-start guard chain** — ~70 sequential DDL round-trips per cold boot. Real and proven (§1c); already mitigated in prod by `SKIP_BOOT_DB_GUARDS=1`, but the mitigation is unconfirmed against a real prod cold start.
4. **Unindexed FKs on read hot paths** (FeedItem ×3, ActivityItem) — zero impact now, latency landmines at scale, trivially cheap. (§1d.)
5. **Daily-page client-fetch waterfall** — minor, only matters if the daily-page target is missed post-measurement. (§2.)

Not a cause: app SQL (all <25 ms, no N+1), proxy cost, session lookups, home/feed assembly — all already sound.

---

## 4. Fix slate — sequenced, quick-wins first

Each item is independently shippable and leaves the codebase working.

### Quick wins (config / verification, hours)

- **B-PERF-01 — Verify & lock Function↔DB region colocation.** *(config)* Read the Vercel project default region and the Supabase project region; if they differ, pin functions to the Supabase region. If they already match, the deliverable is a one-line note in this doc recording it. Verify with: Vercel project settings → Functions region, and Supabase dashboard → Project Settings → region (or inspect the `DATABASE_URL` pooler host, e.g. `aws-0-<region>.pooler.supabase.com`). **Do this first** — it gates the meaning of every future latency number.
- **B-PERF-02 — Confirm the cold-start mitigation in production.** *(config)* Verify `SKIP_BOOT_DB_GUARDS=1` is present in the **production** Vercel environment, then read one real `[instrumentation boot] { guards_ran, guards_ms, migrate_ms, total_ms }` line from a production cold start to confirm `guards_ran: 0` and a low `total_ms`. Pure verification; no code.
- **B-PERF-03 — Add covering indexes for hot-path FKs.** *(code — Drizzle migration)* New migration adding indexes for `FeedItem.questionId`, `FeedItem.sourceUserId`, `FeedItem.joshingGameId`, and `ActivityItem.actorUserId`. Follow the repo migration convention (`/new-migration` skill; keep `drizzle/meta/_journal.json` in lockstep; add the matching idempotent guard in `instrumentation.ts` per `CLAUDE.md`). Leave the remaining (cold-path) FKs and all "unused" indexes alone for now.

### Structural (code / platform, days)

- **B-PERF-04 — Stand up real load-time measurement (prerequisite for *enforcing* §12.6).** *(config + light code)* Enable Vercel Speed Insights / Web Analytics for field Core Web Vitals, and add structured per-route server timing logs (the `Server-Timing` proxy header already exists — extend to key routes / wire RUM). Without this, §0 stays true and every later perf claim is a guess. This is the real "Phase 1" the prompt wanted; it just has to be built before it can be run.
  - **Status (2026-06-20): DONE (code side).** Both halves are now in place — see §6 for the query recipe.
    - *Field RUM:* `<SpeedInsights/>` + `<Analytics/>` render in `src/app/layout.tsx` (Core Web Vitals + page views, beacon-only).
    - *Server timing logs:* every §12.6 surface now emits one grep-able `[perf] { route, …_ms, … }` line to the Vercel function logs (the `Server-Timing` *header* only reaches the browser Network panel and never appears in logs, so it could not back a p50/p95 table on its own). Helpers live in `src/server/lib/server-timing.ts` (`logServerTiming`, `timeServerWork`). Covered routes/surfaces: `feed`, `daily/queue` (GET **and** the previously-untimed synchronous-build POST long pole), `knowledge`, `daily/answer`, and the home RSC (`home/todays-five`, `home/from-friends`).
    - *Still config-only (not code):* confirm a real production `[perf]` line once a deploy is promoted (§0 — no production traffic has been logged yet), and optionally wire a Vercel log drain to compute the percentiles automatically.
- **B-PERF-05 — (post-launch) Trim the boot-guard chain itself.** *(code, structural)* Even with `SKIP_BOOT_DB_GUARDS=1`, preview/dev cold starts pay the full ~70-round-trip chain. Gate the guard block behind a cheap schema-version / fingerprint check so it short-circuits when the DB is already current, instead of re-issuing every `IF NOT EXISTS` each boot. Defer until after launch; touches the most safety-critical file in the repo (read the `instrumentation.ts` header + `CLAUDE.md` migration rules first).
- **B-PERF-06 — (conditional) Resolve the daily-page fetch waterfall.** *(code)* Only if the daily-page-load target is missed once B-PERF-04 is live: move the existing-queue read server-side (RSC) or prefetch it, so the page doesn't shell→hydrate→fetch. Skip if measurement shows it already clears 2s/4G.

### Housekeeping (post-traffic only)

- **B-PERF-07 — Re-run the advisor after ~2 weeks of real traffic** and drop indexes still flagged unused *and* not backing an unlaunched feature, to cut write amplification. Not before launch — "unused" currently means "no traffic," not "dead."

---

## 5. Quick-wins vs structural split

| | Items | Nature |
|---|---|---|
| **Quick wins** | B-PERF-01, 02, 03 | config + one small migration; ship this week |
| **Structural** | B-PERF-04 (do early — unblocks enforcement), 05, 06 | platform wiring + careful code |
| **Housekeeping** | B-PERF-07 | post-traffic only |

**Sequence:** 01 → 02 → 03 (cheap, immediate), then **04 early** (so 05/06 can be judged on data instead of guessed), then 05/06/07 as measurement dictates.

## 6. Building the §12.6 p50/p95 table from `[perf]` logs (B-PERF-04)

The §0 baseline table can be filled in once a production deploy is promoted and traffic flows. Each instrumented surface emits a single structured line per request:

```
[perf] { route: "feed", feed_ms: 12, filter: "all", items: 20 }
[perf] { route: "daily/queue", queue_ms: 11 }
[perf] { route: "daily/queue:POST", build_ms: 8421, total_ms: 8460, outcome: "built" }
[perf] { route: "knowledge", knowledge_ms: 19 }
[perf] { route: "daily/answer", grade_ms: 38, total_ms: 71, cold: false }
[perf] { route: "home/todays-five", todays_five_ms: 14 }
[perf] { route: "home/from-friends", home_edition_ms: 22 }
```

**Span key:** the per-route span is `<name>_ms`; `total_ms` (where present) is end-to-end. The `_ms` suffix matches the older `[daily/answer timings]` line, which is kept for its richer cold/load/persist/mastery breakdown — `[perf]` is the uniform tag for cross-route aggregation.

**Route → §12.6 surface mapping:**

| §12.6 surface | `[perf]` route(s) | Span to percentile-ise |
|---|---|---|
| Home screen load | `home/todays-five`, `home/from-friends` | `todays_five_ms`, `home_edition_ms` (server data fetch only; combine with Speed Insights LCP for true load) |
| Daily Five reveal | `daily/queue` (warm read), `daily/queue:POST` (`outcome:"built"` = cold synchronous-LLM build) | `queue_ms`; `total_ms` for the build long pole |
| Answer grading | `daily/answer` | `grade_ms` (split cold vs warm via the `cold` field) |
| Feed load | `feed` | `feed_ms` |
| Knowledge page load | `knowledge` | `knowledge_ms` |

**To compute percentiles:** pull the function logs for the window (Vercel dashboard → Logs, or a configured log drain), filter to lines containing `[perf]`, group by `route`, and take p50/p95/p99 of the relevant `_ms` field. Field Core Web Vitals (LCP/INP/CLS/TTFB) come from the Speed Insights dashboard, route-attributed. Together these replace the "unmeasured" row in §0.

---

## DO-NOT reminders honored
- No code changed (diagnosis only).
- No causes asserted ahead of data — where data was absent (production logs, region) this doc says **unmeasured/unverified** rather than guessing.
- Caching is deliberately **not** proposed as a first move: region colocation, the cold-start chain, and N+1 were ruled in/out first, and the verdict is that caching would mask the unmeasured baseline rather than fix anything.
