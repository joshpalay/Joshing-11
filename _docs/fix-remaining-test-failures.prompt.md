# Prompt: fix the 6 remaining test failures on `dev2`

You are working in the Joshing-11 repo (Next.js 16, Drizzle ORM, Vitest 4).
Six tests across **two files** still fail. Both are **incomplete test mocks**,
not product bugs — do not change product code to make them pass. Fix only the
test files. Verify with a cleared-cache full run **before** claiming anything.

## Ground rules
- Run tests with: `npx vitest run` (full) or `npx vitest run <path>` (single).
  Clear the vitest cache between meaningful runs: `rm -rf node_modules/.vite`.
- Do NOT edit product code under `src/app`, `src/server`, `src/lib` to fix a
  test — the routes/queries are correct; the mocks drifted.
- Typecheck convention: `npx tsc -p tsconfig.typecheck.json` (must stay 0 errors;
  it excludes `**/__tests__/**`, so test edits won't show there — still run the
  test suite).
- A global setup file already exists: `vitest.setup.ts` sets a placeholder
  `DATABASE_URL` so modules importing `@/server/db` don't throw at import.
- State / counts must be honest. The suite is currently **531 passed / 6 failed
  (537 total)**. Target: **537 passed**.

---

## Failure 1 — `src/server/ceremony/__tests__/beat4-visibility.test.ts` (5 tests)

**Error:** `TypeError: db.select(...).from(...).where is not a function`, thrown
from `computeBeat1` (`src/server/ceremony/compute-beats.ts:176`), reached via
`computeBeats()` → `runBeat4()` in the test.

**Root cause:** The test calls the full `computeBeats('viewer-1', start, end)`,
which runs **all five beats**. The test's `dbMock` was written only for
`computeBeat4`'s query shapes:
- `db.selectDistinct().from().where()` (active-friends narrowing), and
- `db.select().from().innerJoin().leftJoin().where()` (the alignment join).

But `computeBeat1` (and beats 2/3/5) use **other** chains, e.g.
`db.select().from().where().orderBy()`, `.innerJoin().where()`, plain
`.select().from().where(inArray(...))`, etc. The mock returns objects missing
those methods, so the first un-mocked chain throws.

**Two acceptable fixes — pick the simpler that works:**

**Option A (preferred): a universal chainable db mock.** Replace the hand-rolled
`dbMock` with a recursive/chainable stub where every builder method
(`select`, `selectDistinct`, `from`, `where`, `innerJoin`, `leftJoin`,
`orderBy`, `limit`, `groupBy`, …) returns the same chainable proxy, and the
chain is also awaitable. Make the *terminal* resolve to the right rows per
query. The trick: beats 1/2/3/5 should resolve to `[]` (so they produce no
output and don't interfere), while the **alignment** query (the
`innerJoin(users).leftJoin(profileDomainVisibility)` one) resolves to
`masteryRowsState.rows`, and the active-friends `selectDistinct` resolves to
`[{ userId: 'friend-a' }, { userId: 'friend-b' }]`.

A clean way: make a chainable that, when awaited (`then`), resolves to a value
chosen by inspecting which tables/joins were used. Simpler: keep a small queue
or a per-call discriminator. Since only beat4 needs real data and the others
need `[]`, you can discriminate on whether `.leftJoin` was called (alignment) or
`.selectDistinct` was used (active friends); everything else → `[]`.

Keep everything the `vi.mock` factory references inside `vi.hoisted(()=>{...})`
(already done) to avoid "Cannot access 'dbMock' before initialization".

**Option B: scope the test to `computeBeat4` only.** If `computeBeat4` is
exported (or can be exported) from `compute-beats.ts`, call it directly instead
of `computeBeats()`, so beats 1/2/3/5 never run. This is less faithful to the
integration but far smaller. Only do this if Option A proves fiddly; note the
narrowing in a comment. (Do NOT export-only-for-tests if it pollutes the public
surface awkwardly — prefer Option A.)

