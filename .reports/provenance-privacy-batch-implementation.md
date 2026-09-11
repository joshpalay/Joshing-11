# F6 / F8 / F9 implementation report — provenance & privacy batch

2026-09-10. Branch `claude/provenance-privacy-batch`, built on `origin/main` @ `8a504467`
("Question lifecycle quality fixes + end-to-end UX audit (#1647)"). Three commits, one per
finding, each independently revertible: `f556cfa6` (F6), `3abf6b9d` (F8), `51a11524` (F9a).

## 0. Environment note — read before trusting any other "current state" claim about this repo

This repo's working directory (`C:\Users\rpala\Desktop\dev\joshing-11`) is being driven by a
large number of concurrent sessions (899 peer sessions listed, several `busy` at the time of
writing). Mid-way through this task the branch and HEAD in that shared directory changed
underneath the investigation (`codex/question-lifecycle-quality` → `claude/mutual-friend-
suggestions-01`, via a live PR merge), and a brand-new, just-created git worktree briefly
picked up unrelated uncommitted edits from that shared directory before a `git clean` fixed it.
**All work in this batch was done in an isolated worktree** (`.claude/worktrees/provenance-
privacy-batch`, its own branch, built from a freshly-fetched `origin/main`) specifically to
avoid colliding with that concurrent activity. If this branch is later rebased or merged,
re-verify against a fresh `origin/main` rather than trusting the shared directory's live state.

## 1. Status table

| Finding | Status | Evidence |
|---|---|---|
| **F6** — bonus/recovery copy overstates knowledge/feelings | **CONFIRMED** | `bonusSourceLabel` (`GameplayChat.tsx:268`, pre-fix) rendered `FROM {NAME}'S KNOWLEDGE`, but its only input source (`friend-presence-domains.ts`) is a domain the friend has *declared or is active in* — territory ∪ activity — never a fact confirmed correct. `returnRecoveryNote` (`daily/page.tsx:75`, pre-fix) rendered `"It stuck. {author} would be glad."`, attributing a feeling never solicited. The data model **does** distinguish signal strength (`FriendDomainSignal: 'both'\|'territory'\|'activity'`) but `bonusSourceLabel` discards it entirely into one phrase — exactly the "distinction exists but is discarded" case the prompt asked me to call out explicitly. |
| **F8** — adjacent social APIs fall back to raw phone numbers | **CONFIRMED** | Four independent local `displayName(name, fallback)`-style helpers (`api/users/route.ts`, `api/users/recent/route.ts`, `friends.ts`'s `getFriendsHub`, `profile/friend.ts`'s `getFriendPortraitData`) all passed `user.phoneNumber` as the fallback, and all four reach a client JSON response body or a rendered profile/hub row. One existing test (`friend.test.ts`) explicitly asserted the phone-leak as a *feature*: `"falls back to the verified phone number when a friend has no display name yet"`. |
| **F9** — discovery controls / abuse protection incomplete | **CONFIRMED**, mixed | See the per-item breakdown in §2b. Two sub-claims in the audit were **already accurate and needed no fix**: (1) the salt comment in `phone-hashing.ts` already says "the salt itself isn't a true secret" — no false "encrypted" claim exists anywhere in the codebase (grepped `encrypt` case-insensitively across `src`, zero hits). (2) confirmed the `discoverableByContacts` gap is real (see §4). |

**Contradiction found vs. the task prompt, not the audit:** the prompt's sequencing note said
to check whether "the earlier F1/F7 batch" (search lifecycle, throttling copy, F2 vocabulary, F4
topic-badge, F5 link provenance) had landed and build on it if so. Mid-investigation I initially
read a squashed PR (`8a504467`) as having landed it, based on file contents that turned up in a
fresh worktree — **the user corrected this in real time**, and re-verification (fetch + diff
`HEAD` vs `origin/main`, then `git clean` the worktree) confirmed the batch has **not** landed:
those files were transient contamination from the shared directory, not committed content. This
batch was built on a clean `origin/main`, with no F1/F7 work present, so there was nothing to
build on or avoid reverting.

## 2a. F8 — consumer inventory (mandatory before editing, per the task)

