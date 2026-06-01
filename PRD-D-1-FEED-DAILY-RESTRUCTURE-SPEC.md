# D-1 — Feed & Daily Restructure (SPEC)

> **Spec-only deliverable.** No production code is written by this prompt. This document is the
> spec + confirmed decisions that unblock the eventual build. The implementation is a separate,
> future piece of work.

---

## Context — why this change

Today a single `FeedItem` table (`sourceType` is a free `text()` column, not a pgEnum)
mixes three signals and forces them to share one surface with one job:

- **Type 1 — `authored_shared`**: a broadcast, "Share with all friends" (active write path, PR #254; renders as the `friend_added` "Handwritten" envelope).
- **Type 2 — `direct_sent`**: a question sent specifically to me.
- **Type 3 — `friend_answered`**: a friend answered an LLM question correctly (`sourceResult='correct'`, gated).
- (Legacy 4th: `thumbs_upped`, read-only, no longer written — keep rendering old rows.)

The target splits this into **three surfaces with three jobs**:

1. **The Feed** = deliberate human intent only → type 1 (broadcasts) + type 2 (sent-to-me). Type 3 leaves entirely.
2. **Daily Five +2** = the *playable* home for the type-3 signal → up to 2 accessible, friend-answered questions appended to the daily ritual, with **answerer** attribution, graceful-shrinking to 5.
3. **"What friends are into" (presence)** = the *observational* home for the type-3 signal → awareness of what friends are exploring, on friend profiles. **NOT** `/activities` Lately (Lately is a notification/correctness-moment digest; jamming presence in would blur its role).

The type-3 signal forks: playable → +2, awareness → presence. The feed keeps neither. The cheap
removal (visibility query change) and the expensive destinations are **one piece of work** — type-3
must not be stripped before it has a home.

---

## Verified facts (corrections to the gap analysis in **bold**)

| # | Claim | Status | Evidence |
|---|-------|--------|----------|
| 1 | One FeedItem table, three sourceTypes | TRUE | `sourceType` is **`text()` not a pgEnum** (`schema.ts:776`); names `'authored_shared'`/`'direct_sent'`/`'friend_answered'` in `visibility.ts:5-21`. **`authored_shared` is an ACTIVE write path** (PR #254), not legacy. `thumbs_upped` is the legacy read-only 4th value. |
| 2 | Type-3 removal is a query/visibility change | TRUE | `visibility.ts:70-90` (`isVisibleFriendAnsweredSource`, `visibleFeedSourcePredicate`), `queries/feed.ts:267-269` (`from-friends` includes `friend_answered`), `get-feed-page.ts:111` (`feedCardType` fallback). |
| 3 | Broadcast visibility gated by mutual `status='active'` friendship, not directional follow | TRUE | `getFriends` (`friends.ts:64-82`) filters `status='active'` + symmetric `or(userAId,userBId)`; `friendships` is one row per pair (`schema.ts:736`). |
| 4 | `questionVisibilityEnum` has `friends`/`private` but they're never writable | TRUE | enum `('private','public','friends')` (`schema.ts:38`); write hardcodes `'public'` (`questions.ts:419`); **read only at feed-CREATION eligibility** `visibility.ts:64`, **never at render**. |
| 5 | `direct_sent` isolable via `filter=sent-to-me`; type-3 pollutes `all`/`from-friends` | TRUE | `FeedFilter = 'all'|'sent-to-me'|'from-friends'` (`FeedList.tsx:90`); predicate `feed.ts:267-269`. |
| 6 | `getFriendsHub` uses declared interests only; no demonstrated overlap; **no UI consumes it** | **PARTIALLY TRUE** | declared-only is correct (`friends.ts:186-193`), and no demonstrated-territory overlap exists anywhere — **but `sharedInterests` IS consumed** by `FriendsList.tsx:270` and `SharedInterestsOverlap.tsx`. |
| — | Daily queue size | `DAILY_QUEUE_SIZE = 5` fixed (`daily/types.ts:85`), no bonus tier. |
| — | Queue attribution | `QueueSlot` carries **author** (`author_id`/`author_name`/`author_note`, `types.ts:27-31`), no answerer. `source` enum is `['friend','bot','community']` (`types.ts:16`). `difficulty_estimate` already on the slot (`types.ts:39`). |
| — | Accessibility filter | `pickEligibleAuthoredQuestions` filters status/visibility/domain only — **no difficulty filter** (`daily.ts:815-822`). Three nullable difficulty enums exist: `difficultyEstimate`, `llmDifficulty`, `calibratedDifficulty` (`'accessible'|'moderate'|'specialist'`). |
| — | Existing shrink | `queue-orchestrator.ts:169-240` is a **generation-failure backstop** (single bounded top-up, then persist N<5 rather than 503). Distinct from friend-slot shrink — do not conflate. |
| — | Lately | `/activities` (`LatelyFeed.tsx`, `queries/lately.ts`) = notification digest + bidirectional correctness "moments". Not a presence feed. |

---

## Decision ledger (all confirmed by product)

| Q | Decision | Notes |
|---|----------|-------|
| **1. Follow directionality (keystone)** | **Replace** symmetric friendship with **directional follow** | New directional edge becomes the primitive; "friend" = mutual follow where reciprocity is needed. Requires data migration. |
| **2. Broadcast visibility enum** | **Make `friends` (followers-only) writable now** | Add write path + render-time read. |
| **3. "Sent to you" treatment** | **Dedicated tab in Feed** | Promote `sent-to-me` from in-list filter to a first-class tab. |
| **4. Answerer-attribution data path** | **Derive at queue-build from `friend_answered` feed items + extend `QueueSlot`** | Add answerer fields; no new table. |
| **5. Definition of "accessible"** | **`calibratedDifficulty=='accessible'`, fall back to `llmDifficulty=='accessible'`** when calibrated is null. |
| **6. Focus-area relevance ranking** | **Reuse `getKnowledgeBase` domains** | exact `canonicalSubcategory` match → near (`broadCategory`) → any friend-answered. |
| **7. Graceful shrink** | **5 base + 0/1/2 friend slots; never LLM-backfill friend slots** | Total 5–7. Distinct from the orchestrator's N<5 backstop. |
| **8. Presence home** | **Friend profile addition** (`/users/[id]`) | "Recently exploring" section; NOT Lately. |
| **9. Presence vs overlap** | **Activity-based only, distinct** | Recent domains from `masteryEvents` recency. Do NOT build demonstrated-territory overlap now. |
| **10. Build order** | **All at once** (single coordinated change) | One PR; see "safe internal sequencing" below to avoid an orphaned-signal window. |
| **1a. Follow vs friend** | **Replace** (see Q1) | |
| **4a. +2 eligibility set** | **People I follow** | I opted into their signal by following. |

---

## The spec

### A. Follow model — replace symmetric friendship with directional follow

This is the keystone and the largest piece. A directional follow edge becomes the visibility
primitive; mutual reciprocity ("friend") is derived as *both follow each other*.

- **Schema.** Introduce a directional `follows` relation (`followerId → followeeId`, `createdAt`,
  optional `state`). Decision deferred to build time: new `follows` table vs. reshaping `friendships`
  into directional rows. **Recommended: new `follows` table**, leaving `friendships` in place during
  migration, then deprecating the symmetric reads.
- **Migration.** Each `friendships` row with `status='active'` (A,B) expands to **two** follow edges
  (A→B and B→A). Pending requests map to a single pending/one-way follow. Follow under the new model
  is **unilateral, no approval** (one-directional consent per the doc) — the friend-request
  accept/decline flow is replaced by follow/unfollow. This is a notable UX change; call it out in the PR.
  Write the migration following the `new-migration` convention and add the idempotent boot guard in
  `src/instrumentation.ts` (read it first — this touches relations and a backfill).
- **Derived "friend" / mutual.** Add a `getMutualFollows(userId)` (both directions present) to back
  reciprocal features. Rewrite `getFriends` → `getFollowing` (who I follow) or `getMutualFollows`
  per call-site semantics:
  - Broadcast fan-out (`authored_shared`) and `friend_answered` fan-out → **my followers** (people who follow me see my activity).
  - Lately correctness-moments, `reveal_inside_joke` gating, declared shared-interests → **mutual follows**.
  - Daily +2 eligibility → **people I follow** (Q4a).
- **Call sites to migrate** (audit `getFriends` usages): `app/api/questions/route.ts:243` (broadcast
  fan-out), `create-feed-items-for-answer.ts:70-86` (friend_answered fan-out), `queries/lately.ts`,
  `getFriendsHub` (`friends.ts:159-294`), `profile/friend.ts`, inside-joke gating.

### B. Broadcast visibility enum — make followers-only live

- Make `questionVisibilityEnum` writable. Under the follow model, `'friends'` now reads as
  **followers-only**; `'public'` = anyone. (`'private'` stays author-only.)
- **Write:** add a visibility control to the question composer; persist via `createQuestion`
  (`questions.ts:419`) instead of the hardcoded `'public'`.
- **Read at render:** today visibility is only read at feed-*creation* eligibility (`visibility.ts:64`).
  Add a **render-time** visibility check so a followers-only broadcast only renders for the author's
  followers — extend `visibleFeedSourcePredicate` / `get-feed-page.ts` to join question visibility and
  the viewer's follow relation.

### C. The Feed — type-1 + type-2 only, with a Sent tab

- **Remove type-3** from feed reads: drop `friend_answered` from the `from-friends` predicate
  (`feed.ts:268-269`), from `visibleFeedSourcePredicate`/`isVisibleFriendAnsweredSource`
  (`visibility.ts:70-90`), and from the `feedCardType` fallback (`get-feed-page.ts:111`). Keep
  `authored_shared`, `direct_sent`, and legacy `thumbs_upped`.
- **Sent-to-you tab.** Promote `sent-to-me` from an in-list filter (`FeedList.tsx:90`) to a
  first-class tab/segment with its own count, reusing the existing `feedFilterPredicate` plumbing
  (`feed.ts:267`).
- **Keep writing type-3.** `friend_answered` feed items must **keep being written** by
  `create-feed-items-for-answer.ts`; they are now the **source signal** for the +2 (§D) and presence
  (§E). Only their *feed rendering* is removed.

### D. Daily Five +2 — playable type-3 destination

- **Variable queue size.** Keep `DAILY_QUEUE_SIZE = 5` as the **core** size; add
  `DAILY_BONUS_SLOT_MAX = 2` → total 5–7. The play/complete flow already reads the actual slot count
  (`isRoundComplete`/progress are slot-driven), so a 5–7 queue renders and completes correctly.
- **Answerer attribution (data path).** At queue-build time, query `friend_answered` `feedItems`
  where `recipientUserId = me`, `sourceResult='correct'`, `sourceUserId ∈ {people I follow}`, join the
  canonical question. Build bonus slots and **extend `QueueSlot`** with `answerer_id` / `answerer_name`
  alongside the existing `author_*`. UI renders "Robyn answered this correctly."
- **Accessibility filter (new).** A question qualifies for a bonus slot only if
  `calibratedDifficulty === 'accessible'`, falling back to `llmDifficulty === 'accessible'` when
  calibrated is null. This filter does not exist today — add it to the bonus-slot picker (sibling to
  `pickEligibleAuthoredQuestions`, `daily.ts:815-822`).
- **Relevance ranking.** Rank eligible friend-answered questions by: (1) exact `canonicalSubcategory`
  match to my `getKnowledgeBase` domains, (2) near = `broadCategory` match, (3) any remaining
  friend-answered. Reuse the merged declared+demonstrated domain set from `getKnowledgeBase`
  (`daily.ts:197-244`). Take top 2.
- **Graceful shrink (distinct).** If 0/1/2 qualify, append exactly that many — never backfill friend
  slots with LLM or authored content. This is **separate** from the orchestrator's N<5 generation
  backstop (`queue-orchestrator.ts:169-240`); do not route bonus shortfall through it.

### E. Presence — "What friends are into" on friend profiles

- **Home:** a "Recently exploring" section on `/users/[id]` (`app/users/[id]/page.tsx`,
  `server/profile/friend.ts`), below the knowledge map. **NOT** Lately.
- **Content:** activity-based — recent domains this friend has been answering in, derived from
  `masteryEvents` recency (the same signal `getFriendsHub` uses for `lastActiveAt`, but surfaced as
  *which* domains, recently). Distinct from the historical mastery/points map and from declared
  `sharedInterests`.
- **Out of scope (Q9):** do **not** build demonstrated-territory overlap between viewer and friend.
  Existing declared `SharedInterestsOverlap` stays unchanged.

---

## Build order — "all at once," with safe internal sequencing

Product chose a single coordinated change (one PR). To avoid an orphaned type-3 window *within* that
PR, land commits in this internal order, but ship them together:

1. **Destinations first (no user-visible removal yet):**
   - `QueueSlot` answerer fields + bonus-slot picker (accessibility + relevance + shrink) + variable queue size.
   - Presence section on friend profiles.
2. **Follow model migration:** `follows` table + migration + boot guard; rewrite `getFriends`
   call-sites to `getFollowing`/`getMutualFollows`/my-followers per call semantics.
3. **Visibility enum live:** composer write path + render-time followers-only read.
4. **Feed flip (last):** remove `friend_answered` from feed reads; promote Sent to a tab. By now both
   destinations exist, so the signal never loses its home.

> The big-bang approach raises review/rollback risk. Keep `friend_answered` **writes** intact
> throughout; only step 4 removes its feed *rendering*.

---

## Done-When checklist for the eventual build (staged)

**Stage 1 — Daily +2 (playable destination)**
- [ ] `QueueSlot` extended with `answerer_id`/`answerer_name`; Zod schema stays the source of truth.
- [ ] Bonus-slot picker queries `friend_answered` correct items from people I follow, joins canonical question.
- [ ] Accessibility filter: `calibratedDifficulty='accessible'` → fallback `llmDifficulty='accessible'`.
- [ ] Relevance ranking via `getKnowledgeBase` (subcategory exact → broadCategory near → any); top 2.
- [ ] Variable size: core 5 + 0–2 bonus; shrink appends only what qualifies, no backfill.
- [ ] UI renders answerer attribution and the "accessible" badge; complete/progress correct at 5–7.

**Stage 2 — Presence (awareness destination)**
- [ ] "Recently exploring" section on `/users/[id]` from `masteryEvents` recency (domains, recent).
- [ ] Distinct from knowledge map and declared `sharedInterests`; no demonstrated-overlap computation.

**Stage 3 — Follow model**
- [ ] `follows` table + migration (each active friendship → two edges) + idempotent boot guard in `instrumentation.ts`.
- [ ] `getFollowing` / `getMutualFollows` / followers helpers; all `getFriends` call-sites migrated with correct semantics.
- [ ] Friend-request UX replaced by follow/unfollow (unilateral, no approval) — flagged in PR.

**Stage 4 — Visibility enum**
- [ ] Composer visibility control writes `public`/`friends`(=followers-only)/`private`.
- [ ] Render-time followers-only check joins question visibility + viewer follow relation.

**Stage 5 — Feed flip**
- [ ] `friend_answered` removed from the `from-friends` predicate, `visibleFeedSourcePredicate`, and `feedCardType` fallback — but still **written**.
- [ ] Sent-to-you promoted to a first-class tab with count; broadcasts + sent are the only feed surfaces.

**Cross-cutting**
- [ ] Zod on every new/changed API input. DB access stays in `src/server/db/queries/`.
- [ ] No `src/middleware.ts` (use `src/proxy.ts`); run `check-middleware`.
- [ ] Sonnet/Haiku model split unchanged.

---

## Verification (for the eventual build)

- **Typecheck:** `npx tsc -p tsconfig.typecheck.json`.
- **Lint/format:** `npm run lint`, `npm run format`.
- **Migration:** `npm run db:migrate` on a fresh DB and on a friendships-populated DB; confirm the
  follow backfill is idempotent (re-run boot guard) and the friendship→follow expansion is correct.
- **Daily smoke:** `npm run smoke:daily-catchup`; manually verify a 5-, 6-, and 7-slot day, answerer
  attribution, the accessibility filter, and that shrink never backfills friend slots.
- **Feed:** verify type-3 no longer renders in `all`/`from-friends`; the Sent tab shows only
  `direct_sent`; a followers-only broadcast renders for followers and not for non-followers.
- **Presence:** the friend profile shows recent domains; presence is not added to Lately.

---

## Explicitly out of scope (this prompt)

- No production code. This spec is the only artifact.
- No demonstrated-territory overlap surface (Q9).
- No presence in Lately (Q8) — reaffirm the role-blur warning if anyone proposes it.
