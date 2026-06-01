# D-2 — Niche-Match Discovery Engine (SPEC)

> **Spec-only deliverable.** No production code is written by this prompt. This document is the
> spec + confirmed decisions that unblock the eventual build. The implementation is a separate,
> future piece of work. Independent of D-1, but inherits D-1's follow-directionality keystone.

---

## Context — why this change

Joshing's authoring mechanic (Capabilities 21–22) promises an **organic discovery** payoff: when a
stranger answers a question I authored, I should be able to go see and follow them — and symmetrically,
when I correctly answer a stranger's authored question, they may connect with me. This is "finding your
people through shared niche territory," the reason authoring is worthwhile even when no friend shares
the niche (the **atonal-stranger** story: the one other person who knows your obscure corner).

Today the loop is not wired. The author-side notification *half* exists but points at the wrong
audience, the answerer-side half is missing entirely, and existing "discovery" is phone/contact-based —
not niche-via-answering. This spec defines the notify-and-connect loop and its privacy gating against
the **current, post-D-1** codebase (directional follow model).

This is a **slow-burn delight**, not a volume mechanic. Hyper-specificity ⇒ few matches by design. The
spec deliberately keeps it out of badge/counter surfaces so the UI never implies it should be frequent.

---

## Verified facts (corrections to the gap analysis in **bold**)

| # | Claim | Status | Evidence |
|---|-------|--------|----------|
| 1 | `friend_answered_your_question` activity exists and writes to the bell/activities | TRUE | `ActivityItemType` union + `HOME_TOP3_ELIGIBLE_TYPES` in `src/server/activity/write-activity.ts`; hydrated by `hydrateFriendAnsweredQuestions` in `src/server/db/queries/activity.ts`. |
| 2 | The "then go connect" loop is not wired from that notification | **PARTIALLY TRUE** | The notify **render** already links the actor's name → `/users/{id}` → `ProfileFriendButton` → `AddFriendButton` (`src/components/home/NewsRow.tsx`, `src/app/activities/page.tsx`). The path exists; what's missing is that the *right people* are notified (see #3) and the symmetric answerer-side notify (see #4). |
| 3 | `friend_answered_your_question` notifies the question author | **FALSE** | It is written **only to prior correct answerers** by `notifyPreviousAnswerers()` (`src/server/feed/create-feed-items-for-answer.ts:170`). The author (`question.creatorId`) is fetched for feed-eligibility but **never notified**. It is also **deduped away when `result==='correct'`** by `filterUtilityActivities` (`src/app/activities/filter-utility-activities.ts`), because the Lately `they_got_you` moment covers it for friends. |
| 4 | There is a notification telling the answerer they correctly answered an authored question | **FALSE** | No such activity type or write-point exists in any of the five answer routes. |
| 5 | Existing discovery infra is niche-match-via-answering | **FALSE** | `/api/friends/has-new-discovery`, `getNewDiscoveryStatus`, `/api/account/discoverability`, `/friends/find` are all **contact-hash / phone-based** (`src/server/db/queries/contact-hashes.ts`). The niche engine is unbuilt. |
| 6 | Follow directionality is unresolved (shared keystone with D-1) | **RESOLVED BY D-1** | `drizzle/0058_follow_model.sql`: directional `Follow` edges (`followerId→followeeId`), `state` `pending|approved`; `users.followPrivacy` (`public` auto-approves, `approval_required` default). `getRelationship(viewer,target)` in `src/server/db/queries/friend-requests.ts` returns `none|pending_outbound|pending_inbound|following|follows_you|friends`. |
| — | `ActivityItem.type` storage | **Free-text column**, not a pgEnum — gated only by the `isActivityType()` allowlist in `activity.ts`. Adding a type needs **no DB enum migration**. |
| — | Discoverability flags | `users.discoverableByContacts` / `discoverableByMutualFriends` are `boolean NOT NULL DEFAULT false` additive columns with idempotent `ADD COLUMN IF NOT EXISTS` guards in `src/instrumentation.ts`. |
| — | Niche data already present | `playerMastery.territoryType` (`declared|demonstrated`), `declaredInterests`, and interest-overlap via `normalizeInterestKey` in `src/server/profile/friend.ts`. No user-to-user niche-match query exists. |

---

## Decision ledger (all confirmed by product)

| Q | Decision | Notes |
|---|----------|-------|
| **1. Who is "someone"?** | **Strangers only** — fire only between **non-mutual** users. | Skip when `getRelationship(answerer, author)` is `friends`, `following`, `follows_you`, or any `pending_*`. Friends already see each other via `friend_answered_your_question` + Lately; firing for them is noise. |
| **2. Privacy gate** | **New opt-in flag `discoverableByNicheMatch`, default OFF.** | Alongside the existing two flags. Identity is exposed in the loop only if the exposed party opted in. |
| **3. Gate timing** | **At write time**, not render time. | Mirrors `updateDiscoverability`'s consent-revocation philosophy: no identity-exposing rows persist after opt-out. |
| **4. Gate direction** | **Asymmetric** — the *to-be-exposed* party's flag gates the *other* party's notification. | Author-side ("stranger X answered your question") gated by **X's (answerer's)** flag. Answerer-side ("you answered Y's question") gated by **Y's (author's)** flag. Easy to wire backwards — state it explicitly. |
| **5. Notify → connect path** | **Reuse the bell/activity system.** No new discovery surface. | Actor name already links `/users/{id}` → `ProfileFriendButton` → `AddFriendButton`. |
| **6. Follow directionality** | **Inherit D-1 verbatim.** | Following from a niche match is a normal follow: auto-approved if target is `public`, else a pending request. `removeFriendship` (unfollow) semantics unchanged. |
| **7. Surfaces that fire** | feed / daily / catchup / questions answer routes. **Joshing-games EXCLUDED.** | Joshing-games are an *invited* context, not organic discovery — "X answered your question" inside a game the author deliberately sent would be confusing. |
| **8. Cadence / scale** | **Slow-burn delight, no volume cues.** | Type **excluded** from `HOME_TOP3_ELIGIBLE_TYPES` and the bell badge; appears only in the full `/activities` list. No counters, no "matches this week," no empty-state nagging. |

