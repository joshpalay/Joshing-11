# B-Friends prompts — revised against actual schema

**Source of intent:** `joshing-prd-v12-friends-discovery.md` v12 §9.6.3 + §9.6.4.

**Why revised:** The original build prompts (drafted against an idealized schema) assumed `users.handle`, `users.avatar_color`, a multi-tab Friends Hub, a normalized `users.phone`, and migrations under `src/server/db/migrations/`. None of those hold. This document replaces the original B-Friends-1 and adds prerequisite prompts (P0-A through P0-D) that must merge first.

**Order:** P0-D → P0-A → P0-B → P0-C → B-Friends-1 (revised). B-Friends-2 / -3 / -4 still need their own revision pass once these have shipped.

> **Audit pass (2026-05-23):** Feasibility audit complete. See **"Per-prompt readiness (audit pass)"** at the bottom of this document for verdicts and decisions. **P0-C body has been rewritten** based on the audit finding that `FriendsList.tsx` already implements internal tabs.

---

## P0-D — Profile page design *(new prerequisite)*

**Goal:** Design and ship `/account/profile`, which is currently a stub at `src/app/account/profile/page.tsx`. P0-A (handles) is blocked on this because the handle has no rendering home until the profile page exists.

### Scope

- Design pass — fields to surface: `displayName`, `@handle` (once P0-A lands), phone, avatar (using `AvatarChip` from P0-B once it lands).
- Edit affordances for `displayName` (existing `updateDisplayName` in `src/server/db/queries/account.ts:171` already supports it) and — once P0-A lands — `@handle` (rate-limited).
- Replace the current `<StubPage ... />` body in `src/app/account/profile/page.tsx`.
- Match the visual language of the existing `/account/notifications` page (`src/app/account/notifications/NotificationsForm.tsx`).

### Out of scope

- The handle picker itself (P0-A).
- Avatar customization UI (just render `AvatarChip` once P0-B lands).
- Bio / tagline fields mentioned in the current stub copy — fast-follow.

**Detailed design work TBD.** This entry is a placeholder to record the dependency. Flesh out before starting P0-A.

---

## P0-A — Add user handles

**Goal:** Introduce a public-facing `handle` per user. Required for invite links (`/invite/<handle>/<token>`) and exact-handle search in B-Friends-3.

### Scope

#### Migration

