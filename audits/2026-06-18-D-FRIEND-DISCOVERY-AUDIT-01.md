# D-FRIEND-DISCOVERY-AUDIT-01 — Friend search & in-app add

**Date:** 2026-06-18
**Type:** Diagnostic / audit (read-only — no build, no behavior changes)
**HEAD at audit:** `900a689` (Merge PR #1051 "invite-existing-accounts")
**Goal:** Establish ground truth on what friend-discovery capability exists in live code today — search by handle / display name, lookup by phone, and the in-app friend-request flow — so we know what was removed, what remains, and what needs building before this becomes a B-prompt.

---

## TL;DR

**Josh's recollection does not match the code.** Friend search/lookup by **@handle** and **US phone number** is **present, live, wired into navigation, test-covered, and has a clean add-and-refine git history with no deletion at any point.** It was introduced in PR #559 (`592421e`, 2026-06-02) and only ever modified for styling since.

The one nuance that rescues the recollection: **search of *strangers* by display name was never built.** Platform-wide lookup matches handle or phone only (exact match, no partial leakage). Display-name search exists only as a *client-side filter over your already-loaded friends list*. If Josh remembers "type a name, find a person you don't know yet," that specific capability has never existed.

Separately, the data model has moved on since the PRD was written: the PRD's `FRIENDSHIPS` / `formed_via=in_app_request` design is **frozen and vestigial**. The live model is a directional **`Follow`** table (migration `0058`), and **`Friendship.formedVia` is never written by any live code path.**

---

## Architecture note (read this first — the PRD is stale)

There are **two parallel relationship models** in the schema:

- **Legacy (frozen):** `Friendship` table — `src/server/db/schema.ts:972-995`. Symmetric edge with `status` (text, default `'pending'`), `requestedByUserId`, `formedVia` (text, **not** an enum), `personalNote`, `expiresAt`, `resolvedAt`. Only touched now by the legacy expiry cron.
- **Current (active, D-1 Stage 3):** `Follow` table — `src/server/db/schema.ts:1002-1034`, added in `drizzle/0058_follow_model.sql`. Directional edges (`followerId`, `followeeId`) with `state` enum `['pending','approved']`. **Two approved edges in both directions = "friends" (mutual follow).**

This matters for the whole audit: PRD §7.2's `FRIENDSHIPS` + `formed_via` vocabulary describes a model the code has superseded. Read findings below in terms of the **Follow** model.

---

## A. Identity / call sign

**1. Is there a call sign / handle / unique username field?** — **Yes.**
- `handle: text('handle')` — `src/server/db/schema.ts:225` (nullable).
- Enforced unique, case-insensitive, via partial index: `CREATE UNIQUE INDEX "idx_users_handle_lower" ON "User" (LOWER("handle")) WHERE "handle" IS NOT NULL` — `drizzle/0045_user_handle.sql:18-19`.
- Companion rate-limit column `handleLastChangedAt` — `schema.ts:226` (30-day change cooldown).
- Other identity columns: `displayName` (`schema.ts:208`, nullable), `phoneNumber` (`schema.ts:206`, NOT NULL, unique `User_phone_number_key` at `schema.ts:257`), `phoneHash` (`schema.ts:238`, for contact discovery), and a legacy `slug` (`schema.ts:224`, knowledge-card shares — unrelated).

**2. Where is it set / exposed in UI?** — **Onboarding + profile, both live.**
- Set during signup: login step 3 labeled **"Call sign / handle"** — `src/app/login/LoginPanel.tsx:804` (placeholder `jpalay`, real-time availability check via `/api/handle/check`, submit via `PATCH /api/account/handle`).
- Edited on own profile via `InlineHandleField` — `src/components/profile/InlineHandleField.tsx` (30-day cooldown; confirmation prompt).
- Displayed as `@{handle}` on profiles (`src/app/users/[id]/page.tsx:474-484`) and in search/contact result cards (`FindFriendsSearch.tsx:142-144`, `ContactMatchBlock.tsx:235-237`).

**3. Reconcile "call sign" vs PRD's phone key.** — The user-facing term is **"call sign"**; the code variable is **`handle`**. The lookup route keys on **handle OR phone** (`friend-search.ts:45-73`). Display name is **not** a platform lookup key. So all three terms are in play, but only handle and phone resolve a stranger.

---

## B. Search / lookup surfaces

**4. Does a friend-search input exist, and does it find non-friends?** — **Two distinct search inputs exist; one finds strangers, one does not.**

- **Platform-wide lookup (finds non-friends):** `FindFriendsSearch.tsx` on the `/friends/find` page. Debounced (400ms), fetches `GET /api/friends/search?q=…` (`FindFriendsSearch.tsx:51-54`), placeholder `"@handle or (415) 555-1234"`. Backed by `searchFriendByHandleOrPhone()` — `src/server/db/queries/friend-search.ts:30-83`:
  - Handle branch: case-insensitive **exact** match (`LOWER(handle) = LOWER(?)`), pattern `^@?[a-z][a-z0-9_]{2,19}$/i` — `friend-search.ts:45-58`.
  - Phone branch: normalized US E.164 **exact** match on `phoneNumber` — `friend-search.ts:59-72`.
  - Returns `null` on no match, self-match, or block — `friend-search.ts:75-80`. **Exact-match only — no partial / substring leakage, no display-name search of strangers.**
- **Friends-list filter (existing friends only):** `"Search friends…"` input in `FriendsList.tsx:628`; in-memory filter over already-loaded friends across displayName + declared/shared interests — `FriendsList.tsx:447-471`. Does **not** hit the platform.

**5. Is there a "Find friends" / "Add a friend" entry point? Does the target exist?** — **Yes; `/friends/find` exists and renders (not a 404).**
- Page: `src/app/friends/find/page.tsx` — sections in order: handle/phone search, contact matches (opt-in), "people you invited who are now active," invite-someone-new (SMS/copy-link), and a "Suggested via mutual friends — Coming soon" placeholder.
- Reached from: feed editorial carousel (`src/components/feed/EditorialPromos.tsx:56`, `COMMON_GROUND_INVITE_HREF = '/friends/find'`, test-asserted in `EditorialCarousel.test.tsx:104`) and the activity-stream add-friends promo (`src/server/activity/add-friends-promo.ts:25`).
- The main Friends hub (`src/components/FriendsHubPage.tsx`) leads with an **"Invite Someone"** button (phone-invite modal `AddFriendInvite.tsx`), **not** a direct link to `/friends/find`. (Minor gap noted in §Open decisions.)

**6. API route resolving identifier → account?** — **Yes:** `GET /api/friends/search` — `src/app/api/friends/search/route.ts` (Zod-validated `q`, auth-gated, delegates to `searchFriendByHandleOrPhone`). This is the in-app discovery lookup. No display-name resolver exists.

---

## C. The in-app friend-request flow (Path 2)

**7. Does a friend-request concept exist (pending/accepted/ignored)?** — **Yes, in the Follow model.** `Follow.state` enum `['pending','approved']` (`drizzle/0058_follow_model.sql:14`). A pending inbound edge IS the "friend request." `Follow.privacy`/`User.follow_privacy` enum `['public','approval_required']` (default `approval_required`) governs whether a request auto-approves. The legacy `Friendship.status` text column is the PRD-era equivalent and is frozen.

**8. Is `FRIENDSHIPS.formed_via = 'in_app_request'` ever written?** — **No. `formedVia` is vestigial and never written by any live path.**
- It's a plain `text('formedVia').notNull()` (`schema.ts:980`) — **not an enum** (contrary to the prompt's assumption; there is no `in_app_request` enum value anywhere).
- Zero write sites. Both real friendship-formation paths write to `Follow`, which has no `formedVia` column:
  - In-app request: `createOrReusePendingFriendshipRequest()` inserts a `Follow` edge (`pending`, or `approved` if target is public) — `src/server/friends/friendships.ts:43-104`.
  - Invitation acceptance: `upsertInvitationFriendship()` inserts two approved `Follow` edges — `src/server/friends/friendships.ts:219-252`.