---

## The notify-and-connect loop (design)

**Two net-new activity writes.** The existing `friend_answered_your_question` is **not reused** — its
semantics target prior answerers, not the author, and it carries a "couldn't get it / got it" framing.
D-2 adds:

- **Author-side:** written to `question.creatorId` — *"a stranger answered your authored question."*
- **Answerer-side:** written to the answerer — *"you correctly answered a stranger's authored question."*

**Single write-point.** Add a `notifyNicheMatch()` step inside `createFeedItemsForFriendsFromAnswer`
(`src/server/feed/create-feed-items-for-answer.ts`), invoked from the same `after()` background context
the four organic surfaces already funnel through (feed / daily / catchup / questions). One integration
point covers all organic surfaces and keeps the work off the request path. **Joshing-games does not call
this step.**

**Fire conditions (all must hold):**
1. `result === 'correct'` (a `live_correct` / `catchup_correct` mastery event was produced).
2. The question is **authored** with a real `creatorId`, and `creatorId !== answererId`.
3. `getRelationship(answererId, creatorId)` returns a **stranger** state (not `friends` / `following` /
   `follows_you` / `pending_*`). Runs in background context — a single indexed two-row lookup on `follows`.
4. The exposed party's `discoverableByNicheMatch` is ON (per-direction; see gate table above).

