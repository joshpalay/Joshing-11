# Code Review Findings — 2026-06-26, commit `fc8a4c27bc2872625935eda01bbdf9fb334c6346`

> Read-only full-repo audit (B-CODE-REVIEW-AUDIT-01). Generated against a fresh
> checkout of branch `claude/code-review-audit-01-xd2b1s`. **Zero code files were
> changed** — this report is the only artifact. Every finding cites a real
> `path:line-range` read during the audit.

## Summary

- **24 findings: 0 critical, 6 high, 9 medium, 9 low.**
- **Overall health read:** The safety-critical spine is in good shape. `migrate()`
  is unconditional (`instrumentation.ts:1693`, outside the `runBootGuards` gate);
  `src/middleware.ts` does not exist and `src/proxy.ts` carries auth correctly; the
  92 migration `.sql` files map 1:1 to 92 `_journal.json` entries with no gaps or
  orphans; all raw SQL is parameterized; no service-role key or non-`NEXT_PUBLIC`
  secret reaches a client bundle; and the suspected **`visibility='blocked'`
  fan-out leak does not exist** — it is enforced on both the write/fan-out path and
  every read path through shared predicates. There are **no critical findings.**
  The real debt is concentrated in two clusters: (1) **scoring** — an advertised
  canonical scorer (`canonicalPointsForAnswer`) is dead while five answer routes
  hand-roll points, and recovery points are computed by two different formulas that
  agree today only by a rounding coincidence; and (2) **teardown debt** — the gated
  Joshing-Games creation path and two of its query exports are orphaned. One live
  canon violation (competition-register copy on From Friends) is already logged as
  an open defect in `DECISIONS.md`. The `--game-wrong-strong` / `--cat-literature`
  collision is **resolved**; retired fonts are **absent** from UI roles.

---

## Findings

### [HIGH] Competition-register copy on the live From Friends activity surface
- **File:** `src/lib/activity-stream.ts:883-901`
- **What:** The friend-activity card lead strings use competition/achievement
  register — "has been killing it in", "on a streak of wisdom", "on a tear through",
  "is on a roll" — to describe a friend's play. These render live on From Friends
  via `friendActivityToStreamItem`.
- **Why it matters:** Canon forbids leaderboard/competition framing; friend
  activity must read as warm ambient curiosity, not a scoreboard about how a friend
  is "performing." The comment directly above the array even claims the voice has
  "no 'mastered'/'beat'/'crushed'", yet the array itself violates the spirit.
- **Evidence:**
  ```ts
  // activity-stream.ts:883-895
  const FRIEND_ACTIVITY_LEADS = [
    ' has been killing it in ',
    ' has been on a streak of wisdom in ',
    ' is amazing answering questions about ',
    ' has been all over ',
    " can't get enough of ",
    ' has been on a tear through ',
  ] as const;
  const FRIEND_ACTIVITY_LEADS_NO_TOPIC = [
    ' has been killing it',
    ' has been on a streak of wisdom',
    ' is on a roll',
  ] as const;
  ```
