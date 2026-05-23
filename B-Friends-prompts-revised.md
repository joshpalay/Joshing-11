# B-Friends prompts — revised against actual schema

**Source of intent:** `joshing-prd-v12-friends-discovery.md` v12 §9.6.3 + §9.6.4.

**Why revised:** The original build prompts (drafted against an idealized schema) assumed `users.handle`, `users.avatar_color`, a multi-tab Friends Hub, a normalized `users.phone`, and migrations under `src/server/db/migrations/`. None of those hold. This document replaces the original B-Friends-1 and adds three prerequisite prompts (P0-A, P0-B, P0-C) that must merge first.

**Order:** P0-A → P0-B → P0-C → B-Friends-1 (revised). B-Friends-2 / -3 / -4 still need their own revision pass once these have shipped.

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

## P0-C — Friends Hub sub-tabs

**Goal:** Restructure the flat `FriendsHubPage` into a tabbed surface so B-Friends-2 / -3 / -4 have a place to live.

### Scope

#### Layout

File: `src/components/FriendsHubPage.tsx` (modify existing).

Add a sub-tab strip below the header. Two tabs in Phase 1:

- **Friends** — the current flat content (`AddFriendInvite` + `FriendsList`), unchanged.
- **Invitations** — empty placeholder in this prompt. Renders `<InvitationsTabPlaceholder />` which says *"Friend requests will appear here."*

Tab state via URL query param `?tab=friends|invitations`, default `friends`. Use Next.js search params, not local state — so the Friends tab dot (B-Friends-4 §10) can deep-link to Invitations.

Don't introduce a tabs library. Match whatever tabbed UI already exists in the project (look in `src/components/` and `src/app/account/` for prior art before building from scratch). If nothing exists, build a small inline tabs component using existing CSS conventions.

#### Header restructure

Move the existing "Add friend" button into the tab strip's right side so it persists across both tabs. The "Find Friends" button required by B-Friends-3 §1 will join it later.

#### Tab content components

- `src/components/friends/FriendsTabContent.tsx` — wraps the current `AddFriendInvite` + `FriendsList` rendering.
- `src/components/friends/InvitationsTabContent.tsx` — placeholder with the "Friend requests will appear here" copy.

These two are what later prompts (B-Friends-2 §7, B-Friends-3 §1) will extend.

### Acceptance

- `/friends` defaults to the Friends sub-tab; `/friends?tab=invitations` lands on Invitations.
- Switching tabs updates the URL.
- The Friends tab content is functionally unchanged from today.
- The Invitations tab renders the placeholder copy.
- The bottom Nav Friends tab still links to `/friends` without a tab param.

### Out of scope

- Real Invitations content (B-Friends-2 §4 onward).
- Find Friends button / route (B-Friends-3).
- Overview, Active Now, Shared Interests sub-tabs (later passes).

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

**Migration C — `friend_requests` table:**

```sql
CREATE TABLE friend_requests (
  id            TEXT PRIMARY KEY,
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','expired')),
  personal_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  CHECK (char_length(personal_note) <= 160),
  CHECK (requester_id != recipient_id),
  UNIQUE (requester_id, recipient_id)
);
CREATE INDEX idx_friend_requests_recipient_pending
  ON friend_requests (recipient_id) WHERE status = 'pending';
CREATE INDEX idx_friend_requests_expires_pending
  ON friend_requests (expires_at) WHERE status = 'pending';
```

ID generation: match the existing convention (read `src/server/db/schema.ts` and use the same helper that `friendships.id` uses). Don't introduce `gen_random_uuid()` if the project uses application-generated IDs.

Update `src/server/db/schema.ts` for all three.

Add idempotent guards in `src/instrumentation.ts` matching the existing pattern (column-exists check before adding, table-exists before creating).

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
- Direct INSERT into `friend_requests` with a 161-char `personal_note` fails the CHECK constraint.
- Direct INSERT with `requester_id = recipient_id` fails.
- Production boot fails fast if `PHONE_HASH_SALT` is unset.

### Out of scope

- Anything that reads the discoverability flags (B-Friends-3 / B-Friends-4).
- E.164 normalization + `users.phone_hash` column + backfill (B-Friends-4).
- Client-side hashing (B-Friends-4).
- Friend-request flow (B-Friends-2).
- Find Friends UI (B-Friends-3).

---

## Still TODO

B-Friends-2, B-Friends-3, B-Friends-4 from the original document still need a revision pass against the actual schema before they can be run. Notable issues to address in that pass:

- **`formedVia` value** — original prompt uses `'in_app_request'`; existing code uses `'direct_request'`. Pick one and stick to it.
- **Friendships column count** — actual is 11, not 10 (cosmetic).
- **FriendInvitations column count** — actual is 12, not 10 (cosmetic).
- **Migration paths** — `drizzle/`, not `src/server/db/migrations/`.
- **Cron location** — `src/app/api/cron/` + `vercel.json`, not `src/server/jobs/`.
- **`users.phone_hash` + E.164 backfill** — needs `libphonenumber-js` as a new dependency; the existing `users.phoneNumber` column is not pre-normalized.
- **No env validation file** — direct `process.env` is the current pattern.