**Rendering.** Add render branches in `NewsRow.tsx` and `activities/page.tsx` mirroring the
`friend_answered_your_question` template; reuse `referenceType: 'question'` + `referenceId: questionId`.
Copy should foreground the **shared niche** (the question's domain) — that's the discovery hook —
e.g. *"Someone out there answered your {domain} question"* / *"You found someone in {domain}."*

**Dedup safety.** The new type is unaffected by `filterUtilityActivities` (which drops only three
friend-scoped types) and Lately moments are friend-scoped, so stranger niche-match items survive the
filter. **Do not** add the new type to the dedup set in a future change.

---

## Privacy gating (detail)

- New column **`discoverable_by_niche_match boolean NOT NULL DEFAULT false`** on `User`.
- Extend `DiscoverabilityState` / patch type / `getDiscoverability` / `updateDiscoverability`
  (`src/server/db/queries/account.ts`). **No purge side-effect needed** — niche-match stores no uploaded
  data to revoke (unlike the contacts flag, which purges `ContactHash`). Zod on the PATCH input.
- Add a third toggle to `PrivacyForm.tsx`: *"Let people I've never met discover me through questions we
  both answer."* Default off.
- The asymmetric two-flag check is stated explicitly in §"Gate direction" above so it isn't wired
  backwards: each notification is gated by the flag of the party whose identity it would expose.

---

## Eventual build — Done When (drafted, sequenced)

**WS1 — Schema + privacy plumbing.**
Migration `0059_*` adds `discoverable_by_niche_match` (additive boolean w/ default — the safe case per
`CLAUDE.md`); idempotent `ADD COLUMN IF NOT EXISTS` guard in `src/instrumentation.ts` following the
existing discoverability-flag guard pattern; account queries + `PrivacyForm.tsx` extended.
*Done when:* the flag round-trips through `PATCH /api/account/discoverability`, defaults off for existing
users, and the migration replays cleanly on a partially-recorded DB.

**WS2 — Activity type + hydration + render.**
Add the new type(s) to the `ActivityItemType` union and the `isActivityType` allowlist (free-text
column, **no pg-enum migration**); add a **parallel** `hydrateNicheMatch*` (do not share
`hydrateFriendAnsweredQuestions`, which hardcodes its own type filter) and a field on
`ActivityItemView.reference`; add render branches to `NewsRow.tsx` and `activities/page.tsx`; keep the
type **out of** `HOME_TOP3_ELIGIBLE_TYPES`.
*Done when:* a seeded niche-match row renders in `/activities` with the author/answerer name linking to
their profile, and does **not** increment the bell badge.

**WS3 — Write-point + gates.**
`notifyNicheMatch()` in `createFeedItemsForFriendsFromAnswer`, guarded by the §"Fire conditions"; both
author-side and answerer-side writes; joshing-games excluded.
*Done when:* a correct stranger-answer to an authored question, **both parties opted in**, produces
**exactly two** activity rows; **zero** rows when either party has the flag off, when the pair are
already in any follow relationship, or when the question is self-authored.

**WS4 — Tests + dedup confirmation.**
Unit tests for the stranger gate and the asymmetric flag gate; confirm no Lately collision; exercise
`npm run smoke:daily-catchup` (catchup has **two** `after()` call sites that must both route through the
new logic).
*Done when:* tests cover both gate axes (relationship + each flag direction) and the catchup double-site
path is verified.

---

## Critical files (for the future build, not edited by this spec)

- `src/server/feed/create-feed-items-for-answer.ts` — write-point + the missing author-notify.
- `src/server/activity/write-activity.ts` — new type + `HOME_TOP3_ELIGIBLE_TYPES` exclusion.
- `src/server/db/queries/activity.ts` — `isActivityType` allowlist, hydration, `ActivityItemView`.
- `src/server/db/queries/account.ts`, `src/server/db/schema.ts`, `src/instrumentation.ts` — flag + guard.
- `src/server/db/queries/friend-requests.ts` — `getRelationship` stranger gate.
- `src/components/home/NewsRow.tsx`, `src/app/activities/page.tsx`,
  `src/components/profile/settings/PrivacyForm.tsx` — UI.

## Non-goals

- Not a volume mechanic; no growth counters or "new matches" pressure.
- Not a replacement for contact/phone discovery (`/friends/find` stays as-is).
- Not friend-scoped — friends already discover each other via `friend_answered_your_question` + Lately.
- No new blocking model; relationship gating reuses D-1's `getRelationship`.
