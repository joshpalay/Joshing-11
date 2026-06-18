# D-FRIEND-VISIBILITY-PRIVACY-AUDIT-01 — Discovery surfaces & consent primitives

**Date:** 2026-06-18
**Type:** Diagnostic / audit (read-only — no build, no behavior changes)
**HEAD at audit:** `2a7cd85` (Merge PR #1056)
**Companion:** `audits/2026-06-18-D-FRIEND-DISCOVERY-AUDIT-01.md` (the prior search/add audit; read its "Architecture note" for the Follow-model framing this audit assumes).

---

## TL;DR

The single most important finding: **two of the surfaces this audit was asked to scope as "proposed, not-yet-built" already exist in live code, gated on one-sided consent.**

1. **Friend attribution on feed cards is already shipped** for `direct_sent` and `authored_shared` cards. Every feed card carries `source_friend_display_name` + `source_profile_href` (`get-feed-page.ts:301-302`), rendered as a tappable `FeedPersonLink` to that friend's profile (`FeedList.tsx:296-300`). A "Via Sadie" label, as a *new* concept, is largely redundant with what renders today — **the open question is not whether to add attribution but whether to extend it to the one case that is genuinely absent: traversal.**
2. **Friends-of-friends on profiles already renders.** A profile shows the subject's friends list (`ProfileFriendsSection`, `users/[id]/page.tsx:421-428`; full list at `users/[id]/friends/page.tsx`) and a "You both know …" mutual-friends block **to strangers** (`MutualFriendsSection`, `page.tsx:316-321`). Both are gated **only on the subject's consent** — the listed friends have no say.
3. **The "traversal card" the prompt describes (you answered what a friend answered) no longer renders as a feed card.** `friend_answered` was removed from the feed in D-1 Stage 5 (`visibility.ts:20-30`). It still writes (for Daily-Five +2, Lately, and profile presence) but is not a card, so there is no traversal card to attribute today.
4. **Consent primitives are asymmetric.** Everything that exists gates on *the subject's* settings (who-can-see-me, who-can-follow-me). There is **no primitive for "I consent to being surfaced to people I haven't friended"** — no per-user "appear in others' friends lists" flag, no "OK to name me as a discovery path" flag. The closest thing, `discoverableByMutualFriends`, gates a FoF *suggestion* surface that is still a "Coming soon" placeholder.

---

## A. Privacy & consent primitives — what controls exist today

### A.1 Every privacy/visibility/discoverability column

**On `User`** (`schema.ts:202-263`):

| Column | Type / default | Set in UI | Read by |
|---|---|---|---|
| `discoverableByContacts` | `boolean`, default **false** | `PrivacyForm.tsx:163-167` ("Match my phone contacts…") → `PATCH` via `updateDiscoverability` (`account.ts:421`) | Contact-match block on `/friends/find` |
| `discoverableByMutualFriends` | `boolean`, default **false** | `PrivacyForm.tsx:171-175` ("Suggest me through mutual friends") | **Nothing live** — the "Suggested via mutual friends" surface is a `/friends/find` "Coming soon" placeholder (prior audit §B5). The flag is wired to storage but no read path consumes it for a built surface. |
| `discoverableByNicheMatch` | `boolean`, default **true** (TEST-PHASE; production default is an open decision — `schema.ts:231-235`) | `PrivacyForm.tsx:181-183` | Niche-match discovery (D-2) |
| `followPrivacy` | enum `FollowPrivacy ['public','approval_required']`, default **`approval_required`** (`schema.ts:69-70, 236-237`) | (set via account/handle flows) | Follow-request auto-approve decision (`friendships.ts:43-104`) |
| `phoneHash` / `lastFriendDiscoveryCheckAt` | contact-discovery plumbing | — | `ContactHash` matching |

The discoverability triplet is surfaced together under **"Privacy & discovery"** in the owner self-view (`users/[id]/page.tsx:248-254`, `getDiscoverability` `account.ts:372-399`).

**On `Follow`** (`schema.ts:1002-1034`):

| Column | Type / default | Meaning |
|---|---|---|
| `state` | enum `FollowState ['pending','approved']`, default `pending` (`schema.ts:68, 1008`) | A pending inbound edge *is* a follow request; approved is an active follow. Mutual approved = "friends". |

`Follow` has **no** per-edge privacy column. The PR-era prompt's guesses (`Follow.privacy`, `Follow.follow_privacy`) do not exist as separate columns; the gate lives on `User.followPrivacy`. There is **no** `discoverable`, `searchable`, `list_visible`, or `attribution_ok` column anywhere on `User` or `Follow`.

**Profile-section visibility** — the one genuinely two-or-three-level visibility primitive:

- `PROFILE_SECTION_VISIBILITY` (`schema.ts:912-929`): `(userId, section)` → `visibility ∈ {public, friends, private}`, **default `public`**. `section` is the `ProfileSection` enum: `knowledge_base | friends_list | authored_questions` (`schema.ts:196-200`).
- Set in UI by the owner via `SectionVisibilityToggle` in the self-view Privacy section (`users/[id]/page.tsx:203-227`, help copy `page.tsx:523-542`).
- Read by `getSectionVisibilities` → `canViewSection(settings, section, effectiveViewer)` (`profile/friend.ts:213-219`).
- `PROFILE_DOMAIN_VISIBILITY` (`schema.ts:931-954`) is the per-domain analogue (same public/friends/private vocabulary) for the knowledge map.

### A.2 Is there any notion of "I consent to being surfaced to non-friends / as a discovery path"?

**No, not as a first-class primitive.** Consent today is two shapes only:

1. **Who-can-follow-me** — `User.followPrivacy` (request-approval gate).
2. **Who-can-see-my-content** — `PROFILE_SECTION_VISIBILITY` / `PROFILE_DOMAIN_VISIBILITY` (public/friends/private per section).

`discoverableByContacts` / `discoverableByMutualFriends` / `discoverableByNicheMatch` are the only "surface me to people I don't know" flags, and they are **discovery-channel opt-ins**, scoped to specific suggestion engines, not a general "OK to attribute / OK to list me elsewhere" consent. None of them gate the friends-list-on-profile or mutual-friends surfaces that actually leak FoF today (see §C).

### A.3 Where is the friends-vs-public line drawn?

The line is **`PROFILE_SECTION_VISIBILITY.visibility` per section**, evaluated against an `EffectiveViewer` of `self | friend | stranger` (`profile/friend.ts:100-132`, `canViewSection`). Concretely on a profile:

- **Stranger** (non-friend viewer, or owner previewing as public): short-circuits to a teaser card (`page.tsx:283-329`) — header + mind statement + **mutual friends** + a "become friends to see more" prompt. No knowledge base, no friends list, no authored questions.
- **Friend** (mutual follow): full profile, each section gated by its `friends`/`public` setting (`page.tsx:386-441`).
- **Self / owner**: management view with the toggles.

So a friends-vs-public distinction exists and is enforced per profile section. It does **not** exist on the feed: feed cards are written per-recipient (`FeedItem.recipientUserId`) and gated by question visibility (`questionVisibilityPredicate`, `feed.ts:262-279`), not by a public/friends toggle on the *attribution*.

---

## B. Question attribution — what the feed card knows

### B.4 Traversal card ("you answered what a friend answered") — does it carry the originating friend?

**There is no traversal feed card anymore.** D-1 Stage 5 ("feed flip") removed `friend_answered` from the rendered feed:

- `visibility.ts:20-30` — *"friend_answered (type-3) is no longer rendered in the feed. It is still WRITTEN by create-feed-items-for-answer.ts … but the feed surfaces collapse to Broadcasts (authored_shared + thumbs_upped) and Sent (direct_sent)."*
- The render whitelist `ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES` (`visibility.ts:26-30`) and `visibleFeedSourcePredicate` (`visibility.ts:131-137`) deliberately **omit** `friend_answered`.
- `feedCardType()` has no `friend_answered` arm; any non-direct/non-thumbs row falls back to the `friend_added` envelope (`get-feed-page.ts:113-118`).

Where the traversal *signal* still surfaces, and whether it carries identity:

- **Daily-Five +2 bonus slot** and **profile "Recently exploring"/presence** read `friend_answered` rows (`visibility.ts:22-25`; presence via `friend-presence-domains.ts`). These carry the friend's identity (`friend-presence-domains.ts:251` `friendDisplayName`).
- **Lately milestones** aggregate `friend_answered` and name the friend (`lately.ts:111,146,200,253,344,382` `friendDisplayName`).
- **The post-answer result card** (`answered_by_you`) can render a "You and {friend} share this knowledge" line via `comparisonCopy()` (`FeedList.tsx:240-272`), driven by `friend_results` (friend identities) **or** the card's `source_friend_display_name`/`source_user_id` fallback. **Caveat:** `friend_results` is *not* emitted by the server feed payload (`get-feed-page.ts` never sets it; the field is populated only on the client after an answer-submit `result`), so in the feed the comparison falls back to the `friendIsAuthor` branch for `direct_sent`/`authored_shared` only.

**Bottom line for §4:** the path is *not* discarded at the data layer — `FeedItem.sourceUserId` always records who triggered the row (`schema.ts:1071`) — but the pure-traversal card no longer renders, so there is currently nothing to attribute on the feed for traversal specifically.

### B.5 Directed question — is the sender attributed, and is the card distinct?

**Yes, attributed; yes, structurally distinct.**

- The directed card is `card_type: 'direct_sent'` → its own component `DirectSentCard.tsx` (`feed/types.ts:19-23` `DirectSentFeedItem` with `senderName` + `senderHref`; mapped at `FeedList.tsx:336-343`).
- It is **pinned and leads every surface** (`feed.ts:199-212`, `is_pinned`), is exempt from the question-visibility gate (`feedItemVisibilityPredicate`, `feed.ts:297-305`), and exempt from already-answered suppression (`feed.ts:226-240`) — none of which is true for broadcasts. So `direct_sent` is the most structurally distinct card type in the system.
- Attribution copy: `directSentAttribution()` → "{name} sent you a question — {domain}" (`get-feed-page.ts:95-97`), verb keyed on provenance ("wrote you this" for human-authored, "sent you this" for curated/LLM — `FeedList.tsx:280-290`, B-5/B-6).

So traversal and directed cards do **not** collapse into one "For You" render — directed is its own pinned card; traversal is no longer a card at all. The two were deliberately separated (PRODUCT-CANON §"Feed / For You zones", `PRODUCT-CANON.md:165-167`: *"Direct sends and broadcasts are not the same as 'a friend answered something.' Designers should keep those jobs distinct."*).

### B.6 If "Via Sadie" were added — whose feed, and where does Sadie's name land in front of a non-friend?

The privacy boundary depends on which card type:

- **`direct_sent`**: Sadie's name appears on **Josh's** feed, and Josh **must** be Sadie's friend — the send route enforces mutual friendship (`questions/send/route.ts:36-39`, `getFriends` membership check). **No FoF exposure**: viewer is always already a friend.
- **`authored_shared` (broadcast / "Share with all friends")**: fans out to Sadie's **followers** (`create-feed-items-for-answer.ts:104`). A follower is someone with an approved edge *toward* Sadie but **not necessarily a mutual** — so Sadie's name can already land in front of a one-directional follower she has not friended back. This is the existing, shipped exposure; it is gated by `followPrivacy` (Sadie chose to accept that follower) but not by any attribution-specific consent.
- **Traversal (`friend_answered`, if it were re-surfaced as a card)**: this is the load-bearing case. A traversed question reaches Josh because *Sadie answered it*, and the question then becomes a +2/feed opportunity. If the card named Sadie, **Sadie's name would land in front of every recipient of the traversal — who need not be Sadie's friend at all** (traversal fan-out follows the question/topic, not the friend graph). This is precisely the cold-FoF exposure Josh ruled out, re-introduced under a warm label. **This is the only "Via Sadie" case that creates new non-friend exposure** — and it is the one the prompt names as the tension to hold.

---

## C. Friends-of-friends / friends-list visibility

### C.7 Does the profile render the subject's friends list, and to whom?

**Yes — to friends, gated only on the subject's `friends_list` visibility (default public).**

- Dashboard module `ProfileFriendsSection` (`users/[id]/page.tsx:421-428`): renders when `!isSelf && portrait.sectionVisibleTo.friends_list`. The subject's friends are fetched via `getFriends(portrait.user.id)` (`page.tsx:133`), capped at `FRIENDS_PREVIEW_LIMIT = 5` (`page.tsx:46`).
- Full list page `users/[id]/friends/page.tsx`: same gate (`page.tsx:31-32` — strangers 404, hidden list 404s), then lists **all** of the subject's friends with links to each (`friends/page.tsx:34-37, 66-80`).
- Because strangers short-circuit before `ProfileFriendsSection` (`page.tsx:283-329`), the friends list is shown to **friend-viewers**, not the public — but the gate is the *subject's* setting, which **defaults to `public`** (`schema.ts:918`), i.e. "anyone with the profile link" once they are a friend-viewer.

### C.8 What two-sided consent would FoF need, and does any primitive support it?

A clean two-sided model needs: **(a)** subject allows their list shown (✅ exists: `PROFILE_SECTION_VISIBILITY.friends_list`) **AND (b)** each listed friend consents to appearing in someone else's friends list (❌ absent).

Today only (a) exists. `getFriends` = `getMutualFollows` (`friends.ts:144-146`) returns **every** mutual follow with **no per-friend consent filter** — the listed friends' own `PROFILE_SECTION_VISIBILITY` / discoverability settings are never consulted. So a user who has locked down their *own* profile is still enumerated (name + profile link) on every friend's friends list. **Primitive (b) does not exist and would have to be built.**

### C.9 Does any current surface already leak FoF information?

**Yes — two, both live, both one-sided:**

1. **Mutual-friends block, shown to strangers** (`MutualFriendsSection`, `page.tsx:316-321`; component `MutualFriendsSection.tsx`). For any non-owner viewer, `getFriendPortraitData` computes `mutualFriends` = intersection of the viewer's friends and the subject's friends (`profile/friend.ts:190-207`) and renders **"You both know {names}"** to strangers (`MutualFriendsSection.tsx:35-38`). It is gated on **neither** the subject's `friends_list` setting **nor** the named mutuals' consent. Mitigation in practice: the names shown are people the viewer *already* knows (they are the viewer's own friends), so it reveals overlap, not strangers — but it still names third parties to a non-friend and confirms "X is friends with this subject."
2. **Friends list on profile** (§C.7) — the full FoF enumeration, one-sided.

The **"Suggested via mutual friends"** engine on `/friends/find` is still a **"Coming soon" placeholder** with no engine wired (prior audit §B5, §"Exists but partial"); its consent flag `discoverableByMutualFriends` exists and is toggleable (`PrivacyForm.tsx:171-175`) but reads nowhere live.

---

## D. Directed-question privacy posture (baseline)

When Sadie sends a question directly to Josh (`questions/send/route.ts`):

- **Friendship enforced** — Sadie can only send to a mutual friend (`route.ts:36-39`).
- **What is recorded:**
  - A `FeedItem`: `sourceType='direct_sent'`, `sourceUserId=Sadie`, `recipientUserId=Josh`, `isPinned=true`, optional `personalMessage` (≤200 chars), `sourceEventAt` (`route.ts:132-141`, schema `schema.ts:1063-1094`).
  - An `ActivityItem`: `type='received_direct_question'`, `userId=Josh`, `actorUserId=Sadie`, `referenceId=feedItem` (`route.ts:143-149`).
  - An SMS to Josh ("{Sadie} sent you a question") if he hasn't opted out (`route.ts:154-163`).
  - Rate-limit bookkeeping (5/recipient/24h, `route.ts:115-130`).
- **Third-party visibility: none.** Both records are owned by Josh (`FeedItem.recipientUserId`, `ActivityItem.userId`); the activity read path filters by `userId = viewer` (`schema.ts:1166-1185`, `write-activity.ts:21-26`). No row makes the send visible to anyone but Josh. There is no "Sadie sent a question to Josh" signal exposed to Sadie's or Josh's other friends. So the directed act is currently a strictly two-party, private fact — attribution-to-third-parties would be a new exposure, not a widening of an existing one.

---

## Three-bucket summary

### ✅ Exists & works (live)
- **Per-section profile visibility** (`PROFILE_SECTION_VISIBILITY`, public/friends/private) for `knowledge_base | friends_list | authored_questions`, owner-set, viewer-evaluated.
- **Follow-request gate** (`User.followPrivacy`, default `approval_required`).
- **Sender attribution on `direct_sent`** — name + tappable profile link, pinned distinct card.
- **Source attribution on `authored_shared`** — name + link ("{name} shared a question").
- **Friends list on profile** (preview + full page), gated on subject's `friends_list` setting.
- **Mutual-friends "You both know …" block** shown to strangers.
- **Directed-send privacy**: friendship-enforced, two-party, no third-party leak.
- Discovery-channel opt-ins for **contacts** and **niche match** (live read paths).

### ⚠️ Exists but partial / one-sided / placeholder
- **All FoF visibility is one-sided** — subject consents; listed/mutual friends do not. `getFriends`/`getMutualFollows` apply no per-friend consent filter.
- **Mutual-friends block** ignores even the subject's `friends_list` setting (shows to strangers regardless).
- **`discoverableByMutualFriends`** flag is storable + toggleable but reads to **no live surface** ("Suggested via mutual friends" is "Coming soon").
- **Traversal signal** still written and surfaced in Daily +2 / Lately / presence with friend identity, but **not as a feed card**.
- **`friend_results` attribution** on the result card is client-only (not in the feed payload), so feed-side traversal naming is effectively absent.

### ❌ Absent (would need building)
- Any **per-user "I consent to being surfaced to non-friends"** primitive — no "appear in others' friends lists" flag, no "OK to be named as a discovery path / attribution" flag on `User` or `Follow`.
- **Two-sided consent** for friends-of-friends (primitive (b) in §C.8).
- **A traversal feed card** to attribute at all (removed in D-1 Stage 5).
- **"Via Sadie → friend/answer Sadie" affordance** — no path from an attribution name to friending the originator beyond the generic profile-link → follow button that already exists for direct/broadcast names.
- Any **FoF suggestion engine** behind the `discoverableByMutualFriends` flag.

---

## Open decisions (framed, not resolved — pending Josh's review)

1. **Traversal attribution.** Traversal has no card today (D-1 Stage 5). Re-surfacing it *and* naming it is the only "Via Sadie" variant that creates new non-friend exposure (§B.6). Decide: (a) leave traversal cardless; (b) re-surface anonymized ("a friend you both follow"); or (c) re-surface named — and if named, **whose** name: the originator Sadie (whom the viewer may not know — cold FoF) vs. only a mutual the viewer already shares. Gated on **which** consent: a new "OK to attribute me on traversal" flag, or reuse of `followPrivacy`/section visibility?

2. **Directed-card attribution.** Already attributed and structurally distinct (§B.5) — for the *recipient*, who is always a friend, so this is clean and arguably already done. The only open part is whether the directed *act* should ever be visible to **third parties** (currently strictly two-party, §D); that would be a new exposure requiring new consent.

3. **Name the FoF tension plainly.** A consented "Via Sadie → friend Sadie" path **is** friend-of-friend discovery in warm clothing. Josh previously ruled out cold "people you may know." Decide explicitly whether warm, consented, attribution-originated FoF is in-bounds where cold FoF is not — and whether `discoverableByMutualFriends` is the consent it should ride on.

4. **Profiles showing friends-of-friends.** This already ships one-sided (§C.7, §C.9). The decision is not "build it" but **"retrofit two-sided consent onto a live surface"**: add primitive (b) (each listed friend opts in/out of appearing) and decide whether the stranger-facing mutual-friends block should be gated (today it ignores even the subject's setting). Until then, every locked-down user is still enumerated on their friends' profiles.

5. **Consent primitives to build vs. reuse.** *Reuse:* `PROFILE_SECTION_VISIBILITY.friends_list` (subject-side list consent), `followPrivacy`. *Build:* a per-user "list/attribution exposure" consent (the missing symmetric half), a read-path filter in `getFriends`/`getMutualFollows` that honors it, and (if mutual-friends-to-strangers is to be gated) a consent check in `getFriendPortraitData`'s mutual computation. The `discoverableByMutualFriends` flag exists and could be the hook for an attribution/FoF consent rather than minting a new column.

*Per the prompt: no build sequence and no B-prompt — findings and decision-framing only, pending Josh's review.*