| Consumer | Old fallback source | Reaches | Fixed? |
|---|---|---|---|
| `GET /api/users` (`api/users/route.ts`) | local `displayName(name, phone)` | Client JSON body | ✅ routed through `resolveDisplayName` |
| `GET /api/users/recent` (`api/users/recent/route.ts`) | local `displayName(name, phone)` | Client JSON body | ✅ |
| `getFriendsHub` (`friends.ts`) — Friends hub `following`/`followers`/`incomingRequests.requesterName`/`outboundRequests.recipientName` | local `displayName(name, phone)` | `/api/friends` JSON body → `FriendsList.tsx` rows | ✅ |
| `getFriendPortraitData` (`profile/friend.ts`) — profile header **and** mutual-friends list | local `profileDisplayName(name, phone)` | `/users/[id]` page (own profile route, not `friends/route.ts`) | ✅ |
| `getUserProfile` / `getEditableProfile` (`account.ts`) | `fallbackDisplayName(phone)` → `"Player 1234"` | Self-view only (a user's own settings page, which also shows their own real phone number in the same payload) | **Left as-is, deliberately.** Not a leak — you're looking at your own number. Different, already-reasonable pattern; out of scope. |
| `getAllUsers` (`joshing-game.ts`) | local `displayName(name, phone)`, plus returns raw `phone` field directly | **Zero call sites** (`grep` found none outside its own file) | **Left as-is.** JoshingGames is a retired surface (B-10.1, 2026-08-30): routes redirect to `/`, prod has zero `JoshingGame*` rows. Ground rules say don't touch retired code paths. |
| `dev/points-diagnostic/page.tsx` | inline `user.displayName \|\| user.phoneNumber \|\| user.id`, plus prints raw phone in the UI | Dev-only diagnostic page | **Left as-is.** Internal dev tool, not a player-facing "adjacent social API"; flagged here for completeness, not fixed — ask before touching if this matters. |

**Fix:** one new shared resolver, `src/server/lib/display-name.ts` — `resolveDisplayName({ displayName, handle })`:
display name → `@handle` → `"Joshing friend"` generic placeholder. Phone number never appears at
any step. All four in-scope consumers now import and use it; the four duplicated local helpers
were deleted.

## 2b. F9 — limiter and discoverability call-site inventory

| Surface | Current shape | Verdict |
|---|---|---|
| `friends/search/route.ts` rate limit | In-memory `Map`, per-instance, 8/min account + 40/min IP defaults (env-tunable), `Retry-After` header present | **CONFIRMED** matches audit. Durable/shared store NOT built this batch (see §3). |
| `friend-requests/route.ts` rate limit | Same shape, 20/day + 60/week per account | **CONFIRMED** matches audit. |
| Both limiters' env-var parsing | `Number(process.env.X ?? default)` — an unparseable/zero/negative override silently became `NaN`/`0`, and every `count >= threshold` check is then always `false` → **the cap silently disables itself** | **Found and fixed** (not named explicitly in the audit, but squarely inside "fail closed on limiter unavailable or misconfiguration"). New `intEnv()` guard falls back to the documented default on any non-positive-integer input. |
| `friend-search.ts` exact-phone lookup | `eq(users.phoneNumber, normalized)` — **no discoverability check at all** | **CONFIRMED gap.** See §4 — deliberately **not** gated this batch, per your answer. |
| `contact-hashes.ts` contact-sync lookup | `eq(contactHashes.userId, callerId) AND eq(users.discoverableByContacts, true)` | Already respects the preference — this is the "good" path the audit compares against. |
| `clientIpFrom` (search route) | Trusts the **first** entry of `x-forwarded-for` as the real client IP | **Documented, not changed** — see the code comment added in `f9(a)`. If a proxy chain *appends* rather than *overwrites* this header (the common X-Forwarded-For convention), the first entry is attacker-supplied and this becomes a rate-limit bypass. This repo's Vercel-only deployment target is consistent with "Vercel itself sets it," per CLAUDE.md, but that has not been independently verified against live platform behavior in this session — see the decision memo (§5). |
| Durable, privacy-preserving search-abuse log | Did not exist | **Added** — `logTelemetry('friend_search_performed', {outcome})`, `friend_search_rate_limited`/`friend_request_rate_limited` `{reason}`. Counts + coarse outcome only, no query value, no resolved identity, ever (tested — see §3). |
| `phone-hashing.ts` salt comment | Already says "the salt itself isn't a true secret" | **ALREADY FIXED** — no change needed. |
| "encrypted phone search" claim anywhere | Searched `encrypt` (case-insensitive) across all of `src` | **NOT FOUND anywhere** — nothing to fix. |
| `/api/handle/check` "Public (no auth)" comment | Route is **not** excluded from `proxy.ts`'s matcher, so an unauthenticated request 401s before the handler runs | **CONFIRMED stale, fixed.** Comment corrected; **did not** add a proxy exemption (that would make the claim true by changing behavior instead of the comment — explicitly told not to do that). |

## 3. Files changed, tests added, command results

**F6** (`f556cfa6`) — `GameplayChat.tsx`, `daily/page.tsx`, and four test files (one new:
`GameplayChat.bonusSourceLabel.test.tsx`), covering: a friend's world with one vs. multiple
sources (never "knowledge"), a friend-authored recovery note (provenance in words, no
attributed feeling), a house/LLM-origin recovery note (stands alone), and the missing/unknown-
scope cases (no note at all). 26 tests pass.

**F8** (`3abf6b9d`) — new `src/server/lib/display-name.ts` + its unit tests (6 precedence-branch
cases including the legacy nameless/handle-less account); updated `api/users/route.ts`,
`api/users/recent/route.ts` (+2 new route test files asserting no phone number ever appears in
the response body); `friends.ts`'s `getFriendsHub` (+1 new end-to-end hub test, +1 existing test's
mock schema extended with `groupBy` which the existing mock chain was missing); `profile/
friend.ts` (+2 rewritten tests replacing the one that asserted the phone-leak as intended
behavior). 28 tests pass.

