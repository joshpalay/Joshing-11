# D-VIA-ATTRIBUTION-FEASIBILITY-01 — Per-question answerer attribution: what the data affords

**Date:** 2026-06-18
**Type:** Diagnostic / audit (read-only — no build, no behavior changes)
**HEAD at audit:** `1b7e3ca` (Merge PR #1057)
**Companion:** `audits/2026-06-18-D-FRIEND-VISIBILITY-PRIVACY-AUDIT-01.md` (established that `friend_answered` is written but no longer a feed card; `FeedItem.sourceUserId` always records the triggering friend).

---

## The one fact that frames everything

`friend_answered` rows are **written** but **not loaded by the feed render query**. `visibleFeedSourcePredicate` (`src/server/feed/visibility.ts:131`) admits only `authored_shared`, `direct_sent`, `thumbs_upped` — `friend_answered` is deliberately absent (Stage 5, `visibility.ts:20-30`). So the feed page (`get-feed-page.ts`) never sees a single answerer row. The "Via" set is **not** a column already in hand that the render layer is discarding — it is a separate body of rows the feed query does not touch.

That single fact decides the verdict (below): the data **exists and is affordable**, but the lead/expand set is **not reachable from the current render path** without a new query.

---

## A. The set — can we get all friend-answerers of a question, per viewer?

**A1 — Cost to retrieve the complete set.** Affordable, but it is a **separate query**, not a join on the existing one. The existing render query (`feed.ts:338-354`, `fetchVisibleFeedItems`) selects `feedItems` joined only to `questions`, filtered to the three visible source types — `friend_answered` rows are filtered out before they reach the page. The complete answerer set for a question Q and viewer V is:

```
feedItems WHERE recipientUserId = V
              AND questionId = Q
              AND sourceType = 'friend_answered'
              AND sourceResult = 'correct'
   ⨝ follows (sourceUserId ∈ viewer's approved follows)
   ⨝ users   (sourceUserId → displayName/slug)
```

This is **exactly the shape `lately.ts` already runs** — `getLatelyMilestones` (`lately.ts:197-242`) and `getFriendActivity` (`lately.ts:341-376`) both select `friend_answered`/`sourceResult='correct'` rows, inner-join `follows` on `sourceUserId`, and inner-join `users` for the name. So the query is proven precedent. To avoid N+1 it must be done **once, batched over the page's `questionIds`** (`questionId IN (...)`), then grouped in memory — mirroring how `get-feed-page.ts:241-254` already batch-loads question rows and user rows. Index support exists: `FeedItem_questionId_idx` and `FeedItem_recipientUserId_state_idx` (`schema.ts:1086,1090`).

**A2 — Does the render path carry answerer identity?** No. Each feed row carries a single `sourceUserId` (the one triggering friend) plus a server-resolved `source_friend_display_name`/`source_profile_href` (`get-feed-page.ts:277-302`). That is one id → one name, resolved from the batch `userRows` map (`get-feed-page.ts:247-254`). `FeedPersonLink` (`FeedList.tsx:222-238`) takes `{href, name}` — so it **can** be fed from loaded data, but only one person is loaded per row today. The multi-friend set is absent. Note: `FeedApiItem.friend_results: FriendResult[]` exists in the **client** type (`FeedList.tsx:81`) and is consumed by `comparisonCopy`/`pickPairedFriend`, **but the server never emits it** (grep: `friend_results` appears only in `FeedList.tsx`). It is a vestigial/client-constructed field, not a populated channel.

**A3 — Is "correct only" right?** With the data as-is, "correct only" is the **only** option: `create-feed-items-for-answer.ts:42` (`if (result !== 'correct') return;`) means a `friend_answered` row is **never written for a wrong answer**. There are no wrong-answerers in `friend_answered`. Canon treats wrong answers as connection events, but surfacing them here would require a **new write path** (and a migration's worth of backfill to be non-empty). Flagging, not deciding.

---

## B. The lead — is there a relevance signal beyond recency?

**B4 — Cheap signals on the answerer row.** Per `friend_answered` row (`schema.ts:1065-1083`): `sourceEventAt`/`createdAt` (**recency**), `sourceResult` (**correctness** — but uniformly `'correct'`, see A3, so it cannot discriminate), `sourceAnswerId` (carries the play-surface prefix — `daily:`/`catchup:`/`joshing_game:` — parsed by `parsePlayContext`, `lately.ts:276-291`, so "answered in a game vs in the daily" is a cheap tertiary signal if desired), and `sourceUserId`. After the `users` join: `displayName`/`slug`. **That is the entire cheap menu: recency, play-context, name. Correctness is present but constant.**

**B5 — Any reusable notion of friend relevance/closeness?** Three exist, none affordable at render time for *this* question:

- **Knowledge/domain overlap** — `getFriendDomainsForBonus` (`friend-presence-domains.ts:208-265`) ranks friends' *domains*, not "which friend is most relevant to question Q." Computing it pulls `getKnowledgePageData` + section-visibility **per followed friend** (`friend-presence-domains.ts:228-262`) — far too heavy per feed render.
- **Mutual-answer history / closeness** — `getLatelyConvergences` (`lately.ts:578-707`) is a 60-day co-correct scan across mutual follows; explicitly expensive.
- **Mutual-follow** — `getMutualFollows` is cheap-ish (one query) and could weight "is this a two-way friend," but that is a coarse binary, not per-question relevance.

**Honest statement:** with the data as-is and at acceptable render cost, **"most relevant" can only mean "most recent" (or, as a tie-break, play-context).** It cannot mean closeness, knowledge overlap, or interaction frequency without either a heavier render-time computation (convergence/territory) or a precomputed score. If the copy says "most relevant," it is recency dressed up — Josh should see that before committing to the word.

**B6 — Expand-list ordering.** Same trade. Recency (`sourceEventAt desc`) is free and is precisely what `lately.ts` already orders by (`lately.ts:241,375`). There is a strong in-repo precedent for an ordered multi-friend set: `FriendDomainCandidate.presenceSources` (`friend-presence-domains.ts:61-63,145`) is a friends-list sorted most-recent-first for attribution — the same structure the expand list wants.

---

## C. Dedup — the load-bearing wall

**C7 — Does multi-friend traversal multiply rows today?** No, and the reason is categorical: `friend_answered` does not render at all (`visibility.ts:131`). There is no traversal card to multiply. The only collapse logic in the feed is `collapseThumbsUpItems` (`feed.ts:62-102`), which groups *thumbs_upped* by question and is unrelated. Confirmed clean.

**C8 — Directed precedence (direct_sent vs friend-answered).** `direct_sent` rows are **pinned** and lead every surface (`feed.ts:199-220`, `feedPinnedPredicate`). A question that is both a pinned `direct_sent` card and answered by friends produces today: **one pinned card, no traversal echo** — because the `friend_answered` rows are invisible. So the baseline already favors directed; a build adding "Via" would hang the line on the pinned card and must suppress a *standalone* echo (none exists today, so the rule is "don't introduce one").

**C9 — Authored precedence (written-by vs Via).** Clean, no collision. `authored_shared` (friend wrote it) and `friend_answered` (friends answered it) are **distinct `feedItems` rows with distinct `sourceType`** (`visibility.ts:8,26`). "Written by" is derived from `question.creatorId`/`question.source` (`get-feed-page.ts:324`, `feedSourceVerb` `FeedList.tsx:280-290`); "Via" would come from the separately-fetched answerer set. They live on different fields and cannot collide on one row.

---

## D. Where attribution would appear

**D10 — Currently-rendering card types that could carry a "Via" line.** All four pass through `toTypedFeedItem` (`FeedList.tsx:333-365`) and a per-item `feedMetadata` render loop (`FeedList.tsx:292-311`) — so every one has a hook to hang a label on:

- `direct_sent` → `DirectSentCard` (`DirectSentCard.tsx`)
- `friend_added` (= `authored_shared`, the Craig envelope) → `FriendAddedCard`
- `friend_liked` (= legacy `thumbs_upped`) → `FriendLikedCard`
- `answered_by_you` → `AnsweredByYouCard`

For each, the per-question render loop exists. **But the answerer set is *not* reachable in that loop today** — it would have to be loaded by the new batched query (A1) and threaded onto `FeedApiItem` (the dormant `friend_results` field is the natural carrier). `FeedPersonLink` (`FeedList.tsx:222`) is the ready-made tappable component for each name in the lead + expand list.

---

## Three-bucket summary

**Exists & affordable (render-layer reach):**

- The per-question, per-viewer **complete answerer set** — same query `lately.ts` already runs; needs to be added as one batched query keyed on the page's `questionIds`.
- **Recency** as the lead/expand ordering signal (free, already the `lately.ts` order).
- **Play-context** tertiary signal (free, `sourceAnswerId` prefix).
- Render plumbing: per-item loop, `FeedPersonLink`, and a dormant `friend_results` carrier all already present.

**Exists but costly:**

- **Closeness / knowledge-overlap / convergence** relevance — real code exists (`friend-presence-domains.ts`, `getLatelyConvergences`) but is per-friend / 60-day-scan heavy; not affordable at feed render without precomputation.

**Absent (needs a write path / migration):**

- **Wrong-answerers** in `friend_answered` — never written (`create-feed-items-for-answer.ts:42`); including them is a new write path + backfill.
- A **persisted per-question relevance score** that would let "most relevant" mean closeness cheaply.

---

## Verdict

**"Via [most relevant friend] + expandable full set" is a data-layer project, not a render-layer change — but a small one.** It does **not** need a migration and does **not** need a new relevance computation. It needs exactly one thing the current feed lacks: **a new batched read of the already-written `friend_answered` rows** (the `lately.ts` query, keyed on the page's `questionIds`), wired onto the feed payload. The render layer is ready (per-item loop, `FeedPersonLink`, the dormant `friend_results` field). The "no hidden people" constraint is **fully honorable** — the complete set is retrievable and is already grouped this way in `lately.ts` and in `presenceSources`.

**The constraint Josh must accept before writing the copy:** with the data as-is and at acceptable render cost, **"most relevant" = "most recent."** Closeness/overlap signals exist but are too expensive to compute per-question at render time, and correctness can't discriminate (every `friend_answered` row is `correct`). If the lead name must mean *closeness*, that is a second, larger project (precomputed score or a heavier render path) — separable from, and not required by, the set-retrieval work above.

**Flagged, not resolved (privacy):** "Via [friend]" leaks a friend's *answering activity* to a viewer who may not be that friend's friend. Under the directional follow model the set is gated to `sourceUserId ∈ viewer's follows`, but the *answerers* did not necessarily consent to having their play exposed to the viewer. This is the more sensitive of the two attribution types (authorship is self-evidently public; answering is not) and sits under the test-phase "shareable for now" decision. Surfacing for review, per the audit's remit — deciding nothing.