- **Suggested fix:** Replace with discovery/curiosity-register leads that name
  territory without performance framing (e.g. "has been wandering", "keeps finding
  corners in"). Copy-owner sign-off applies. Do NOT implement.
- **Canon ref:** PRODUCT-CANON.md §4 "From Friends" ("not a leaderboard"), §5
  principle 4 ("warmth, not obligation"), §6 (not "a leaderboard-first competition
  app"); already logged as an open defect in `DECISIONS.md` line 64 (which cites a
  now-shifted line range `858-871`; the live code is `883-901`).

### [HIGH] `asQueueSlots` returns the data it just proved invalid (defeats its own guard)
- **File:** `src/server/daily/catchup.ts:21-29`
- **What:** On Zod `safeParse` failure the function logs a warning and then returns
  `value as QueueSlot[]` — the raw, unvalidated JSONB it just rejected. The
  validation is a no-op in exactly the case it exists to catch.
- **Why it matters:** This is the canonical `asQueueSlots`, imported across the
  query layer (`src/server/db/queries/daily.ts`, 10+ call sites) and the live
  answer route (`src/app/api/daily/answer/route.ts:211`). Malformed slot JSONB
  flows into `slots.find(...)`, `slot.answered`, scoring, etc. as if valid. A
  sibling implementation in `queue-orchestrator.ts:56-58` does the safe thing
  (`Array.isArray ? cast : []`), so the two diverge.
- **Evidence:**
  ```ts
  export function asQueueSlots(value: unknown): QueueSlot[] {
    if (!Array.isArray(value)) return [];
    const result = z.array(queueSlotSchema).safeParse(value);
    if (!result.success) {
      console.warn('[daily] QueueSlot JSONB failed schema validation', result.error.issues);
      return value as QueueSlot[];   // ← returns the rejected data
    }
    return result.data;
  }
  ```
- **Suggested fix:** On failure return `[]` (matching the `!Array.isArray` branch
  and the orchestrator), or filter to the slots that individually parse. Consider
  consolidating the two implementations. Do NOT implement.

### [HIGH] N+1 fan-out in the Daily +2 friend-domain pool (`getFriendDomainsForBonus`)
- **File:** `src/server/db/queries/friend-presence-domains.ts:228-261`
- **What:** For each followee, the function awaits `getSectionVisibilities(friend.id)`
  (1 query) and `getKnowledgePageData(friend.id)` — which fans out to ~5 more
  queries via `loadKnowledgeInputs`. That is ~6 round-trips × number-followed, on
  the Daily-Five build path.
- **Why it matters:** A viewer following 30 people drives ~180 DB queries per daily
  build against the `max: 5` pool (CLAUDE.md). `Promise.all` parallelizes across
  followees but immediately saturates the 5-connection pool and serializes the rest.
- **Evidence:**
  ```ts
  const perFriend = await Promise.all(
    following.map(async (friend) => {
      const effectiveViewer = mutualIds.has(friend.id) ? 'friend' : 'stranger';
      const sectionSettings = await getSectionVisibilities(friend.id);      // 1 query / friend
      if (!canViewSection(sectionSettings, 'knowledge_base', effectiveViewer)) return [];
      const { allDomains } = await getKnowledgePageData(friend.id) // ~5 queries / friend
  ```
- **Suggested fix:** Batch across the followee set: one `inArray` query for section
  visibilities, plus bulk `loadKnowledgeInputs`-equivalent variants that accept a
  `userId[]` and group results. Do NOT implement.

### [HIGH] Advertised canonical scorer `canonicalPointsForAnswer` is dead; five routes hand-roll points
- **File:** `src/lib/game-constants.ts:43-55`; callers `src/app/api/daily/answer/route.ts:450-455`,
  `src/app/api/daily/catchup/answer/route.ts:262-270` & `476-481`,
  `src/app/api/feed/[feedItemId]/answer/route.ts:143-146`,
  `src/app/api/lately/milestone/answer/route.ts:101-104`,
  `src/app/api/questions/[id]/answer/route.ts:103-105`
- **What:** `canonicalPointsForAnswer({difficulty, answerState, catchUp})` exists and
  is even advertised in a `@deprecated` note ("Use `canonicalPointsForAnswer`
  instead"), but every answer route builds points inline via a `pointsFor` callback
  rather than calling it.
- **Why it matters:** The one helper meant to centralize "(difficulty, state,
  catchUp) → points" is dead code, while the live computation is copy-pasted across
  five routes. Any change to the point table or catch-up weighting must touch 5+
  places, and the helper drifts from reality silently.
- **Evidence:**
  ```ts
  export function canonicalPointsForAnswer({ difficulty, answerState, catchUp = false }: CanonicalScoringInput): number {
    if (answerState !== 'first_correct' && answerState !== 'first_correct_after_wrong') return 0;
    const basePoints = getBasePoints(difficulty ?? null, answerState);
    const weight = catchUp ? 0.25 : 1;
    return Math.round(basePoints * weight);
  }
  ```
- **Suggested fix:** Route every surface's `pointsFor` through
  `canonicalPointsForAnswer`, or delete the helper if it is abandoned. Do NOT implement.

### [HIGH] Recovery points computed two different ways across surfaces (latent divergence)
- **File:** daily `src/app/api/daily/answer/route.ts:450-455`; catchup
  `src/app/api/daily/catchup/answer/route.ts:269` & `480`; feed
  `src/app/api/feed/[feedItemId]/answer/route.ts:143-146`; lately
  `src/app/api/lately/milestone/answer/route.ts:101-104`; questions
  `src/app/api/questions/[id]/answer/route.ts:103-105`
- **What:** For a recovered answer (`first_correct_after_wrong`), **daily and
  catch-up** compute `Math.round(first_correct_base × RECOVERY_STATE_WEIGHT)` (0.25×
  the *first_correct* base), while **feed, lately, and questions** read
  `getBasePoints(difficulty, 'first_correct_after_wrong')` — a separate hard-coded
  column. Two formulas, two inputs.
- **Why it matters:** They agree today only because the constants table's
  `first_correct_after_wrong` values equal `round(first_correct × 0.25)` per tier.
  Editing `RECOVERY_STATE_WEIGHT` (`constants.ts:32`) or any
  `first_correct_after_wrong` value (`constants.ts:48-50`) silently desyncs daily vs
  feed for the same recovered question. This is the "recovery scoring inconsistent
  across ~4 surfaces" class the brief flagged — confirmed, undocumented, untested.
- **Evidence:**
  ```ts
  // daily/answer/route.ts:450-455 — multiplies the first_correct base by the weight
  pointsFor: (answerState) =>
    answerState === 'first_correct' ? basePoints
      : answerState === 'first_correct_after_wrong' ? Math.round(basePoints * RECOVERY_STATE_WEIGHT)
      : 0,
  // feed/[feedItemId]/answer/route.ts:143-146 — reads the SEPARATE table column
  pointsFor: (state) =>
    isCorrect ? getBasePoints(question.calibratedDifficulty ?? question.llmDifficulty ?? null, state) : 0,
  ```
- **Suggested fix:** Pick one mechanism (route all through `canonicalPointsForAnswer`,
  or make daily/catchup also call `getBasePoints(diff,'first_correct_after_wrong')`),
  and add a unit test pinning `round(first_correct × RECOVERY_STATE_WEIGHT) ===
  first_correct_after_wrong` per tier. Do NOT implement.

### [HIGH] Scorer recovery/catch-up branches have zero unit coverage; route tests mock the scorer
- **File:** helper `src/lib/game-constants.ts:43-55`; constants
  `src/server/mastery/constants.ts:32,48-50`; existing tests
  `src/server/mastery/__tests__/scoring.test.ts`;
  `src/app/api/feed/[feedItemId]/answer/__tests__/route.test.ts:32`
- **What:** `canonicalPointsForAnswer` has no test (`grep` → no matches). The scoring
  test file covers only `getBasePoints`. Nothing asserts the catch-up 0.25× path,
  the repeat/incorrect→0 path, or the cross-surface recovery invariant. The route
  integration tests **mock** the scorer (`if (state === 'first_correct_after_wrong')
  return 25`), so the real recovery math is never exercised.
- **Why it matters:** The silent-divergence risk in the two HIGH scoring findings is
  completely unguarded.
- **Evidence:**
  ```ts
  // feed/[feedItemId]/answer/__tests__/route.test.ts:32 — mocks the scorer
  if (state === 'first_correct_after_wrong') return 25
  ```
- **Suggested fix:** Add a `game-constants` unit test table over (difficulty × state
  × catchUp), plus an explicit `RECOVERY_STATE_WEIGHT` invariant assertion. Do NOT implement.

### [MEDIUM] Three journal entries share an identical `when`, breaking the strictly-increasing invariant
- **File:** `drizzle/meta/_journal.json:71-87` (idx 9, 10, 11)
- **What:** `0009_domain_merge_events`, `0010_feed_submitted_answer`, and
  `0011_preview_schema_hotfix` all carry `"when": 1777771056661` — which is also
  *less than* idx 8's `1777784400000`. So idx 9 regresses and 10/11 duplicate it.
- **Why it matters:** CLAUDE.md states the migrator treats a `when` not exceeding the
  previous entry's as already-applied and skips it. On a green-field DB this trio is
  at risk of being skipped. Impact today is latent (already applied in prod) — hence
  MEDIUM — but any future monotonicity check (`reconcile-drizzle.mjs`) trips here.
- **Evidence:**
  ```json
  { "idx": 8,  "when": 1777784400000, "tag": "0008_add_to_bank_provenance" },
  { "idx": 9,  "when": 1777771056661, "tag": "0009_domain_merge_events" },
  { "idx": 10, "when": 1777771056661, "tag": "0010_feed_submitted_answer" },
  { "idx": 11, "when": 1777771056661, "tag": "0011_preview_schema_hotfix" },
  { "idx": 12, "when": 1777839477000, "tag": "0012_feed_friend_answered" },
  ```
- **Suggested fix:** Do NOT rewrite history on DBs where these are recorded. Document
  the grandfathered anomaly and have `reconcile-drizzle.mjs` assert strict
  monotonicity only for idx ≥ 12. Do NOT implement.

### [MEDIUM] Joshing Game creation path is orphaned dead code behind a hard 403
- **File:** `src/app/api/joshing-games/route.ts:13,65-66`; `createJoshingGame` at
  `src/server/db/queries/joshing-game.ts:247-310`; `src/app/new-game/page.tsx`
- **What:** `createJoshingGame` is imported only by `POST /api/joshing-games`, which
  short-circuits to a 403 via `const GAME_CREATION_DISABLED_IN_V11_1 = true`. No
  client fetches that endpoint; `new-game/page.tsx` is a static stub. (The game
  *play* path — `getJoshingGame`, `submitJoshingGameResponse`,
  `checkJoshingGameCompletion`, `computeOverlapCells` — is gated-but-LIVE, reached
  via activity-stream links to `/games/[id]`.)
- **Why it matters:** A 63-line transaction touching 4 tables is unreachable yet
  fully maintained — it shows up in refactors and schema blast-radius while
  exercising nothing, and a future edit can break it with no runtime/test signal.
  Aligns with PRODUCT-CANON §4 (creation "deliberately gated/disabled").
- **Evidence:**
  ```ts
  // api/joshing-games/route.ts
  const GAME_CREATION_DISABLED_IN_V11_1: boolean = true;
  if (GAME_CREATION_DISABLED_IN_V11_1) {
    return NextResponse.json({ error: '...disabled in v11.1.' }, { status: 403 });
  }
  ```
- **Suggested fix:** Keep as intentionally-gated-but-wired per canon, but tag the dead
  branch (`createJoshingGame`, disabled POST body, `new-game` stub) with one tracking
  marker so it is removed/restored as a unit. Do NOT implement.

### [MEDIUM] `getAllUsers` is a fully unreferenced exported query (PII fetch)
- **File:** `src/server/db/queries/joshing-game.ts:632-648`
- **What:** Exported async query with a `TODO Phase 8` comment; grep across `src/`
  and `scripts/` finds zero importers. Selects an unbounded `users` list including
  `users.phoneNumber`.
- **Why it matters:** Dead export that, if ever wired, runs an unbounded PII scan; it
  reads as supporting the (dead) creation/recipient-picker flow.
- **Evidence:**
  ```
  $ grep -rn getAllUsers src scripts
  src/server/db/queries/joshing-game.ts:632:export async function getAllUsers(): ...
  # (no other matches)
  ```
- **Suggested fix:** Delete it (pairs with the dead creation flow), or fold into the
  creation-path teardown unit. Do NOT implement.

### [MEDIUM] `getGameOverlapAggregates` is a fully unreferenced exported function
- **File:** `src/server/db/queries/joshing-game.ts:123-151`
- **What:** Exported 29-line function with no importers outside its own file. The
  live summary page instead calls the lower-level `computeOverlapCells` directly
  (`src/app/games/[id]/summary/page.tsx:223`) and re-derives single-recipient logic
  inline.
- **Why it matters:** Dead code that duplicates live logic — a divergence hazard if
  overlap rules change. (`computeOverlapCells` itself is LIVE — keep it.)
- **Evidence:**
  ```
  $ grep -rn getGameOverlapAggregates src   # only the definition
  src/app/games/[id]/summary/page.tsx:223:  ? computeOverlapCells(view, view.game.creatorId, singleRecipient.userId)
  ```
- **Suggested fix:** Delete `getGameOverlapAggregates`, or repoint the summary page at
  it to dedupe. Do NOT implement.

### [MEDIUM] Profile stubs declare a non-null return type but return `null`
- **File:** `src/server/profile/portrait.ts:37-47`; `src/server/profile/knowledge.ts:5-9`
- **What:** `getPortraitData` / `getMasteryData` / `getKnowledgeOverview` are typed
  `Promise<PortraitResponse>` / `Promise<MasteryRow[]>` / `Promise<KnowledgeOverview>`
  but `return null as unknown as X`. The cast lies to every caller.
- **Why it matters:** A caller writing `(await getPortraitData(id)).categories`
  compiles cleanly then throws `Cannot read properties of null`. No production callers
  exist today (latent), but the lie surfaces exactly when "Phase 8 friend profiles"
  is wired.
- **Evidence:**
  ```ts
  export async function getPortraitData(userId: string): Promise<PortraitResponse> {
    void userId;
    return null as unknown as PortraitResponse; // TODO Phase 8
  }
  ```
- **Suggested fix:** Type these `Promise<X | null>` (as sibling `getDomainDetail`
  already does), or `throw new Error('not implemented')`. Do NOT implement.

### [MEDIUM] `daily-summary` counts are bonus-inflated while every UI surface recomputes core-only
- **File:** `src/server/db/queries/daily-summary.ts:315-317,323`; consumer
  `src/app/daily/summary/page.tsx:164-166`
- **What:** The summary query computes `totalAnswered/totalCorrect/totalSkipped` over
  ALL slots without filtering `isBonus`, so with a +2 bonus they can read up to 7.
  The summary page and `TodaysFiveCard` deliberately ignore these fields and
  recompute "X of 5" from `coreQuestions = questions.filter(q => !q.isBonus)`.
- **Why it matters:** This is the bonus-denominator inconsistency the brief flagged,
  inverted: the payload fields are bonus-inflated. The UI dodges it by not consuming
  them, but `computeReminderPromptState(userId, dateString, totalAnswered)`
  (`daily-summary.ts:323`) DOES consume the inflated count, and any new consumer of
  `summary.totalCorrect` would render "7 of 5".
- **Evidence:**
  ```ts
  // daily-summary.ts:315-317 — no !isBonus filter
  const totalSkipped = slots.filter((slot) => slot.skipped).length;
  const totalAnswered = slots.filter((slot) => slot.answered).length;
  const totalCorrect = slots.filter((slot) => slot.answer_state === 'correct').length;
  // app/daily/summary/page.tsx:164-166 — consumer recomputes core-only
  const coreQuestions = summary.questions.filter((q) => !q.isBonus)
  ```
- **Suggested fix:** Make the source counts core-only, or rename them
  `*IncludingBonus` and pass the core count to `computeReminderPromptState`. Do NOT implement.

### [MEDIUM] Reaction vocabulary duplicated: `GameplayChat.reactionEmoji()` re-hardcodes all 10 shortcodes
- **File:** `src/components/play/GameplayChat.tsx:728-753` (used `:902`); source of truth
  `src/lib/reactions.ts:1-24`
- **What:** `reactions.ts` stores each reaction's emoji as a Slack shortcode
  (`:exploding_head:`, …). `GameplayChat` defines a private `reactionEmoji()` switch
  re-enumerating those 10 shortcodes to map them to Unicode, with `default: return
  value`.
- **Why it matters:** A second hidden copy of the closed reaction vocabulary. Add or
  rename a reaction in `reactions.ts` and this switch silently misses it, rendering a
  raw `:shortcode:`. No test couples the two.
- **Evidence:**
  ```ts
  function reactionEmoji(value: string): string {
    switch (value) {
      case ':exploding_head:': return '🤯';
      case ':ok_hand:':        return '👌';
      case ':smirk:':          return '😏';
      default: return value;
    }
  }
  ```
- **Suggested fix:** Add a `unicode` field (or `shortcodeToEmoji` map) to
  `src/lib/reactions.ts` and import it; test that every `CANNED_REACTIONS[].emoji` has
  a mapping. Do NOT implement.

### [MEDIUM] Hooks with real logic and no unit test (`useMilestoneAnswer`, `useLoadingMoment`, `usePrefersReducedMotion`)
- **File:** `src/components/activity/use-milestone-answer.tsx` (166 lines);
  `src/components/loading-moment/useLoadingMoment.ts`;
  `src/components/feed/usePrefersReducedMotion.ts`
- **What:** Three of the five `use*` hooks in `src/` have no matching test file.
  `useMilestoneAnswer` owns a real state machine — fetch to
  `/api/lately/milestone/answer`, deferred `onResolved` (fires only after the
  feedback sheet closes), and recheck wiring.
- **Why it matters:** The "report result only after the pop-up closes" contract is a
  deliberate, easy-to-break ordering verified only transitively by route tests that
  don't render the hook.
- **Evidence:** `find src -path "*__tests__*" -name "*use-milestone-answer*"` → no output
  (same for the other two).
- **Suggested fix:** Add a `renderHook` test asserting `onResolved` fires only after
  `phase` returns to closed, plus the wrong-answer recheck path. Do NOT implement.

### [MEDIUM] `useCatchupFlow` has only a narrow `.message` test, not its flow/selector logic
- **File:** hook `src/components/play/useCatchupFlow.ts`; only test
  `src/components/play/__tests__/useCatchupFlow.message.test.tsx`
- **What:** The single test targets message rendering, not round advancement, slot
  selection, or completion — the logic the hook owns.
- **Why it matters:** Catch-up is a recovery surface whose scoring/eligibility was
  flagged as inconsistency-prone; the hook driving its progression has only cosmetic
  coverage.
- **Suggested fix:** Add a flow test covering round advance, batch-of-5 boundary, and
  completion. Do NOT implement.

### [LOW] RLS enabled with zero policies — correct today, latent footgun
- **File:** `drizzle/0081_enable_rls_public_tables.sql:16-18`
- **What:** Every public table has `ENABLE ROW LEVEL SECURITY` with no policies. This
  is deliberate: the app connects as `postgres` (owner, bypasses RLS), so RLS is a
  deny-all backstop over the unused Supabase Data API.
- **Why it matters:** Sound *only* while the owner connection is the sole client. If
  anyone later wires `supabase-js`/PostgREST with `anon`/`authenticated`, every table
  silently returns nothing until per-table policies are hand-written — and a rushed
  broad policy would expose `phone_number`, `OtpCode`, `SmsLog`, sessions. RLS is not
  `FORCE`d, so policies are never exercised/regression-tested.
- **Evidence:**
  ```sql
  -- No policies are added by design: the only intended database client is the
  -- owner connection, which bypasses RLS.
  ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;   -- (+36 more tables)
  ```
- **Suggested fix:** Document in `DECISIONS.md` that app-layer `getSession()` +
  per-query `userId` scoping is the sole row-level enforcement and RLS is a Data-API
  backstop only. Do NOT implement.

### [LOW] `/api/share/ceremony/[token]` is a permanent capability URL (no expiry/revocation)
- **File:** `src/app/api/share/ceremony/[token]/route.ts:14-39`; `src/lib/share-card.ts:8-10`
- **What:** The public ceremony share endpoint authenticates solely by possession of a
  192-bit random token that never expires and cannot be revoked. The response returns
  the owner's display name plus per-friend display names and contribution counts.
- **Why it matters:** Anyone who obtains the URL (forward, referrer leak, history) can
  read the recap — including friends' names — indefinitely. Payload is already
  minimized (`safeBeatsPayload`), so impact is low, but it is an accepted tradeoff
  worth recording.
- **Evidence:**
  ```ts
  function createToken(): string {
    return randomBytes(24).toString('base64url');   // 192 bits, permanent
  }
  ```
- **Suggested fix:** If ceremonies should be ephemeral, add a token-expiry column and a
  revoke action; otherwise document the capability-URL design. Do NOT implement.

### [LOW] Raw hex gradient palette on the live Ceremony surface
- **File:** `src/app/ceremony/[ceremonyId]/page.tsx:150-157`
- **What:** An 8-entry array of 32 raw hex literals drives the ceremony circle
  gradients on a live, non-ratchet-exempt surface.
- **Why it matters:** STYLE-GUIDE-COLOR §3 mandates a single `--cat-*` scale; this is a
  parallel hand-rolled palette that can drift from the category scale.
- **Evidence:**
  ```js
  const CEREMONY_CIRCLE_COLORS: CeremonyCircleColor[] = [
    { core: '#ffe6a3', mid: '#f6b94a', rim: '#c96f1e', glow: '#f6b94a' },
    { core: '#c6f4ff', mid: '#56c7e8', rim: '#137ca7', glow: '#56c7e8' },
    ...
  ];
  ```
- **Suggested fix:** Route through the `--cat-*` token scale or document an exemption.
  Do NOT implement.
- **Canon ref:** STYLE-GUIDE-COLOR.md §3 / §7 step 3. Known tracked debt — counted
  under the color-ratchet ceiling (180; `scripts/check-color-ratchet.mjs:28-29` names
  the ceremony gradient palette). Flag, do not treat as net-new.

### [LOW] `EditorialPromos` hardcodes `#fff` for contrast text
- **File:** `src/components/feed/EditorialPromos.tsx:214`
- **What:** A live promo card computes text color as a raw `'#fff'` when the background
  is dark.
- **Why it matters:** Token-discipline drift; the reversed-on-dark foreground already
  has a token used elsewhere.
- **Evidence:**
  ```jsx
  style={{ background: bg, color: isDarkColor(bg) ? '#fff' : 'var(--ink)' }}
  ```
- **Suggested fix:** Replace `'#fff'` with the existing reversed-paper token. Do NOT implement.
- **Canon ref:** STYLE-GUIDE-COLOR.md §2 ("one value per token"). Counted under the ratchet.

### [LOW] `/archive` route ships but is unlinked from nav (deferred-by-design)
- **File:** `src/app/archive/page.tsx:117` + backing `src/app/api/archive/route.ts`
- **What:** `ArchivePage` is a real route with a live `/api/archive` backend, but no
  nav entry links to it (`Nav.tsx` has zero `/archive` references).
- **Why it matters:** Matches PRODUCT-CANON §4 ("exist in code but deliberately
  unlinked") — not a defect, but reachable-by-URL dead surface that can rot silently
  with no nav/test exercising it.
- **Evidence:** `grep /archive src/components/Nav.tsx` → no matches; `archive/page.tsx:114`
  fetches `/api/archive`.
- **Suggested fix:** None required (deferred-by-design). Optionally add a smoke test and
  note it in `DECISIONS.md`. Do NOT implement.

### [LOW] PRODUCT-CANON §4 claims a `/replay` route that does not exist (stale doc)
- **File:** `PRODUCT-CANON.md` §4 (line ~211); code: `src/app/replay` absent
- **What:** Canon lists `/replay` alongside `/archive` as "exist in code but
  deliberately unlinked." `src/app/replay` does not exist; the only `replay` hits in
  code are unrelated onboarding-harness comments in `src/proxy.ts`.
- **Why it matters:** Doc drift (per the brief, report the doc as stale rather than
  trust it). Could send a future teardown chasing a route that isn't there.
- **Evidence:** `ls src/app/replay` → No such file or directory.
- **Suggested fix:** Correct PRODUCT-CANON §4 to drop `/replay`. No code action.

### [LOW] `useCatchupFlow` (client) imports from `@/server/...` (path-convention smell)
- **File:** `src/components/play/useCatchupFlow.ts:1,11,20`
- **What:** A `'use client'` module imports `parseCatchupItemId` from
  `@/server/daily/catchup`. That file is currently pure (only `zod` + type-only
  imports), so it bundles into the client safely today.
- **Why it matters:** Fragile: if anyone adds a DB/`server-only` import to `catchup.ts`
  (plausible — the query layer also imports it), this client bundle breaks at build
  time with a confusing transitive error. CLAUDE.md keeps DB/LLM under `src/server`
  precisely to avoid client bundling.
- **Evidence:**
  ```ts
  'use client';
  import { parseCatchupItemId } from '@/server/daily/catchup';
  ```
- **Suggested fix:** Move the pure ID-codec helpers into `src/lib/` shared by both
  sides. Do NOT implement.

### [LOW] `questions.source` filtered + grouped with no supporting index
- **File:** query `src/server/db/queries/friends.ts:273-292`; schema
  `src/server/db/schema.ts:391-414`
- **What:** `getFriendQuestionCounts` filters on `creatorId IN (...) AND source =
  'authored' AND deleted_at IS NULL` and `GROUP BY creator_id`. Indexes cover
  `creator_id` and `creator_id+deleted_at`, but nothing covers `source`.
- **Why it matters:** Minor — `creatorId` already narrows hard, so `source` is filtered
  in the heap. Not an emergency.
- **Evidence:**
  ```ts
  .where(and(
    inArray(questions.creatorId, friendIds),
    eq(questions.source, 'authored'),
    sql`${questions.deletedAt} is null`,
  )).groupBy(questions.creatorId)
  ```
- **Suggested fix:** Consider a partial index `Question(creator_id) WHERE
  source='authored' AND deleted_at IS NULL`, or accept current behavior. Do NOT implement.

### [LOW] `POINTS_PER_CORRECT = 3` legacy constant still exported
- **File:** `src/lib/game-constants.ts:10-11`
- **What:** Flat legacy scoring constant marked `@deprecated`, still exported alongside
  the real scorer.
- **Why it matters:** An import of `POINTS_PER_CORRECT` would silently award a wrong
  flat score; deprecated-but-exported invites accidental reuse.
- **Evidence:**
  ```ts
  /** @deprecated Legacy flat scoring constant. Use `canonicalPointsForAnswer` instead. */
  export const POINTS_PER_CORRECT = 3;
  ```
- **Suggested fix:** Confirm no importers, then remove. Do NOT implement.

---

## Clean lanes

The following scope items were investigated and found clean (verified in code, not
assumed):

- **Safety-critical invariants.** `migrate()` is unconditional —
  `src/instrumentation.ts:1693-1696`, called outside the `runBootGuards` gate (gate
  at `:70-76`, closed at `:1689`); the try/catch logs-and-continues by design. The
  ~70 idempotent boot guards are present and gated behind `SKIP_BOOT_DB_GUARDS`.
- **Routing / middleware.** `src/middleware.ts` does **not** exist; `src/proxy.ts`
  carries the JWT auth gate and onboarding routing, exports `middleware as proxy`,
  and its matcher excludes only intentionally-public families.
- **Migration ↔ journal lockstep.** 92 `.sql` files map 1:1 to 92 `_journal.json`
  `tag` entries — no orphan `.sql`, no orphan journal entry, no numbering gap
  (`0000`…`0091`), every `idx` equals its tag number. (The only defect is the `when`
  ordering anomaly at idx 9-11, reported above as MEDIUM.)
- **`visibility='blocked'` fan-out leak — CLEARED.** Enforced on the write/fan-out
  path (`create-feed-items-for-answer.ts:86` → `isCorrectAnswerFeedEligible`, which
  rejects any non-`public` visibility, `visibility.ts:116-125`) and on every read
  path (`feedItemVisibilityPredicate` `feed.ts:301-309`; `notBlockedForViewer` in
  `lately.ts:389-392` and `activity.ts`). `src/lib/friend-activity.ts` carries no
  blocked filter but is an explicitly-unwired pure transform operating on
  already-filtered ids — not a leak.
- **Secrets in client bundles.** No `SUPABASE_SERVICE_ROLE_KEY`/`service_role` in
  `src/`; no non-`NEXT_PUBLIC` `process.env` in any `"use client"` surface;
  `ANTHROPIC_API_KEY` read only in the server module `src/lib/llm.ts`.
- **Raw SQL injection.** No `sql.raw(<userInput>)` anywhere — the only `sql.raw` is a
  constant separator (`account.ts:485 sql.raw(', ')`); every dynamic value is a
  Drizzle `${}` bound parameter; the ~70 `db.execute` in `instrumentation.ts` are
  static boot DDL with no user input.
- **Excluded-route self-auth.** All `api/cron/*` routes call `isCronAuthorized`
  (fails closed when `CRON_SECRET` unset, `src/server/auth/cron.ts:19-37`);
  `api/share` uses unguessable tokens; `api/telemetry` is public-by-design with
  strict allowlists; `api/auth/*` is public by necessity, with `me`/`logout`
  calling `getSession()`.
- **Schema vs query drift.** No real drift. The raw references to `creator_id`,
  `answerer_id`, `creator_responded_at` in `account.ts`/`reactions.ts`/`activity.ts`
  are deliberate pre-rename legacy fallbacks, each guarded by a `42703` error-code
  or `information_schema` probe.
- **Retired fonts.** No Playfair Display / Courier New in any UI role — every hit in
  `src/` is a retirement comment; the one Courier literal
  (`SharePortraitCard.tsx`) is the documented, ratchet-exempt html2canvas raster path.
- **Triangle motif as functional element.** `TriangleBackground.tsx` is the allowed
  decorative brand background (`aria-hidden`); `QuestionNumberMarker.tsx` explicitly
  enforces that the motif is not reintroduced as a functional/status element.
- **Color-as-sole-signal.** The graded verdict (`AnswerFeedbackSheet.tsx:218-236`)
  pairs color with both an icon (`Check`/`X`) and a text label; the bonus signal in
  `GeometricProgress.tsx` is carried by a text label. (Watch item, not a finding: the
  `GeometricProgress` done-dot uses green/red color alone to distinguish
  correct/wrong, but it is an `aria-hidden` decorative track and the authoritative
  verdict is text+icon-backed elsewhere.)
- **Honest provenance (no peer fallback for house content).** `AuthorName.tsx:19-21`
  renders house/LLM names as plain text; `EditorialBadge` is the non-peer marker;
  house content routes through `EditorialFeature`/`EditorialPromos`, never the
  person-card path. `DECISIONS.md` line 60 documents Invariant H-1 as closed and
  regression-tested.
- **`--game-wrong-strong` / `--cat-literature` collision — RESOLVED.** Distinct in
  `src/app/globals.css`: `--game-wrong-strong: #c1121f` (line 131, grading red) vs
  `--cat-literature: #7d2c3f` (line 141, bordeaux). The old colliding
  `[data-palette="proposed"]` block is deleted. (Note: `DECISIONS.md` line 67 still
  describes the collision as live with stale values `#c33d14`/`#c0392b` — that entry
  is stale and contradicted by line 76 and by the live code.)
- **Tests asserting nothing / skipped / flaky.** No `expect(true)`, no un-gated
  `it.skip`/`xit`/`test.todo`; the four `describe.skipIf(!evalsEnabled)` blocks are
  intentional live-eval gates; every test file has at least one `expect(`; test
  `Date.now()` usages compute relative offsets, not wall-clock assertions. (The real
  test gap is missing *unit* coverage of the scorer + hooks, reported above.)

---

## Recommended D-/B- follow-ups

Grouped, ranked by severity. Names only — not written here.

1. **B-SCORING-CONSOLIDATE-01** (HIGH) — Route all five answer surfaces through
   `canonicalPointsForAnswer`; collapse the two recovery-points formulas into one;
   add the `RECOVERY_STATE_WEIGHT` ↔ `first_correct_after_wrong` invariant test;
   remove `POINTS_PER_CORRECT`. Covers the three HIGH scoring findings + L9.
2. **B-DAILY-QUEUE-VALIDATION-01** (HIGH) — Fix `asQueueSlots` to stop returning
   rejected JSONB; unify with the `queue-orchestrator` implementation.
3. **B-BONUS-FRIEND-DOMAIN-N1-01** (HIGH) — Batch `getFriendDomainsForBonus` to kill
   the per-followee ~6-query fan-out on the Daily-Five build path.
4. **B-JOSHING-GAME-TEARDOWN-01** (MEDIUM) — Tag/remove the orphaned creation path
   (`createJoshingGame`, disabled POST, `new-game` stub) and the two dead exports
   (`getAllUsers`, `getGameOverlapAggregates`) as one unit.
5. **B-DAILY-SUMMARY-DENOMINATOR-01** (MEDIUM) — Make `daily-summary` counts core-only
   (or rename + fix `computeReminderPromptState`); pin the bonus-denominator invariant.
6. **B-REACTION-VOCAB-SSOT-01** (MEDIUM) — Move the shortcode→Unicode map into
   `src/lib/reactions.ts`; couple `GameplayChat` to it with a test.
7. **B-PROFILE-STUB-TYPES-01** (MEDIUM) — Make the Phase-8 profile stubs `| null` or
   throw, removing the `null as unknown as X` casts.
8. **B-HOOK-TEST-COVERAGE-01** (MEDIUM) — Add `renderHook` tests for `useMilestoneAnswer`
   and the catch-up flow logic in `useCatchupFlow`.
9. **B-MIGRATION-JOURNAL-MONOTONIC-01** (MEDIUM) — Grandfather the idx 9-11 `when`
   anomaly and enforce strict monotonicity for idx ≥ 12 in `reconcile-drizzle.mjs`.
10. **D-FROM-FRIENDS-COPY-REGISTER-01** (HIGH, copy-owner) — Replace the
    competition-register friend-activity leads with discovery-register copy (already
    an open `DECISIONS.md` defect; needs sign-off, hence a D- not a B-).
11. **D-RLS-AND-SHARE-CAPABILITY-01** (LOW) — Document the RLS-backstop posture and the
    permanent ceremony share-token tradeoff in `DECISIONS.md`; decide on token expiry.
12. **D-DOC-DRIFT-CLEANUP-01** (LOW) — Correct PRODUCT-CANON §4 (`/replay` does not
    exist) and `DECISIONS.md` line 67 (stale collision values); fold the color-token
    cleanups (ceremony gradient, `EditorialPromos #fff`) into the existing ratchet work.