**Expected behavior the 5 tests assert** (all via `runBeat4(rows)` →
`payload.beat4`):
1. friend domain with `visibility: null` or `'public'` → included.
2. `visibility: 'friends'` → included.
3. friend's `visibility: 'private'` → excluded (result `null` when it's the only
   overlap).
4. mixed: public domain included, private one from same friend excluded.
5. viewer's OWN private domain still counts for matching (only friend rows are
   filtered).

`getFriendsMock` is set in `beforeEach` to
`[{ id: 'friend-a' }, { id: 'friend-b' }]`. The alignment rows are fed via
`masteryRowsState.rows`. Read `computeBeat4` in
`src/server/ceremony/compute-beats.ts` (around lines 345–404) for the exact
select/innerJoin/leftJoin/where shape and the in-memory filter logic.

---

## Failure 2 — `src/server/creator-notes/__tests__/feed-submitted-answer.test.ts` (1 test)

**Test:** `saves the submitted answer when a new Feed wrong answer is recorded`.
**Error:** `TypeError: rows.map is not a function`, thrown from
`readPriorAnswersForQuestion` (`src/server/answer-history.ts:36`) — its query is
`db.select(...).from(masteryEvents).where(...).orderBy(asc(...), asc(...))`, and
`.orderBy()` returns something non-array.

**Root cause:** The POST route (`src/app/api/feed/[feedItemId]/answer/route.ts`)
runs several `db.select(...)` calls in sequence. The test drives them with an
ordered queue: `dbMock.select.mockReturnValueOnce(selectChain([...]))` twice
(feed row, then playerMastery). But the route now also calls
`readPriorAnswersForQuestion` (another `select`) **before** the two the test
queued, OR the order changed — so one real select falls through to a default
that doesn't return an array from `.orderBy()`.

Look at `selectChain()` in the test (around line 108): its terminal `where`
returns `{ orderBy: () => ({ limit }), limit }`, where `orderBy` returns an
object with `limit` — but `readPriorAnswersForQuestion` does
`.where(...).orderBy(a, b)` and then `await`s the result directly (no `.limit`).
So `orderBy` must itself be awaitable/return an array, AND the mock's
`select` call-ordering must account for the `readPriorAnswers` select.

**Fix steps:**
1. Read `src/app/api/feed/[feedItemId]/answer/route.ts` top-to-bottom and list,
   in order, every `db.select(...)` / `db.update(...)` / `db.transaction(...)`
   call the **wrong-answer** path executes (note: wrong answers skip the
   `awardsMasteryCredit` branch). Include the one inside
   `readPriorAnswersForQuestion` and `selectInsideJokeForViewer` if reached.
2. Make `selectChain`'s `orderBy` both awaitable and chainable to `.limit`
   (return a thenable carrying `limit`, like the pattern already used in
   `src/server/db/queries/__tests__/friends.test.ts`'s `makeWhereBuilder`).
3. Align the `mockReturnValueOnce(...)` queue with the actual call order, adding
   a `selectChain([...])` entry (usually `[]`) for the prior-answers read and any
   other select the route now makes before the asserted feed update.
4. The test asserts (via `feedUpdateSetCalls`) that the feed `.set()` includes
   `{ state: 'answered', submittedAnswer: 'Morris Day', answerResult:
   'incorrect', pointsAwarded: 0 }`. Keep that assertion; just make the mocks
   reach it.

The other two tests in this file already pass — don't regress them.

---

## Definition of done
- `rm -rf node_modules/.vite node_modules/.vitest && npx vitest run` →
  **0 failed**, 537 passed (or whatever the new total is after your edits;
  state the exact number).
- `npx tsc -p tsconfig.typecheck.json` → 0 errors.
- Only test files changed. Confirm with `git diff --name-only`.
- Commit with an **accurate** message stating the verified pass/fail counts.
  Do not write "all green" unless a cleared-cache full run actually shows 0
  failures.
