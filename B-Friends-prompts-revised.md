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