- **The SMS-invite vs in-app-request distinction is implicit, not recorded** — there is no column marking which path formed an edge.

**9. Trace Path 2 end-to-end — where does it break?** — **It does not break. All six steps are implemented and live.**

| Step | Status | Evidence |
|---|---|---|
| 1. Enter identifier (handle/phone) | ✅ implemented | `FindFriendsSearch.tsx`; `api/friends/search/route.ts` |
| 2. Match existing account | ✅ implemented | `friend-search.ts:30-83` |
| 3. Send request | ✅ implemented | `POST /api/friend-requests` → `createOrReusePendingFriendshipRequest()` inserts `Follow` (`state='pending'`, or `'approved'` if target public) — `api/friend-requests/route.ts`, `friendships.ts:43-104` |
| 4. Recipient sees pending request | ✅ implemented | `GET /api/friends` → `incomingRequests` (`friends.ts:307-443`); also a `follow_request` activity item (`activity.ts:178-242`) |
| 5. Recipient accepts | ✅ implemented | `POST /api/friend-requests/[id]/accept` → edge → `state='approved'` (`friendships.ts:110-142`) |
| 6. Both become friends | ✅ implemented | mutual approved edges; `getMutualFollows()` (`friends.ts:120-137`) |

Recipient inbox + actions are real: accept (`/api/friend-requests/[id]/accept`), ignore (`/ignore`), cancel outbound (`/cancel`), unfollow (`/remove`), plus `FriendRequestActions.tsx` UI on the activities feed and the Follow-Requests section in `FriendsList.tsx`.