**F9(a)** (`51a11524`) — `friends/search/route.ts` (`intEnv` guard, IP-trust comment, telemetry
calls), `friend-requests/route.ts` (same `intEnv` guard, telemetry call), `telemetry.ts` (3 new
event names), `api/handle/check/route.ts` (comment fix). Two new test files: `rate-limit-
config.test.ts` for each route (misconfigured-threshold fail-closed cases, a validly-configured
override still works, plus — for the search route only — two tests that **document the known,
unfixed** per-instance/cold-start gap so a future durable-limiter change has a clear test to
flip). Extended the existing `friends/search/route.test.ts` with 4 telemetry assertions
(outcome-only on match/no-match, coarse-reason-only on rate-limit, silence on invalid input).
28 tests pass.

**Whole-repo verification** (run from the isolated worktree, after `npm install`):
- `npx tsc -p tsconfig.typecheck.json` — **0 errors.**
- `npm run lint` — **0 errors**, 5 pre-existing warnings (off-system color / one unused eval
  var), none introduced by this batch, under the `--max-warnings 16` ceiling.
- `npx vitest run` (full suite) — **358 files / 2760 tests passed, 3 files / 36 tests skipped,
  0 failures.**
- `npm run build` — **failed**, but for an environmental reason unrelated to this batch:
  `Error: DATABASE_URL is required to initialize the database client` during static page-data
  collection for `/api/auth/logout`. This worktree has no `.env`/`.env.local` (both are
  gitignored and not copied into a fresh `git worktree add` checkout). The main working
  directory's `.env` is documented elsewhere in this repo's memory as pointing at the
  **production** database directly — I deliberately did **not** copy production credentials
  into this throwaway worktree just to make a build succeed, since that risks a build-time
  script touching prod. Compilation itself succeeded (`✓ Compiled successfully in 29.8s`,
  TypeScript pass completed) before the DB-dependent step failed, which is consistent with the
  clean typecheck/lint/test results above. **This is a recorded environmental limit, not a
  defect** — per the task's own instruction to record such limits rather than work around them
  (e.g. by pointing a fresh build at prod).