File: `drizzle/0045_user_handle.sql` (use the `new-migration` skill; renumber to whatever's actually next at the time).

```sql
ALTER TABLE users ADD COLUMN handle TEXT;
CREATE UNIQUE INDEX idx_users_handle_lower ON users (LOWER(handle)) WHERE handle IS NOT NULL;
ALTER TABLE users ADD COLUMN handle_last_changed_at TIMESTAMPTZ;
```

Two-phase rollout: nullable for now, NOT NULL in a follow-up migration once backfill is complete and signup is gated on entering one.

Update `src/server/db/schema.ts` to add `handle: text('handle')` and `handleLastChangedAt: timestamp('handle_last_changed_at', { withTimezone: true })` on the users table.

Add an idempotent guard in `src/instrumentation.ts` (matching the existing pattern for partial-prod DBs) so the column exists at boot.

#### Backfill

One-shot script `scripts/backfill-user-handles.ts`:

- For every user with NULL handle, generate `<sanitized-displayName>` + `<4-char nanoid suffix>`. Lowercase. Strip non-`[a-z0-9_]`. Truncate to 20 chars before the suffix.
- Collision handling: retry with a fresh suffix up to 5 times, then fall back to `user_<first 8 of UUID>`.
- Idempotent: skip rows where handle is already set.
- Run with `npx tsx scripts/backfill-user-handles.ts`.

#### Validation helper

File: `src/server/lib/handle-validation.ts`

- Format: `^[a-z0-9_]{3,20}$`, must start with a letter.
- Reserved list: `admin`, `joshing`, `system`, `api`, `account`, `friends`, `invite`, `me`, `support`, plus the existing top-level route names. Read `src/app/` to enumerate routes — store the list as a constant; don't compute at runtime.
- Returns `{ ok: true } | { ok: false, reason: 'format' | 'reserved' | 'taken' }`.

#### Signup flow

Find the current signup/onboarding handoff (likely under `src/app/(onboarding)/` or wherever the post-verify step lives). Add a handle-picker step:

- Suggests `<sanitized-displayName>` by default.
- Live-validates against `GET /api/handle/check?handle=<x>` (debounced 300ms).
- Required to proceed.

#### API

- `GET /api/handle/check?handle=<x>` — returns `{ available: boolean, reason?: 'format' | 'reserved' | 'taken' }`. Public (no auth) so the signup picker can hit it pre-login.
- `PATCH /api/account/handle` — authenticated. Body: `{ handle: string }`. Rate-limit: 1 successful change per 30 days per user via `users.handle_last_changed_at`.

#### Display

Add handle to the profile header / wherever displayName currently renders alongside identifying info. Format as `@handle` in display. Don't replace displayName — they're additive.

### Acceptance

- Every existing user has a non-null handle after backfill.
- New users can't complete signup without picking one.
- `@handle` renders on profiles.
- Handle changes rate-limited to once per 30 days.
- `/api/handle/check` returns correct verdicts for taken / reserved / malformed handles.
- The unique-lower index prevents `Robyn` and `robyn` from coexisting.

### Out of scope

- A handle-change UI in account settings (the API exists; surface comes later).
- Migrating `handle` to NOT NULL (separate follow-up once 100% backfilled and signup is gated).

---

## P0-B — Add `avatar_color`

**Goal:** Give every user a deterministic avatar color so the chip-style mockups in the friends surfaces (`[SA]`, `[RO]`) render with the intended visual variety.

### Scope

#### Migration

File: `drizzle/0046_user_avatar_color.sql`.

```sql
ALTER TABLE users ADD COLUMN avatar_color TEXT;
```

Drizzle: `avatarColor: text('avatar_color')` on users.

Instrumentation guard.

#### Palette

File: `src/lib/avatar-palette.ts`.

Define 8 named tokens that match existing brand color vars (read `src/styles/` first to find the source of truth — don't invent new tokens).

```ts
export const AVATAR_COLORS = ['clay1','clay2','clay3','clay4','clay5','clay6','clay7','clay8'] as const;
export type AvatarColor = typeof AVATAR_COLORS[number];

export function avatarColorForUserId(userId: string): AvatarColor {
  const hash = [...userId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
```

#### Backfill

`scripts/backfill-avatar-colors.ts`: compute `avatarColorForUserId(user.id)` for every NULL row.

#### Signup

On user creation, set `avatarColor = avatarColorForUserId(id)`. Single line at the insert site.

#### Component

File: `src/components/AvatarChip.tsx`.

Props: `{ displayName: string, color: AvatarColor, size?: 'sm' | 'md' | 'lg' }`. Renders the 2-letter initials chip with the color background. Use existing CSS module / Tailwind tokens — don't add inline styles.

Replacing existing initials-chip implementations across the app is a follow-up, not required for this prompt.

### Acceptance

- Every user has a non-null `avatar_color` after backfill.
- New signups get one automatically.
- `AvatarChip` renders consistently across surfaces.
- The same user ID always produces the same color (deterministic).

---

## P0-C — Rename "Requests" tab to "Invitations" *(rewritten after audit)*

**Goal:** B-Friends-2 / -3 / -4 need a place in the Friends UI for friend-request lifecycle to live. The feasibility audit (2026-05-23) found that `src/components/FriendsList.tsx:120-159` **already implements** a three-tab UI (Friends / Requests / Sent). The original P0-C plan (wrapping it in an *outer* tabs layer) would have produced nested tabs — bad UX.

This rewrite keeps the existing internal tab structure and just renames "Requests" → "Invitations". B-Friends-2 lands the friend-request lifecycle into the renamed tab. No new components, no URL `?tab=` param yet (defer until B-Friends-4's tab-dot deep-link genuinely needs it).

### Scope

#### Rename
File: `src/components/FriendsList.tsx`.

- Tab label "Requests" → "Invitations" (both visible label and any `data-` / `aria-` selectors if they use the literal string).
- The internal `activeTab` state value can stay `'requests'` for now — purely a UI label change. If clarity wins, also rename the enum value to `'invitations'`. Either is fine; pick one and apply consistently in this PR.
- Update any test fixtures or snapshots that reference the old label.

#### Drop from the original P0-C
The following pieces from the pre-audit P0-C are explicitly **dropped**:

- The outer Friends / Invitations tab strip on `FriendsHubPage`.
- The `FriendsTabContent.tsx` and `InvitationsTabContent.tsx` wrapper components.
- The `?tab=friends|invitations` URL parameter.
- The header-restructure that moved the Add Friend button into the tab strip.

`FriendsHubPage.tsx` stays as-is.

### Acceptance

- The Friends tab in the bottom nav still goes to `/friends`.
- `FriendsList` now reads "Invitations" where it previously read "Requests" — both in the tab pill and in any empty-state copy.
- Nothing else about the page changes.

### Out of scope

- Adding deep-link URL state (B-Friends-4 may add a `?tab=` param if the new-discovery dot needs to route the user to a specific tab).
- Adding the Find Friends button / route (B-Friends-3).
- Wiring real friend-request lifecycle content into the Invitations tab (B-Friends-2).
- Overview, Active Now, Shared Interests sub-tabs from the original PRD §9.6.4 — those were always speculative and aren't needed in Phase 1.

---

## B-Friends-1 (revised) — Schema + privacy settings

**Goal:** Lay the foundation. Three migrations, env var, populate `/account/privacy` (currently a stub), wire the discoverability toggle endpoint. Nothing reads the flags yet.

**Depends on:** P0-A, P0-B, P0-C merged. (P0-B and P0-C aren't strictly required for the migrations + privacy page, but the friends surfaces won't be coherent without them.)

### Scope

#### 1. Migrations

Use the `new-migration` skill for each (or one combined file — single file is fine since they're related). Latest existing migration at time of audit is `0044_user_last_activity_bell_opened_at.sql`, so this would be `0047_*` after P0-A and P0-B land.

**Migration A — discoverability columns on users:**

```sql
ALTER TABLE users ADD COLUMN discoverable_by_contacts BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN discoverable_by_mutual_friends BOOLEAN NOT NULL DEFAULT FALSE;
```

**Migration B — `contact_hashes` table:**

```sql
CREATE TABLE contact_hashes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_hash  TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phone_hash)
);
CREATE INDEX idx_contact_hashes_phone ON contact_hashes (phone_hash);
```

Note: `user_id` is `TEXT` not `UUID`, matching the existing `users.id` column type in this schema.

**Migration C — extend `friendships` with request-lifecycle columns:**

The 2026-05-23 independent audit found that `friendships.status = 'pending'` already models inbound friend requests (see `src/server/db/queries/friends.ts:198-214` + `src/server/friends/friendships.ts:83-156`). Rather than introduce a parallel `friend_requests` table, this migration extends the existing one.

```sql
ALTER TABLE "Friendship" ADD COLUMN personal_note  TEXT;
ALTER TABLE "Friendship" ADD COLUMN expires_at     TIMESTAMPTZ;
ALTER TABLE "Friendship" ADD COLUMN resolved_at    TIMESTAMPTZ;
ALTER TABLE "Friendship" ADD CONSTRAINT friendship_personal_note_length
  CHECK (char_length(personal_note) <= 160);
ALTER TABLE "Friendship" ADD CONSTRAINT friendship_users_distinct
  CHECK ("userAId" <> "userBId");
CREATE INDEX idx_friendship_expires_pending
  ON "Friendship" (expires_at) WHERE status = 'pending';
CREATE INDEX idx_friendship_resolved_decay
  ON "Friendship" (resolved_at) WHERE status IN ('declined','expired');
```

Notes:

- Use the actual table name (`"Friendship"`, capitalized — verify against `src/server/db/schema.ts:670` for the exact `pgTable('Friendship', ...)` name).
- `status` is `text`, not an enum, so adding `'declined'` and `'expired'` as accepted values requires no schema change — just app-level discipline. B-Friends-2 introduces those values.
- The `friendship_users_distinct` CHECK guards against `userAId = userBId`; if `friendshipPair()` at `src/server/friends/friendships.ts:28-29` has always normalized, this should never have happened in practice, but the CHECK is cheap insurance.
- Personal note is nullable for backward compat: existing pending rows (created via `createOrReusePendingFriendshipRequest()`) have no note. The 160-char limit is enforced at the DB layer for new writes.
- `expires_at` is nullable. New pending rows created via B-Friends-2's POST endpoint will set it to `NOW() + 30 days`. Existing pending rows have NULL, which the expiration cron should treat as "never expires" until they're updated or manually set.

Update `src/server/db/schema.ts` to add `personalNote`, `expiresAt`, `resolvedAt` to the friendships pgTable definition.

Add idempotent guards in `src/instrumentation.ts` matching the existing pattern (column-exists check before adding, constraint-exists check before adding).

**No `friend_requests` table is added.** The original spec proposed one; the audit found it duplicated existing functionality. See "B-Friends-2" readiness section at the bottom of this document for the full rationale.

#### 2. Phone hashing

**Env:**

- Add `PHONE_HASH_SALT` to whatever env mechanism the project uses (raw `process.env` for now). Validate at boot in `src/instrumentation.ts`: `if (process.env.NODE_ENV === 'production' && !process.env.PHONE_HASH_SALT) throw new Error(...)`.
- For dev: generate once and store in `.env.local`. Document in `CLAUDE.md` under Conventions that rotating this invalidates every `contact_hashes` row.

**Helper:** `src/server/lib/phone-hashing.ts`

```ts
import { createHash } from 'crypto';

export function hashPhoneNumber(e164Phone: string): string {
  const salt = process.env.PHONE_HASH_SALT;
  if (!salt) throw new Error('PHONE_HASH_SALT not set');
  return createHash('sha256').update(salt + e164Phone).digest('hex');
}
```

(B-Friends-4 will add the E.164 normalization step and the corresponding `users.phone_hash` column with backfill. Don't pre-build that here.)

#### 3. Privacy page

File: `src/app/account/privacy/page.tsx` — replace the existing stub.

Renders three rows per spec §9.6.3.2:

1. ☐ "Match my phone contacts to other Joshing players" — bound to `users.discoverable_by_contacts`.
2. ☐ "Suggest me through mutual friends" — bound to `users.discoverable_by_mutual_friends`.
3. ✓ "Findable by exact handle or phone number" — disabled, informational only. Always checked.

Use whatever toggle component already exists in the project (search for `Toggle`, `Switch`, or check `src/components/`). If none, use a styled `<input type="checkbox">`. Match the visual treatment of other settings rows.

Server-render initial state from the user record. Toggle change → `PATCH /api/account/discoverability` (§4) → optimistic update + revert on error.

#### 4. API

File: `src/app/api/account/discoverability/route.ts`

`PATCH` — body validated with Zod: `{ contacts?: boolean, mutualFriends?: boolean }`. Auth via `getSession()`; 401 if missing.

Server logic:

1. Update the corresponding columns on the user row.
2. **If `contacts` is being set from true → false**, delete all `contact_hashes` rows for the user in the same transaction. Return new values regardless.

Return: `{ discoverableByContacts: boolean, discoverableByMutualFriends: boolean }`.

Place DB writes in `src/server/db/queries/account.ts` (extend the existing file) — not inline.

### Acceptance

- All three migrations apply cleanly on a fresh DB and an existing dev DB. `npm run db:migrate` is clean.
- `src/instrumentation.ts` guards mean a partial-state DB still boots.
- A new user row has both discoverability columns FALSE.
- `/account/privacy` (no longer a stub) renders the three rows with current state. Row 3 is checked, disabled, no behavior on tap.
- Toggling rows 1 or 2 persists and survives reload.
- Toggling `discoverable_by_contacts` ON → upload some test rows to `contact_hashes` directly → toggle OFF → verify `contact_hashes` is empty for that user (single transaction).
- Unauthenticated PATCH returns 401.
- Direct INSERT/UPDATE on `friendships` with a 161-char `personal_note` fails the `friendship_personal_note_length` CHECK constraint.
- Direct INSERT on `friendships` with `userAId = userBId` fails the `friendship_users_distinct` CHECK.
- Existing pending Friendship rows continue to work (they have NULL `personal_note`, NULL `expires_at`).
- Production boot fails fast if `PHONE_HASH_SALT` is unset.

### Out of scope

- Anything that reads the discoverability flags (B-Friends-3 / B-Friends-4).
- E.164 normalization + `users.phone_hash` column + backfill (B-Friends-4).
- Client-side hashing (B-Friends-4).
- Friend-request flow (B-Friends-2).
- Find Friends UI (B-Friends-3).

---

## B-Friends-2 (re-revised) — Friend request flow on the existing `friendships` table

**Goal:** Add the missing pieces of the friend-request lifecycle on top of the existing `friendships` pending-request mechanism. Specifically: a freeform `personal_note`, a 30-day expiration with cron, a 30-day re-send cooldown, an outbound pending section, an "are these two blocked?" helper, and a new modal/button for inviting Joshing users you found via search or contact matching.

**Depends on:** B-Friends-1 (the `friendships` column extensions: `personal_note`, `expires_at`, `resolved_at`). P0-A (handles) is helpful for the AddFriendButton target identification but not strictly required.

**What already exists** (verified by audit on 2026-05-23 — don't rebuild):

- `friendships.status='pending'` rows are the request representation.
- `friendshipPair(a, b)` helper at `src/server/friends/friendships.ts:28-29` does userA<userB normalization.
- `createOrReusePendingFriendshipRequest()` at `src/server/friends/friendships.ts` is called by `/api/friend-invitations` for existing-user invitees — extend it to accept `personalNote`.
- ActivityItem writes for `'friend_request'` and `'friend_request_accepted'` already happen at `src/server/friends/friendships.ts:83-156`.
- `POST /api/friend-requests/:id/:action` endpoint exists and is consumed by `FriendsList.tsx:90-95` for accept/decline (the "decline" action is currently called `'ignore'` — keep that naming for backward compat, but treat it as the decline path).
- `getFriendsHub()` at `src/server/db/queries/friends.ts:198-214` reads inbound pending requests for the Friends Hub.

### Scope

#### 1. AddFriendButton component (NEW)

File: `src/components/friends/AddFriendButton.tsx` (new).

Generic. Used here, in B-Friends-3 search results, and in B-Friends-4 contact match cards.

Props:

```ts
{
  targetUserId: string;
  targetDisplayName: string;
  relationship: 'none' | 'pending_outbound' | 'pending_inbound' | 'friends' | 'recently_sent';
}
```

Render rules per spec §9.6.4.1:

- `none` → "Add friend" (primary CTA) → opens `AddFriendRequestModal`.
- `pending_outbound` → "Pending" pill (disabled, muted).
- `pending_inbound` → inline "Accept" + "Decline" buttons hitting the existing accept/ignore endpoints.
- `friends` → "Friends" pill (disabled, with checkmark).
- `recently_sent` → "Recently sent" pill (disabled, tooltip "You sent a request to this person in the last 30 days.").

Use the existing button primitive at `src/components/ui/button.tsx`.

#### 2. AddFriendRequestModal (NEW)

File: `src/components/friends/AddFriendRequestModal.tsx` (new).

Modal per spec §9.6.4.1. Personal note textarea, 160-char limit (Zod + client counter visible once ≥120 chars). On submit → new `POST /api/friend-requests` endpoint (§3 below). Optimistic close + flip parent button to `pending_outbound`. Toast "Sent." on success.

Modal pattern: no reusable `<Modal>` exists. Copy the fixed-backdrop + centered-dialog pattern from `src/components/QuickAddQuestionModal.tsx` (the project's de facto modal reference). Don't reuse `AddFriendInvite.tsx`'s expanding-panel pattern — that one is intentionally inline.

#### 3. API endpoints

**NEW: `POST /api/friend-requests`** — body `{ recipientUserId: string, personalNote?: string }` (Zod-validate per `src/app/api/account/reminders/route.ts:12-26` pattern).

Distinct from the existing `POST /api/friend-invitations` (which is for inviting people by phone with topics). This endpoint is for sending a freeform-note request to an existing Joshing user. Internally it calls (an extended) `createOrReusePendingFriendshipRequest()` at `src/server/friends/friendships.ts` — see §4 for the extension.

Server logic:

1. Verify `recipientUserId` exists and isn't the caller.
2. **Friendship check:** `getRelationship(callerId, recipientUserId)` (see §6). Branch on the result:
   - `'friends'` → 409 "Already friends."
   - `'pending_outbound'` → 409 "Request already pending." (The existing pending row's note is **not** updated — to overwrite, the user must Cancel first and re-send.)
   - `'pending_inbound'` → 409 "They've already sent you a request — go accept it."
   - `'recently_sent'` → 429 "Recently sent — try again later."
   - blocked (resolved silently inside `getRelationship`) → 404 (don't reveal).
   - `'none'` → proceed.
3. Call `createOrReusePendingFriendshipRequest({ inviterUserId: callerId, inviteeUserId: recipientUserId, personalNote, expiresAt: NOW() + 30 days, suggestedInterests: [] })`. Existing helper writes the Friendship row (status='pending', `requested_by_user_id = caller`, `formed_via = 'direct_request'`) and the `'friend_request'` ActivityItem.
4. Return 201 with the Friendship row.

**Existing: `POST /api/friend-requests/:id/accept`** (already wired). Extend the handler to:
- Set `resolved_at = NOW()` on the Friendship row alongside the existing `status='accepted'`, `formed_at=NOW()`.
- Other behavior (Friendship transition, `'friend_request_accepted'` ActivityItem for requester) is unchanged — already correct.

**Existing: `POST /api/friend-requests/:id/ignore`** (already wired; FriendsList.tsx:90-95 uses `action='ignore'`). Extend the handler to:
- Set `status='declined'`, `resolved_at=NOW()` (today it likely just removes / soft-removes the row; check the current implementation and update accordingly).
- Continue to write no ActivityItem (decline is silent per spec §9.6.4.2).

**NEW: `DELETE /api/friend-requests/:id`** — requester only. Hard-deletes the row. The unique `(userA, userB)` plus normalization means re-sending immediately is allowed (no cooldown for self-cancellation). No ActivityItem.

#### 4. `createOrReusePendingFriendshipRequest` extension

Open `src/server/friends/friendships.ts` and extend the existing function:

- Accept a new optional `personalNote?: string` argument. Persist to `friendships.personal_note`.
- Accept a new optional `expiresAt?: Date` argument. Persist to `friendships.expires_at`. If omitted (e.g. when called from the existing `/api/friend-invitations` path for topic-seeded invites), leave NULL — those don't expire under v12 (existing behavior preserved).
- "Reuse" behavior stays the same: if a pending row already exists in the pair, return it (don't create a duplicate). This is what currently powers idempotency of the existing `/api/friend-invitations` flow.

#### 5. Inbound + outbound rendering in the Invitations tab

After P0-C, `FriendsList.tsx`'s tab is labeled "Invitations." The audit at `src/components/FriendsList.tsx:236-291` shows the inbound rendering already exists — it shows requester name + suggested-interest pills + Accept/Not-now buttons. Extend it to:

- Render `personal_note` (if present) in italic-quoted block beneath the existing suggested-interest pills. If both are present, both render. If neither, neither block renders.
- Add an "Outbound (Sent)" section beneath inbound, populated from a new query helper.

**Query helpers** — extend `src/server/db/queries/friends.ts` (the file that already houses `getFriendsHub`):

- Add `listOutboundPending(userId)` → returns Friendship rows where `requestedByUserId = userId AND status = 'pending'`, joined to the *other* user for display. Order by `createdAt DESC`.
- Update `getFriendsHub` (or its consumers in `/api/friends/route.ts`) to surface this alongside the existing `incomingRequests` field, e.g. as `outgoingRequests`.

**Outbound row UI**:

```
[Avatar]  Sarah
          sent 2 days ago                    [ Cancel ]
```

Cancel hits `DELETE /api/friend-requests/:id`. Optimistic remove. No toast.

**Empty states:**

| Condition | Copy |
|---|---|
| Zero inbound, zero outbound | "All caught up on invitations." + link to `/friends/find` (B-Friends-3) |
| Zero pending overall AND zero friends | "No friends yet. Let's find your people." + same CTA |
| `discoverable_by_contacts = false` AND zero pending | "Turn on discoverability to find people you already know on Joshing." + link to `/account/privacy` |

#### 6. `getRelationship` helper (NEW)

File: `src/server/db/queries/friend-requests.ts` (new — small file, just this one helper and its query).

Signature: `getRelationship(viewerId: string, targetId: string): Promise<'none' | 'pending_outbound' | 'pending_inbound' | 'friends' | 'recently_sent'>`.

Single source of truth used by:
- `POST /api/friend-requests` (block both directions → returns `'none'` outwardly but the POST itself responds 404).
- B-Friends-3 search results.
- B-Friends-4 contact match results.
- AddFriendButton initial render.

Resolution order (all queries against `friendships`):

```
1. Active row (status='accepted', removed_at IS NULL)                                 → 'friends'
2. Soft-removed row (removed_at IS NOT NULL) where removed_by_user_id ∈ {viewer,target} → block: helper returns 'none' but exposes a separate `isBlocked` flag to callers that need it
3. Pending row where requested_by_user_id = viewer                                     → 'pending_outbound'
4. Pending row where requested_by_user_id = target                                     → 'pending_inbound'
5. Resolved (declined/expired) row with resolved_at > NOW() - INTERVAL '30 days'       → 'recently_sent'
6. Otherwise                                                                           → 'none'
```

Implementation note: a "block" is not a separate enum value — it's a side-channel that the POST endpoint reads to decide between 404 vs. allow. UI surfaces never need to distinguish "blocked" from "none" — both look the same to the viewer (no Add Friend affordance, or rather: the affordance renders but the POST silently fails. To prevent the UI affordance from showing for blocked users, the helper should return `'none'` AND callers that render search/match results should filter out users where `isBlocked === true` before rendering).

#### 7. Expiration + cleanup cron

File: `src/app/api/cron/expire-friend-requests/route.ts` (new). Add to `vercel.json` `crons` array at `30 6 * * *` (between existing 6:00 daily-assignments and 8:00 weekly-ceremony).

Auth: copy the pattern from `src/app/api/cron/daily-assignments/route.ts:24-29`:

```ts
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
```

Two operations in one job:

```sql
-- Expire stale pending requests
UPDATE "Friendship"
SET status = 'expired', resolved_at = NOW()
WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW();

-- Garbage-collect old declined/expired rows (after the 30-day cooldown window doubles)
DELETE FROM "Friendship"
WHERE status IN ('declined', 'expired')
  AND resolved_at IS NOT NULL
  AND resolved_at < NOW() - INTERVAL '60 days';
```

Return `{ expired: N, deleted: M }` for cron-log visibility.

### Acceptance

- New POST creates a `friendships` row with `status='pending'`, `personal_note` populated when provided, `expires_at` set to 30 days from now, `requested_by_user_id = caller`, `formed_via = 'direct_request'`.
- The recipient sees a new `friend_request` ActivityItem (the existing write path at `src/server/friends/friendships.ts:83-116` already does this).
- The Invitations tab in `FriendsList` renders the new `personal_note` in italic quoted block under any existing suggested-interest pills.
- Accept transitions the Friendship to `status='accepted'`, sets `formed_at` and `resolved_at`, writes the `'friend_request_accepted'` ActivityItem for the requester.
- Decline (action='ignore') transitions to `status='declined'`, sets `resolved_at`. No ActivityItem.
- Re-request within 30 days of decline/expiration → 429.
- Re-request from the *requester* after they self-cancelled (DELETE) is allowed immediately — no cooldown.
- Outbound section shows the user's sent requests; Cancel hard-deletes the row.
- Cron expires stale pending rows and garbage-collects declined/expired rows older than 60 days.
- A soft-removed Friendship with `removed_by_user_id = otherParty` → POST returns 404 (not 403; doesn't reveal the block).
- `personal_note > 160` chars fails both client-side (Zod + counter) and at the DB layer (`friendship_personal_note_length` CHECK from B-Friends-1).
- The existing `/api/friend-invitations` topic-seeded flow continues to work end-to-end (unchanged — only the underlying helper got an optional new arg).

### Out of scope

- Find Friends surface (B-Friends-3).
- Contact-hash matching (B-Friends-4).
- Dedicated `user_blocks` table (Phase 2; v12 piggybacks on soft-deleted Friendship).
- SMS notifications for any of this (Phase 2).

---

## B-Friends-3 (revised) — Find Friends + invite links + soft cap

**Goal:** A `/friends/find` page that lets a player find existing Joshing users (by handle/phone, by past-invitation reflection) and invite new ones (via shareable link). Plus the soft-cap nudge.

**Depends on:** P0-A (`users.handle`), P0-B (`AvatarChip`), B-Friends-1 (discoverability flags), B-Friends-2 (`AddFriendButton` + `getRelationship` helper).

**Does NOT implement contact-hash matching.** Block 2 below is a placeholder — B-Friends-4 replaces it.

### Scope

#### 1. Entry points

- "Find friends" outline button in `src/components/FriendsHubPage.tsx` header, beside the existing "Add friend" button. Links to `/friends/find`.
- At the top of `FriendsList.tsx`'s Invitations tab (post-P0-C): a card "Find friends already on Joshing or invite someone new →" linking to the same destination.

#### 2. Find Friends page

File: `src/app/friends/find/page.tsx` (new route). Server-rendered shell; client islands per block.

Five blocks in order:

**Block 1 — Search by handle or phone.** Client island. Text input, debounced 400ms or Enter. Calls `GET /api/friends/search?q=<query>`.

Server-side match logic (in `src/server/db/queries/friend-search.ts`, new):

- If `q` matches `/^@?[a-z0-9_]+$/`, look up by `LOWER(users.handle) = LOWER(strip_at(q))` (uses the unique-lower index added in P0-A).
- Else if `isUsPhoneNumber(q)` (imported from `@/server/auth`, already in use at `src/app/api/friend-invitations/route.ts:4-5`), normalize via `normalizePhone(q)` and look up by exact phone match. **Do not use `formatPhoneNumber` from `account.ts` — it's a display formatter, not a parser.**
- Else null.

Return `{ match: { id, handle, displayName, avatarColor, createdAt, relationship } | null }`. The `relationship` field comes from `getRelationship` (B-Friends-2 §6) — this gives the search result an `AddFriendButton` with the correct state. Blocked users → return null silently.

On match: render a card with `AvatarChip`, `@handle`, display name, "joined N days ago", and the `AddFriendButton`.
On no match: "No one by that name. They may not be on Joshing yet — you can invite them below."

**Block 2 — Contact matches (placeholder).** Disabled card per spec §9.6.3.4 with copy:

> Find friends already on Joshing
> We can check which of your phone contacts are here. We never share your contacts.
>
> [ Match my contacts ] *(disabled)*

Button tooltip: "Coming soon." B-Friends-4 replaces this entire block.

**Block 3 — Existing-invite reflection.** Query: `friend_invitations` rows where `inviter_user_id = currentUserId` AND `invitee_user_id IS NOT NULL` (they joined) AND no active Friendship exists yet between the pair AND no pending `friend_requests` row exists in either direction.

Render rows per spec §9.6.3.4 Block 3:

```
[Avatar]  Bob
          invited Apr 12 · joined yesterday
                                    [ Add friend ]
```

`AddFriendButton` uses `relationship` from `getRelationship`. If zero matches, omit the block.

API: `GET /api/friends/invite-reflections`. Query helper at `src/server/db/queries/friend-invitations.ts` (new — `src/server/friends/invitations.ts` already exists for write-side; queries get their own file).

**Block 4 — Invite someone new.** Two buttons:

- **"Send a personal invite"** — opens the existing `AddFriendInvite` modal at `src/components/AddFriendInvite.tsx`. That flow is already in production and stays exactly as it is: 3-step (identity → suggested topics → handoff), pre-seeds up to 3 interests into the new `friend_invitations` row's `preSeededInterests` jsonb column, generates an `sms:` link the inviter taps to hand off via *their* phone's messaging app (this is **not** server-driven SMS — it's user-initiated, so the Phase 1 SMS-send deferral does not apply). Also offers "Copy message" for non-SMS sharing.
- **"Copy invite link"** — copies the user's `/invite/<handle>/<token>` URL via `navigator.clipboard.writeText()`. Toast "Link copied." If the user has no `invite_token` yet, hit `GET /api/account/invite-token` first (generates lazily). This is the lightweight version *without* topic pre-seeding — for cases where you want to share your handle link without designing the recipient's first questions.

The two buttons are intentionally side-by-side: the personal invite is the rich path (topics + identity); the handle link is the casual path (just an entry point).

**Block 5 — Suggested via mutual friends (placeholder).** Render muted "Coming soon — suggestions from people you have friends in common with." Hide the entire block if the user has `discoverable_by_mutual_friends = false` (they're opted out of both ends of the mechanism).

#### 3. Invite link mechanics

**Migration** (numbered alongside B-Friends-3 work — `drizzle/0046_user_invite_token.sql` if it lands next):

```sql
ALTER TABLE users ADD COLUMN invite_token TEXT;
CREATE UNIQUE INDEX idx_users_invite_token ON users (invite_token) WHERE invite_token IS NOT NULL;
```

Drizzle: `inviteToken: text('invite_token')` on users. Instrumentation guard.

**Token generation:** `randomBytes(16).toString('base64url')` — same primitive used at `src/server/friends/invitations.ts:166` for `friend_invitations.token`. 22-char URL-safe string.

**API:**

- `GET /api/account/invite-token` — returns `{ token, url }`. Generates and persists if NULL. URL format: `https://joshing.app/invite/<handle>/<token>` — read base URL from `process.env.NEXT_PUBLIC_APP_URL` (or whatever the project already uses; grep for the existing convention before introducing a new env var).
- `POST /api/account/invite-token/rotate` — replaces, returns `{ token, url }`. Old link 404s.

**Token rotation UI in `/account/privacy`:** Extending the page from B-Friends-1, add a section below the discoverability rows:

```
Your invite link
[ https://joshing.app/invite/@handle/<token>     ] (readonly)
[ Copy ]    [ Rotate link ]
Rotating invalidates the old link. Use this if you accidentally shared it broadly.
```

**Link handler route:** `src/app/invite/[handle]/[token]/page.tsx` (new).

Note: `src/app/invite/[token]/page.tsx` already exists and resolves *friend_invitation* tokens (the per-invitation flow used by `AddFriendInvite`). The new `/invite/[handle]/[token]` route is distinct: it resolves the *user's personal* `users.invite_token`. Both must coexist — different mechanisms. Add a comment at the top of the new route's source documenting why.

Server-side resolution:

1. Look up user by `LOWER(handle) = LOWER(:handle)` (case-insensitive handle lookup; case-sensitive token).
2. If not found OR `invite_token != token`: render 404 page "This invite link is no longer valid."
3. If visitor not logged in: redirect to onboarding flow, carrying `inviterUserId` in a session cookie (use the existing session-cookie pattern at `src/server/auth/session.ts`). After onboarding completes, create a Friendship row (`formed_via = 'invitation'`, `requested_by_user_id = <inviter>`, `status = 'accepted'`, `formed_at = NOW()`, normalized userA<userB) between the new user and the inviter, then redirect to home.
4. If visitor is logged in as the inviter themselves: redirect to `/friends`.
5. If visitor is logged in as someone else: render a Send-Friend-Request screen pre-filled with the inviter as recipient (uses `AddFriendRequestModal` from B-Friends-2 inline).

#### 4. Soft cap nudge

When the user's friend count > 25, render a dismissible row at the top of `FriendsList`'s Friends tab:

```
Joshing works best with a small group — you're at 28.
No rule, just a nudge.                                ×
```

Dismiss state is session-local (in-memory React state or `sessionStorage`). **No DB column.** Comes back next session if count still > 25.

Count source: existing query in `FriendsList.tsx` — it already loads friends. Reuse, don't add a separate count API.

### Acceptance

- "Find Friends" button visible in the Friends Hub header.
- `/friends/find` renders five blocks in order; Block 2 disabled, Block 5 hidden when user opted out of mutual-friend discovery.
- Block 1 search returns exact matches only — no partial-match leakage. Handle matches case-insensitively; phone matches after normalization.
- Block 3 shows previously-invited users who have since joined, with correct `relationship` state via `AddFriendButton`.
- Block 4 "Send a personal invite" opens the existing `AddFriendInvite` modal (3-step topic-seeding flow) — flow is unchanged from current production. Block 4 "Copy invite link" copies the user's `/invite/<handle>/<token>` URL.
- `/invite/<handle>/<token>` while logged-out → onboarding with inviter carried through; post-onboarding new user has a Friendship (`formed_via='invitation'`) with the inviter.
- `/invite/<handle>/<token>` while logged-in as someone else → friend-request compose pre-filled.
- `/invite/<handle>/<token>` while logged-in as the inviter → redirect to `/friends`.
- Rotating the invite token 404s the old URL.
- Soft cap nudge appears at >25 friends; dismissible per session, returns next session.

### Out of scope

- Contact-hash matching (B-Friends-4).
- Mutual-friend suggestions algorithm (Phase 2).
- Reflection notifications and Friends-tab dot (B-Friends-4).
- Server-driven SMS delivery for invitations (Phase 2). Note: the existing user-initiated SMS handoff via `sms:` links in `AddFriendInvite` is not affected — it stays.

---

## B-Friends-4 (revised) — Contact hash matching + reflection signals

**Goal:** Wire up the contact-matching channel. Client-side picker + E.164 normalization + SHA-256 hashing. Server-side upload, storage, match query. Plus the passive reflection signals (Friends-tab dot, Invitations-tab passive row).

**Depends on:** B-Friends-1 (`contact_hashes` table, `PHONE_HASH_SALT`, `hashPhoneNumber` helper), B-Friends-2 (`AddFriendButton` + `getRelationship`), B-Friends-3 (Find Friends page with Block 2 placeholder).

### Scope

#### 1. Add libphonenumber-js

New dependency. `npm install libphonenumber-js` (~150KB gzipped; acceptable). Track bundle-size impact via the existing build pipeline.

File: `src/lib/phone-e164.ts` (new).

```ts
import { parsePhoneNumber } from 'libphonenumber-js';

export function normalizeToE164(raw: string, defaultCountry: 'US' = 'US'): string | null {
  try {
    const parsed = parsePhoneNumber(raw, defaultCountry);
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}
```

Default country `'US'`. Country-aware normalization is a known fast-follow (tracked).

#### 2. `users.phone_hash` column + backfill

**Migration** (next available number at the time):

```sql
ALTER TABLE users ADD COLUMN phone_hash TEXT;
CREATE INDEX idx_users_phone_hash ON users (phone_hash);
```

Drizzle: `phoneHash: text('phone_hash')`. Instrumentation guard.

**Backfill script:** `scripts/backfill-phone-hashes.ts`. For every user with non-null `phoneNumber`:

1. `normalizeToE164(user.phoneNumber)` — if null, log + skip (manual review).
2. `hashPhoneNumber(e164)` — uses `src/server/lib/phone-hashing.ts` from B-Friends-1.
3. Write to `users.phone_hash`. Idempotent — skip rows already hashed.

Run with `npx tsx scripts/backfill-phone-hashes.ts`.

**Signup site:** `src/app/api/auth/verify-otp/route.ts:49-53` (the `provisionUserForPhone` insert). Compute `phone_hash` alongside the insert. Find the existing phone-change endpoint (grep `src/app/api/account/` for phone update) and update it the same way.

#### 3. Hash salt fetch endpoint

File: `src/app/api/account/phone-hash-salt/route.ts` (new). `GET` — authenticated, returns `{ salt: process.env.PHONE_HASH_SALT }`. 500 if unset (it must be set in production — B-Friends-1 already enforces this at boot).

Security note: the salt is not a true secret — it lives on every authenticated client. Its purpose is rainbow-table defense, not insider-attack defense. Acceptable per spec §9.6.3.6.

#### 4. Client-side contact ingestion

File: `src/components/friends/ContactMatchBlock.tsx` (new). Replaces the disabled Block 2 placeholder in `src/app/friends/find/page.tsx`.

**Browser support check:**

```ts
const supportsContactsAPI =
  typeof navigator !== 'undefined' &&
  'contacts' in navigator &&
  typeof (navigator as any).contacts?.select === 'function';
```

**Path A — Contacts API supported (Chrome on Android, etc).** On user gesture (initial opt-in toggle OR "Refresh ↻" button):

1. `await navigator.contacts.select(['tel'], { multiple: true })`.
2. For each contact, extract phone numbers, normalize each via `normalizeToE164`.
3. Fetch salt: `GET /api/account/phone-hash-salt`.
4. Hash each E.164 number client-side using Web Crypto:

   ```ts
   async function hashPhoneClient(salt: string, e164: string): Promise<string> {
     const data = new TextEncoder().encode(salt + e164);
     const buf = await crypto.subtle.digest('SHA-256', data);
     return Array.from(new Uint8Array(buf))
       .map(b => b.toString(16).padStart(2, '0'))
       .join('');
   }
   ```

   **This MUST produce identical output to the server's `hashPhoneNumber()`.** Add a parity unit test that imports both implementations and asserts equality on a known input.
5. POST hashes to `/api/contact-hashes`.
6. Reload Block 2 with the match list from `/api/contact-hashes/matches`.

**Path B — Contacts API unsupported (iOS Safari and most desktop browsers):** Render fallback:

```
Your browser doesn't support automatic contact matching.
You can still:
  → Search by handle or phone (above)
  → Send a friend an invite link
```

Tracked: long-term solutions (native iOS app, or manual phone-paste UI).

#### 5. Hash upload endpoint

File: `src/app/api/contact-hashes/route.ts` (new).

`POST` — Zod-validate `{ hashes: string[] }` (each a 64-char hex string). Max 5000 hashes; 413 above this. Replaces all existing hashes for the user atomically in a Drizzle transaction:

```ts
await db.transaction(async (tx) => {
  await tx.delete(contactHashes).where(eq(contactHashes.userId, userId));
  if (hashes.length > 0) {
    await tx.insert(contactHashes).values(hashes.map((phoneHash) => ({ userId, phoneHash })));
  }
});
```

Returns `{ uploaded: number, matchCount: number }` where `matchCount` is a preview count of matches against other users who have `discoverable_by_contacts = true`.

`DELETE` — clears all rows for current user. Idempotent.

Query helpers at `src/server/db/queries/contact-hashes.ts` (new).

#### 6. Match query

File: `src/app/api/contact-hashes/matches/route.ts` (new). `GET` — returns users matching the caller's uploaded hashes.

Drizzle query (or raw SQL in the queries module):

```sql
SELECT u.id, u.handle, u.display_name, u.avatar_color, u.created_at
FROM contact_hashes ch
JOIN users u ON u.phone_hash = ch.phone_hash AND u.id != $1
WHERE ch.user_id = $1
  AND u.discoverable_by_contacts = TRUE
ORDER BY u.created_at DESC;
```

Then for each row, compute `relationship` via `getRelationship` (B-Friends-2 §6). The helper's anti-harassment logic naturally excludes blocked users.

Return `{ matches: Array<{ ...userFields, relationship }> }`.

#### 7. Match results UI in Block 2

Replaces the placeholder. Per spec §9.6.3.4:

```
CONTACTS ON JOSHING                      Refresh ↻
[AvatarChip]  Sarah
              joined 3 days ago         [ Add friend ]
[AvatarChip]  Robyn
              joined 2 weeks ago        [ Pending ]
[AvatarChip]  James M.
              joined 1 month ago        [ Friends ]
```

Each row uses `AddFriendButton` with `relationship` from §6. "Refresh ↻" re-runs the picker → hash → upload → reload flow.

#### 8. Weekly debounce

On page-load of `/friends/find`, if `discoverable_by_contacts = TRUE`:

- Server-side: query `MAX(uploaded_at) FROM contact_hashes WHERE user_id = $1`.
- If null OR `> 7 days ago`: render a "Refresh contact matches?" prompt at the top of Block 2 with a button that runs the upload flow.
- Else: skip silently.

The Contacts API requires a user gesture, so truly silent re-upload is impossible. The prompt is the gentlest possible reminder.

#### 9. Reflection signals

A new match is "new" when: a user has joined whose `phone_hash` matches a `contact_hashes` row of an existing user, AND the joining user has `discoverable_by_contacts = TRUE`, AND the existing user hasn't visited Find Friends since the joiner joined.

**Schema:**

```sql
ALTER TABLE users ADD COLUMN last_friend_discovery_check_at TIMESTAMPTZ;
```

(Numbered alongside other B-Friends-4 migrations.)

**Compute helper:** `getNewDiscoveryStatus(userId)` at `src/server/db/queries/contact-hashes.ts`. Returns `{ hasNew: boolean, count: number }`. Counts:

- Contact-hash matches where the matched user's `created_at > users.last_friend_discovery_check_at` AND no active Friendship and no pending request yet.
- Plus invite-reflection: users this player invited (via `friend_invitations`) who joined after the same threshold (this overlaps with B-Friends-3 Block 3 but is fine — both signals are valid).

**API:** `GET /api/friends/has-new-discovery` — returns `{ hasNew, count }`. Cache-Control: `max-age=60`.

**Update threshold:** When the user visits `/friends/find`, set `last_friend_discovery_check_at = NOW()` server-side.

**Don't write ActivityItems for this.** Discovery is a passive signal, distinct from the bell (which is news-about-you per the existing bell semantics in `src/server/db/queries/activity.ts`).

#### 10. Friends-tab dot

In `src/components/Nav.tsx`: when `hasNew = true`, render a small dot on the Friends tab icon.

- Binary (visible/hidden), no count.
- Distinct from the existing bell badge. Use a muted neutral color — the codebase's `INK3` token from `src/components/lately/tokens.ts:1-7` if it's the right shade; otherwise pick a token that's clearly distinguishable from the bell-badge accent.
- Add a new prop `friendsDotVisible: boolean` on Nav, plumbed from wherever the parent layout already computes `bellBadgeCount` (the existing `bellBadgeCount` prop entered Nav via `src/components/Nav.tsx:32,36,79-81` — same pattern).

#### 11. Passive row in the Invitations tab

When `hasNew = true` on initial load of FriendsList's Invitations tab (post-P0-C), render at the top:

```
✨  3 new contacts are on Joshing.
    → Find friends
```

Count from §9. Tapping navigates to `/friends/find`, which updates the threshold and so removes both the dot and this row on next render.

### Acceptance

- A new user with `discoverable_by_contacts = TRUE` becomes visible via contact matching to other users whose hashes include their phone hash.
- A user with `discoverable_by_contacts = FALSE` is NOT surfaced even if hashes match.
- Client-side and server-side hashing produce identical output for the same E.164 input + salt — verified by a unit test that imports both implementations.
- Toggling `discoverable_by_contacts` OFF deletes the user's `contact_hashes` rows (this is enforced by B-Friends-1; B-Friends-4 relies on it).
- Match results render with the correct `relationship` state (none / pending_outbound / pending_inbound / friends / recently_sent).
- Refresh button re-runs the picker + hash + upload flow.
- Friends-tab dot appears when there are new matches and clears on visiting `/friends/find`.
- Passive row in Invitations tab shows accurate count and clears on visit.
- iOS Safari / any browser without the Contacts API renders the fallback copy; the rest of Find Friends still works.
- Blocked users do not appear in match results (verified through `getRelationship`'s anti-harassment filter).
- libphonenumber-js bundle size stays under 200KB gzipped (track via the existing build output).

### Out of scope

- Mutual-friend suggestions (Phase 2).
- Google contacts integration (Phase 2+).
- Native iOS contact upload (Phase 3+).
- Country-aware E.164 normalization (fast-follow).
- Dedicated `user_blocks` table (Phase 2; v12 piggybacks on soft-deleted Friendship).

---

## Per-prompt readiness (audit pass — 2026-05-23)

Four `Explore` agents verified each prompt's codebase-touching assumptions. Decisions recorded inline.

### B-Friends-1 revised — GREEN

All assumptions verified. Implement using these existing patterns:

- ✅ ID helper: `gen_random_uuid()::text` via `id()` at `src/server/db/schema.ts:19`. Use for `friend_requests.id`.
- ✅ Instrumentation guards: `ADD COLUMN IF NOT EXISTS` at `src/instrumentation.ts:463`, `CREATE TABLE IF NOT EXISTS` at `src/instrumentation.ts:163-176`, `DO $$` blocks for FK constraints at `src/instrumentation.ts:178-196`.
- ✅ Zod pattern to copy: `src/app/api/account/reminders/route.ts:12-26` (object + optional fields + `.refine` + `safeParse`, 400 on fail).
- ✅ Toggle pattern (no library): inline `role="switch"` button at `src/app/account/notifications/NotificationsForm.tsx:121-136`.
- ✅ `src/server/db/queries/account.ts` exists with coherent neighbors (`getUserProfile`, `updateReminderPreferences`, `updateDisplayName`, `deleteUserAccount`). Add `updateDiscoverability` + `deleteContactHashesForUser` here.
- ✅ `getSession` canonical import: `@/server/auth/session` (93 usages, no alternatives).
- ✅ Latest migration: `drizzle/0044_user_last_activity_bell_opened_at.sql` — next is `0045`.

**Verdict: GREEN.** Implementable as written.

### P0-A handles — BLOCKED on P0-D

- ✅ User insert site: `src/app/api/auth/verify-otp/route.ts:49-53` via `provisionUserForPhone()`.
- ✅ Onboarding flow exists at `src/app/onboarding/page.tsx` + `src/app/onboarding/OnboardingFlow.tsx` — natural insertion point for the handle picker.
- ✅ ID/secret primitive: `gen_random_uuid()::text` for IDs; `randomBytes(N).toString('hex'|'base64url')` for tokens (`src/server/auth/session.ts:102`, `src/server/friends/invitations.ts:166`). No `nanoid` dep. Use `randomBytes(2).toString('hex')` for the 4-char handle suffix.
- ✅ Top-level reserved routes (20): `account, activities, api, archive, ceremony, creator-notes, daily, dev, feed, friends, games, invite, knowledge, login, new-game, onboarding, questions, replay, share, users`.
- ✅ Rate-limit prior art: `users.reminderPromptDismissedAt` at `src/server/db/schema.ts:162` + write at `src/server/db/queries/account.ts:162`. Model `handle_last_changed_at` on this.

**Verdict: BLOCKED on P0-D.** The handle has no rendering home until `/account/profile` (currently a stub) exists. P0-D added as a new prerequisite.

### P0-B avatar_color — GREEN (kept as written)

- ❌ `clay1..clay8` tokens **don't exist** (`tailwind.config.ts:3` is empty). Palette is hex-array based.
- ✅ Existing palette: `AVATAR_COLORS` (6 hex colors) at `src/components/feed/visual.ts:12-19`. Duplicated at `src/app/account/page.tsx:29` — dedupe as part of the work.
- ✅ Existing deterministic helper: `colorForUser(userId)` at `src/components/feed/visual.ts`. Used by `AvatarDisc` at `src/components/feed/AnsweredByYouCard.tsx:53-79` and `initialsFor()` at `src/components/Nav.tsx:17-22`. **Use this exact function in the backfill script** so values match what's currently being rendered at runtime — users won't see their avatar color change.
- ✅ User insert site: `src/app/api/auth/verify-otp/route.ts:49`.

**Decision logged:** Keep the column despite existing runtime computation, so future user-customization UI has a place to write.

**Verdict: GREEN** — but with two amendments to the original P0-B body:
1. Palette is the existing 6-color `AVATAR_COLORS` hex array, not the speculated `clay1..clay8` tokens. The `avatar-palette.ts` helper file is unnecessary — re-export from `visual.ts` instead.
2. Backfill must use the existing `colorForUser()` to preserve current rendering.

### P0-C Friends Hub sub-tabs — REWRITTEN (see updated P0-C body above)

- ❌ No reusable Tabs primitive in `src/components/ui/` (only `button.tsx`).
- ❌ **`FriendsList.tsx` already implements its own three-tab UI** (Friends / Requests / Sent) at `src/components/FriendsList.tsx:120-159`. The original P0-C would have produced nested tabs.
- ✅ `FriendsHubPage.tsx` is a clean wrapper with no `useSearchParams` or props (`src/components/FriendsHubPage.tsx:14-31`).
- ✅ `Nav.tsx` Friends link is plain `/friends` (`src/components/Nav.tsx:11`).

**Decision logged:** Drop the outer Friends/Invitations layer. Rename FriendsList's existing "Requests" tab to "Invitations". B-Friends-2 lands the lifecycle into that tab.

**Verdict: REWRITTEN.** See updated P0-C body above. Original outer-tab design dropped.

### NEW: P0-D Profile page design

Placeholder added above P0-A. The current `/account/profile` is a stub (`src/app/account/profile/page.tsx`); P0-A's handle needs a rendering surface, so the profile page must come first. Detailed scope TBD — flesh out before starting P0-A.

### B-Friends-2 — GREEN (re-revised after audit; decision (a) taken)

**Decision (2026-05-23):** Path (a) selected. Drop the new `friend_requests` table; extend the existing `friendships` table with `personal_note`, `expires_at`, `resolved_at` columns plus new `'declined'`/`'expired'` status values. B-Friends-1 Migration C and B-Friends-2 have been rewritten in place to reflect this.

What B-Friends-2 now does (re-revised, see body above):

- Adds two new components: `AddFriendButton`, `AddFriendRequestModal`.
- Adds one new endpoint: `POST /api/friend-requests` (for sending a freeform-note request to an existing user).
- Extends the existing `createOrReusePendingFriendshipRequest()` helper at `src/server/friends/friendships.ts` to accept `personalNote` and `expiresAt` args.
- Extends the existing accept/ignore endpoints to set `resolved_at`.
- Adds `DELETE /api/friend-requests/:id` for self-cancellation.
- Adds a new outbound-pending section to the FriendsList Invitations tab.
- Adds the `getRelationship` helper at `src/server/db/queries/friend-requests.ts`.
- Adds the expire-friend-requests cron (also garbage-collects declined/expired older than 60 days).

What was preserved unchanged:

- The existing FriendsList inbound rendering (just extended to show `personal_note` if present).
- The existing `/api/friend-requests/:id/:action` endpoint shape.
- The existing `/api/friend-invitations` topic-seeded flow (`AddFriendInvite.tsx` path).
- All existing ActivityItem writes for friend events.

**Verdict: GREEN.** Implementation-ready.

### B-Friends-3 — YELLOW (two small corrections)

Independent audit on 2026-05-23:

- ✅ `AddFriendInvite.tsx` 3-step flow verified at `src/components/AddFriendInvite.tsx:301-527`. Block 4 "Send a personal invite" reuses this modal — confirmed correct after the user's catch.
- ✅ Existing write endpoint: `POST /api/friend-invitations` at `src/app/api/friend-invitations/route.ts:148-285`. Validates `inviteeDisplayName`, `phone`, `suggestedInterests` (≤3, ≤60 chars each). For existing users it goes straight to `createOrReusePendingFriendshipRequest()` (an existing helper that creates a pending Friendship — reinforces the B-Friends-2 finding above).
- ⚠️ **`formatPhoneNumber` is display-only** (`src/server/db/queries/account.ts:19-29`). For Block 1 phone search parsing, use `isUsPhoneNumber()` + `normalizePhone()` from `@/server/auth` (already imported by `friend-invitations/route.ts:4-5`). **Update inline below.**
- ⚠️ **`/invite/[token]/page.tsx` already exists** (`src/app/invite/[token]/page.tsx:24-119`) and resolves the *invitation* token (`friend_invitations.token`), redirecting to `/login?invitationToken={token}`. The new `/invite/[handle]/[token]` route in B-Friends-3 is a **distinct mechanism** — resolves the *user's personal* token (`users.invite_token`). Both routes must coexist. Naming clash isn't an issue (different path shape) but the rationale should be documented in the new route's source.
- ✅ `NEXT_PUBLIC_APP_URL` env var pattern verified at `src/app/api/friend-invitations/route.ts:158-172` (also `?? APP_URL ?? VERCEL_PROJECT_PRODUCTION_URL ?? request-derived`). Use this fallback chain for the new invite URL builder.
- ✅ Soft cap source: `friends.length` from `src/components/FriendsList.tsx:40,170`. No new query needed.
- ✅ Onboarding handoff pattern for inviter carry-through has prior art: `acceptFriendInvitation()` at `src/server/friends/invitations.ts:456-540` creates the inviter-invitee Friendship with `formed_via='invitation'` via `upsertInvitationFriendship()`. Reuse this helper for the new route's post-onboarding step.

**Verdict: YELLOW.** Fix the two ⚠️ items inline (done — see below), then it's GREEN.

### B-Friends-4 — YELLOW (one decision needed)

Independent audit on 2026-05-23:

- ✅ Web Crypto + Node Crypto SHA-256 parity is implementable. No prior art in the codebase (`TextEncoder` is used at `src/server/auth/session.ts:92,101` for JWT but not for hashing interop), so a parity unit test is mandatory.
- ❌ **No phone-change API endpoint exists** under `src/app/api/account/`. The B-Friends-4 prompt assumed one. **Decision needed:** either build a phone-change endpoint as part of B-Friends-4 (broader scope), or document that phone is immutable after signup (current de facto behavior) and recompute `phone_hash` only at signup. Recommend the latter for Phase 1.
- ✅ Signup insert shape: `src/app/api/auth/verify-otp/route.ts:49-53` accepts a `.values({ phoneNumber })` block. Plug `phoneHash` into the same object.
- ✅ Nav badge plumbing: `bellBadgeCount` enters Nav at `src/components/Nav.tsx:32,36`; it's computed in the root layout at `src/app/layout.tsx:46-62` via a server-side query. Add a parallel `getNewDiscoveryStatus()` call there and pipe `friendsDotVisible` as a sibling prop.
- ✅ `INK3 = '#8a8a9a'` exists at `src/components/lately/tokens.ts:3`. Bell badge uses `var(--accent)` at `src/components/Nav.tsx:106` — visually distinct.
- ✅ `libphonenumber-js` confirmed not in `package.json`. The `/min` variant is the right import for our use case (US-only).
- ✅ No service worker / PWA manifest exists. Browser fallback path is the only iOS solution for Phase 1.

**Verdict: YELLOW.** Resolve the phone-change decision (recommend: defer, current model treats phone as immutable post-signup), then it's GREEN.