**Recent polish (today, `fe050e5`, 2026-06-18):** inviting a phone number that already has an account now converts the invite into a follow request server-side and surfaces that state to both parties ("already on Joshing" / "you're now following" / "request still pending"). So the invite path and the in-app-request path are actively converging.

---

## D. Removal evidence

**10. Was friend search/lookup deliberately removed?** — **No. There is zero evidence of removal.** The recollection is not supported by the repo.

- **Decisive check — no deleted files:** `git log --all --diff-filter=D` over `*friend-search*`, `*friends/search*`, `*FindFriendsSearch*`, `*friends/find*` returns **empty**. The name-status history of these paths is only `A` (add) and `M` (modify), never `D`.
- **Single clean introduction:** all three core files added in `592421e` (Merge PR #559, 2026-06-02). The only later touch is `5b87347`, a cosmetic radius/shadow-token refactor.
- **No flags / no commented-out blocks:** the route and component run unconditionally behind standard auth. No env var or feature flag disables them.
- **Handle column never dropped:** added in `drizzle/0045_user_handle.sql` (motivation comment cites exact-handle search), and a sweep of every `DROP COLUMN` in `drizzle/*.sql` shows handle is never dropped. Related work only *added* capability (`8703fd4` suggest signup handles; PR #876 `fa896f6` call-sign suggestion in LoginPanel).
- **No DECISIONS.md entry** about removing/reversing/deprecating friend search, lookup, add-friend, or call sign.

---

## Three-bucket summary

### ✅ Exists & works (live, reachable)
- Platform lookup by **@handle** (exact, case-insensitive) and **US phone** (exact, E.164) — `friend-search.ts`, `GET /api/friends/search`.
- `/friends/find` discovery page (search + contact matches + invite reflections + invite block), linked from feed + activity promos.
- **Call sign / handle**: set at onboarding, edited on profile (30-day cooldown), DB-unique, displayed as `@handle`.
- **Full in-app friend-request handshake (Path 2)**: send → pending inbox → accept/ignore → mutual follow. Backed by the `Follow` model.
- Friends-list **filter over existing friends** (display name + interests).
- Phone-invite path, with same-account → follow-request conversion (as of `fe050e5`).

### ⚠️ Exists but partial / placeholder
- **"Suggested via mutual friends"** on `/friends/find` — explicit "Coming soon" placeholder; no friend-of-friend suggestion engine wired.
- **No direct `/friends/find` link from the main Friends hub** — the hub leads with "Invite Someone"; discovery is reached via feed/activity promos. Reachable but arguably under-surfaced.
- **`Friendship` table + `Friendship.formedVia`** — present in schema but frozen/vestigial; `formedVia` never written. Latent confusion risk for anyone reading the PRD against the code.

### ❌ Absent (never built or removed)
- **Search of strangers by display name / name fragment / partial handle.** Platform lookup is exact-match handle-or-phone only. Display-name search exists *only* over already-loaded friends. This is the closest thing to Josh's recollection — and it was **never built**, not removed.
- **`in_app_request` as a recorded provenance value** — no enum, no write site. Path provenance is not tracked.
- Any deleted/flag-disabled friend-search code — none found.

---

## Open product decisions (these gate a future B-prompt — not proposed here)

1. **Is the lookup key intentionally exact-match handle-or-phone?** Or do we want fuzzy/partial search and **display-name discovery of strangers**? (This is the crux of the "it was removed" recollection — decide whether to *build* it, since it never existed. Note privacy implications of name-based stranger search.)
2. **Should the main Friends hub link directly to `/friends/find`?** Currently discovery is only promoted from the feed/activity stream.
3. **Do we record friendship provenance** (invite vs in-app request vs contact match) now that `formedVia` is dead and the `Follow` model has no equivalent? Several surfaces might want it.
4. **Fate of the frozen `Friendship` table / `formedVia` column** — formally deprecate/drop, or keep as backstop? Its presence makes the PRD read as describing live behavior when it doesn't.
5. **Build out "Suggested via mutual friends"** (the FoF suggestion engine) — the placeholder implies intent.
6. **PRD reconciliation:** §7.2's `FRIENDSHIPS`/`formed_via`/`in_app_request` vocabulary should be rewritten against the Follow model, or future readers will keep re-deriving this gap.

*Per the prompt: no build sequence and no B-prompt here — findings only, pending Josh's review.*