- UI verification at desktop/390×844 and a live authenticated walkthrough: **not performed.**
  All three findings are server-side copy/data/API-layer fixes with no new client markup;
  existing component/route tests exercise the changed behavior. No safe test authentication was
  available in this session (consistent with the original audit's own finding).

## 4. F9(b) — owner decision memo (write-up only, not implemented)

### Decision 1: should exact-phone/handle search respect `discoverableByContacts`?

**Asked and answered during this batch: not this round.** You chose "Don't gate it yet — write
up only." Recorded here for the permanent record:

- **The gap:** `searchFriendByHandleOrPhone` (typed-in exact search) does not check
  `discoverableByContacts` at all; `listContactMatches` (passive contact-sync) does.
- **Why gating is not a free engineering fix:** `discoverableByContacts` defaults to `false` for
  every account (schema default, `schema.ts:314`) and nothing sets it `true` at signup. Gating
  the exact-search path on it as-is would make the large majority of existing and future users
  **unfindable by phone number** — including by people who already have their number and are
  trying to add them — until they separately visit Settings and opt in. That is a large,
  player-visible change to a capability the audit calls a strength, not a narrow privacy patch.
- **Options for a future decision:**
  (a) Leave exact search ungated (status quo) — an exact phone/username guess still confirms
      membership regardless of preference; acceptable if "I know your exact number/handle and
      typed it on purpose" is treated as a categorically different, lower-risk act than passive
      contact-list scanning.
  (b) Gate exact search on `discoverableByContacts` as literally proposed — breaks phone-based
      discovery for most users until they opt in; would need a companion product decision
      (e.g., default it `true`, or introduce a distinct "findable by exact lookup" preference
      separate from "findable via my contacts").
  (c) Introduce a new, narrower preference specific to exact lookup (e.g. `discoverableByExact
      Search`, defaulting to the CURRENT observable behavior — `true` — so nothing changes for
      existing users) and gate on that instead of overloading `discoverableByContacts`. This is
      closer to "explain the contract, then let people opt out of it" than "silently narrow an
      existing flag's meaning." Requires a migration — flagged, not built.
- No default was changed. No migration was written.

### Decision 2: exact-lookup privacy contract

What should "I can find you by typing your exact phone number or handle" mean to a player, and
how is it explained? Right now nothing in the product surfaces this as a stated contract — it's
implicit in how search behaves. Options: (a) leave implicit, (b) add a line to onboarding/privacy
settings stating plainly that an exact phone/handle guess will always confirm membership
regardless of discoverability settings (honest, but may itself read as alarming), (c) treat this
as accepted product behavior and only document it internally (this report + code comments).

### Decision 3: enumeration risk beyond durable throttling

Repeated exact guesses (e.g., dialing through a number range) remain possible even with a
durable, shared rate limiter — throttling slows it, it doesn't stop it. Is a slowed-down
enumeration engine an acceptable residual risk at current scale, or does it warrant something
further (e.g., CAPTCHA after N misses, temporary lockout, anomaly alerting on the new abuse-
signal telemetry)? Not addressed this batch.

### Decision 4: bearer-link sharing expectations

A reusable invite link is a credential held by whoever has it, not proof of identity. Should the
product say anything about what happens if a link is forwarded/leaked (e.g., "anyone with this
link can join as your invitee")? Not addressed this batch — flagged only, per the prompt's
explicit "write up, don't implement" instruction.

### Decision 5: person-reporting / harassment workflow

Content reporting exists (per the audit and this investigation); a complete people-reporting/
harassment workflow does not appear to exist as a distinct surface from content reports. Whether
that gap needs a dedicated build is a product call, not evaluated further here.

### Decision 6: retention and access policy for the new abuse signal

The new `friend_search_rate_limited` / `friend_search_performed` / `friend_request_rate_limited`
telemetry rides the existing `logTelemetry` → `console.info` channel, which means its retention
and access are whatever this repo's existing runtime-log retention/access policy already is
(Vercel function logs, and whatever log-drain/Axiom setup exists downstream — this session did
not inspect that configuration). If a longer-lived or more structured abuse-signal store is
wanted later, that's a new decision (and, per the ground rules, a new migration requiring
approval) — not something this batch should have silently provisioned.

### Decision 7: `x-forwarded-for` first-hop trust

Documented in code (§2b) rather than changed. Needs verification against actual Vercel platform
behavior — specifically whether Vercel's edge *overwrites* `x-forwarded-for` for a direct
(non-proxied) client request, or *appends* the observed peer to a client-supplied value. If the
latter, the current `.split(',')[0]` is reading attacker-controlled input, and the fix is almost
certainly `.split(',').pop()` (the last/innermost-observed hop) instead — but flipping this
blind, without confirming Vercel's actual behavior, risks breaking the fallback for shared-egress
legitimate users in the other direction. Recommend confirming via Vercel's own documentation/
support rather than empirical testing against production traffic.

## 5. Deferred items and why

- **Durable (shared/cross-instance), persistent-across-cold-start rate limiting.** Both routes
  stay on the existing in-memory, per-instance `Map`. Per the ground rules ("No database
  migrations without explicit approval — if a durable store is required for F9, propose it and
  stop"), this is a proposal, not a build: a Redis/KV-backed sliding window (Vercel Marketplace
  offers Upstash Redis) sharing the exact same threshold constants and `Retry-After` contract,
  swapped in behind the same `checkSearchRateLimit`/`checkFriendRequestRateLimit` function
  signatures so route code doesn't change. **Stopping here per instruction; awaiting approval
  before provisioning anything.**
- **Exact-phone discoverability gating** — see §4 Decision 1. Explicitly deferred per your
  answer this session.
- **`x-forwarded-for` hardening** — documented, not changed, pending platform-behavior
  confirmation (§4 Decision 7).
- **`dev/points-diagnostic` phone display** and **`joshing-game.ts`'s `getAllUsers`** — noted in
  the F8 inventory, left untouched (dev-only tool; retired, zero-call-site code path).
- **F1/F7/F2/F3/F4/F5, F3 daily-status counting, F10/F11, F12, the broad generated-context
  framing redesign** — out of scope for this batch per the prompt; not touched, not redone, not
  reverted (there was nothing of theirs present to revert, per §0).
- **Live authenticated walkthrough / UI screenshots at 390×844** — no safe test authentication
  was available in this session, consistent with the original audit. All three findings are
  server/data-layer copy and API fixes with existing test coverage; no new client markup was
  added that would need a rendering pass in a browser.
