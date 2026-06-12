# D-FEED-FRIEND-ACTIVITY-01 — "From Friends" as a chronological activity log

**Status:** Spec agreed in discussion 2026-06-12. **Cut-1 wired** — the surface
now derives from `getFriendActivity` / `deriveFriendActivity` instead of the
deep/breadth milestone grouping (`PRD-D-4` §A, `src/lib/lately-milestones.ts`).
The underlying read-derived, additive, correct-`friend_answered`-only data source
is unchanged — only the grouping, ordering, and lifecycle of the cards change.

**Cut-1 scope (what's wired vs deferred).** Grouping, ordering, and held-singles
are live and pure. Two lifecycle nuances are **deferred to a persistence
follow-up** because a pure re-derivation can't tell "answered *before* the card
existed" from "answered *in-place*" without a frozen surfaced-at record:
- **§3 pre-answered exclusion** is NOT applied in cut-1. `playableForViewer`
  excludes only the viewer's *own authored* questions; already-answered questions
  stay in the bundle and render as spent triangles (carrying their prior result).
  This is exactly today's behavior and is what keeps an answered-in-place card
  alive (§5 / Q4) without persistence — at the cost of also showing cards whose
  fresh questions you happen to have all played elsewhere.
- **Static membership** is approximate: the bundle re-derives each load. A card
  doesn't vanish when you answer it (the answered questions remain as spent), but
  its membership isn't truly frozen. True freezing is the same persistence item.

## Why

Today's From Friends is not an activity feed; it is a **rolling 30-day mastery
summary grouped by topic**. The unit is `(friend × domain)`: a friend produces a
"deep" card per domain they got ≥3 right in, plus one "breadth" roll-up of their
lighter domains. Three consequences make it read wrong:

1. **Topic axis, not time axis.** It answers "what is each friend good at," not
   "what did my friends recently play."
2. **Cards mutate retroactively.** Each load re-derives from scratch. A friend's
   `deep:friend:Geography` card has a stable identity that persists up to 30
   days, **jumps back to the top every time they play more geography**, and
   silently swaps in their 5 most-recent questions (older ones fall off, "no +N
   others"). The same card changes contents and position over time — the
   opposite of a chronological record.
3. **Plays vanish.** Only ≥3-in-a-domain (deep) or ≥2-light-domains (breadth)
   surface. A single play, or a lone light domain, produces **no card at all**.

The product intent is the inverse: **a chronological record of what friends
recently played, and where I can also play.** New activity repeats at the top;
cards are static (a new play is a new card, never grafted onto an old one); but
activity is still compressed into bursts so 5 plays in 30 minutes are not 5
cards.

## The model

### 1. Grouping — strategy chosen by play context

Every `FeedItem` already carries a `sourceAnswerId` whose prefix identifies how
the friend played the question (`src/server/feed/create-feed-items-for-answer.ts`).
No schema change is required to start; the prefix routes each correct play to a
grouping strategy:

| Friend's play came from | Prefix | Card = | Identity (stable → immutable) |
|---|---|---|---|
| Daily 5 | `daily:` | the day's daily batch | `(friendId, queueDate)` |
| Catchup / play-missed | `catchup:` | that catchup sitting | `(friendId, day)` |
| Joshing game | `joshing_game:` | the game | `(friendId, joshingGameId)` |
| Ad-hoc feed play | `feed:` | a **time-gap burst** | first play's timestamp |
| Profile / search | `profile:` | a time-gap burst (same as feed) | first play's timestamp |

The natural-unit batches (daily / catchup / game) are inherently static once the
day or game is over. Only the **feed/profile burst** needs an explicit lifecycle:
plays by the same friend cluster while the gap between them is **< 30–60 min**
(threshold to tune); once the gap closes, the burst card **freezes** — later play
starts a new card.

> **Denormalization (later, not a blocker):** parsing the `sourceAnswerId` prefix
> is the cheap start. If it proves fragile, add a denormalized `sourceContext`
> enum column to `FeedItem` populated at creation time. Catchup also has **no
> stored batch id** today (it is a view, `getCatchupQuestions`), which is why its
> card key falls back to `(friend, day)`; a real catchup-batch id would tighten
> this later.

### 2. Filter

**Correct-only**, unchanged. Only `friend_answered` rows with
`sourceResult = 'correct'` are eligible. (Result-agnostic "everything they
played" was considered and rejected — it would expose friends' wrong answers.)

### 3. What a card shows — the "I can also play" value

Within a card, list the friend's correct questions, **minus questions the viewer
authored or has already answered** (the propagation/dedup rule: "when a friend
plays, it shows up in mine — unless I wrote it or already answered it"). The
remaining **playable-for-me** questions are the card's value: answer them inline.

- Authored-by-viewer exclusion already exists in the milestone query.
- **Already-answered changes behavior:** today such questions render **locked /
  greyed for context**; here they are **removed** from the card (and count
  against the playable count for held-singles, below). The feed is "where I can
  play," so questions I cannot play do not belong in a fresh card.

### 4. Held singles — show everything, without singleton cards

A card whose **playable-for-me** count is 1 is a singleton. Singletons are not
dropped and not shown alone; they are **held** until they have company:

1. **Hold per-friend.** Never mix people into one card — a held single waits only
   for the *same friend's* next playable question. Card identity stays "from one
   person."
2. **Release solo after 5 days.** If no second question arrives within 5 days,
   the single is released on its own so nothing is ever lost.
3. **Sort at release time.** A held/released card enters the feed at the top at
   the moment it becomes visible (matches "new repeats at the top"), **not**
   back-dated to the original play.

The singleton test is on *playable-for-me* count, so a friend's daily-5 card of
which I have already played 4 collapses to 1 playable → it is held, not shown as
a lonely card.

### 5. Persistence & lifecycle

- **Membership is static once surfaced.** A card's set of questions does not
  change after it appears; only my per-question progress overlays it.
- **Answered-in-place cards stay.** When I play a card's questions from the feed,
  the card **does not vanish** — the question flips to a completed/✓ state and
  the card drifts **down** as newer activity lands on top.
  - Contrast with §3: *pre-answered* questions (played elsewhere, before the card
    existed) never enter the card; *answered-in-place* questions persist on it.
- **Rolling 30-day retention.** The whole surface keeps a window (≈30 days, as
  today) so it does not grow unbounded; a fully-answered card ages off. (Open:
  whether completed cards should instead move to a separate "history" view rather
  than roll off — see Open below.)

### 6. Ordering

Strictly **chronological**, newest on top, keyed by surface/release time. No
topic or mastery re-ranking; the prominence sort that mixes tier + content
signals does not apply to this surface.

## What this replaces in code

- `deriveLatelyMilestones()` and the `MilestoneDeep` / `MilestoneBreadth` types
  (`src/lib/lately-milestones.ts`) → a new `deriveFriendActivity()` producing
  time-and-context cards.
- The deep/breadth copy (`deepMilestoneCopy`, `breadthMilestoneCopy`) → per-card
  copy keyed on context ("Robyn played her daily five", "Robyn's been playing —
  3 from her feed", etc.; copy TBD with product).
- `milestoneToStreamItem` / the milestone branch of `buildActivityStream`
  (`src/server/activity/build-stream.ts`) → emit the new cards.
- The query stays close: `getLatelyMilestones` (`src/server/db/queries/lately.ts`)
  already fetches correct `friend_answered` rows in a 30-day window; it must also
  carry the `sourceAnswerId` (for context routing) and `sourceEventAt` (already
  present) per row, and the held-singles buffer needs a small amount of state
  (see Open).

## Wiring trace — what feeds `deriveFriendActivity`

Grounded in the current code (`src/server/db/queries/lately.ts`,
`src/server/activity/build-stream.ts`). The pure derivation
(`src/lib/friend-activity.ts`) and its tests
(`src/lib/__tests__/friend-activity.test.ts`) are built; the items below are the
*not-yet-done* server changes to actually feed it.

**1. `getLatelyMilestones` → `getFriendActivity`** (`lately.ts:173`). The existing
query already selects the right rows (correct `friend_answered`, recipient =
viewer, answerer followed, joined to `questions`/`users`). Changes:

- **Add `sourceAnswerId: feedItems.sourceAnswerId`** and
  **`joshingGameId: feedItems.joshingGameId`** to the `.select(...)`.
- **Window:** `MILESTONE_WINDOW_DAYS = 30` → **~35 days** (`lately.ts:147/174`) so a
  play can still reach its 5-day solo release before its row ages out. (Or keep 30
  and accept that a single first seen >25 days ago never solo-releases — call it.)
- **Drop the DB-level author exclusion** (`lately.ts:214`, the
  `or(isNull(creatorId), ne(creatorId, userId))`). In the new model an
  authored/pre-answered question is **not removed from the result set** — it stays
  so its batch still forms, but it is marked `playableForViewer: false`. Move that
  exclusion into the per-row `playableForViewer` computation instead.

**2. Build each `FriendPlayRow`** (replaces the `MilestoneAnswerRow` loop,
`lately.ts:220–238`):

- `context` ← **prefix of `sourceAnswerId`** (`daily:` / `catchup:` / `feed:` /
  `joshing_game:` / `profile:`). A tiny `parsePlayContext(sourceAnswerId)` helper;
  unknown/legacy prefixes fall back to `'feed'` (burst) so nothing is dropped.
- `batchKey` ← **not parsed from `sourceAnswerId`** (its daily form is
  `daily:${propagationKey}:${userId}`, which is not a day). Instead:
  - `daily` / `catchup` → **calendar day of `sourceEventAt`** (pick the tz — likely
    the app's display tz, same one the daily queue uses).
  - `joshing_game` → the **`joshingGameId` column** (real FK, already on the row).
  - `feed` / `profile` → `null` (the derivation sessionizes into bursts).
- `playableForViewer` ← `creatorId !== viewer` **AND** not in the viewer's prior
  answers. Reuse **`getViewerPriorAnswerResults(userId, questionIds)`**
  (`lately.ts:379`) — it already resolves the viewer's prior correct/incorrect set;
  here we only need membership. `domain` is no longer needed for grouping (drop
  `resolveMilestoneDomain` from this path; question text/domain still resolves at
  render via `getMilestoneQuestionText`).
- Pass `now = new Date()` into `deriveFriendActivity(rows, now)`.

**3. `build-stream.ts`** (`milestoneToStreamItem`, the milestone branch). Map a
`FriendActivityCard` → `StreamItem` instead of a `LatelyMilestone`:

- `id` ← `card.id`; `sortAt` ← **`card.effectiveAt`** (this is the chronological
  key — it already carries the held-singles "release time", so no extra prominence
  sort); `friendId`, `icon: 'bundle'` as today.
- `expand` ← `{ kind: 'milestone', friendId, friendName, questions }` is reusable
  as-is; `questions` come from `getMilestoneQuestionText(card.questionIds)` +
  `getViewerPriorAnswerResults` (already wired for the existing surface).
- The **prominence re-sort must be bypassed** for these rows — they sort by
  `effectiveAt` only (§6). Today milestones flow through `sortByProminence`; gate
  this surface out of it or give it a recency-only comparator.

**4. Authorization / click-through.** `collectFriendActivityQuestionIds(cards)`
replaces `collectMilestoneQuestionIds` at the two call sites
(`getSeededPlayQuestions` authorization, `lately.ts:270`, and anywhere the
milestone answer route re-derives the allowed set). Same shape (a `Set<string>`),
so it's a drop-in.

**5. Copy.** `deepMilestoneCopy` / `breadthMilestoneCopy` are unused by the new
cards; per-context copy (`daily` / `catchup` / `joshing_game` / `feed` burst /
`mixed`) is still TBD (see Open).

**Net:** one query rewrite, one pure derivation (done), a context parse + a
prior-answers lookup that already exists, and a recency-only sort gate. No
migration is required for cut 1; the optional `FeedItem.sourceContext` column is a
later hardening, not a prerequisite.

## Open / to decide before/at build

- **Burst gap threshold** for feed/profile plays: 30 vs 60 min. Pick and assert
  in a unit test (the derivation is pure, like `deriveLatelyMilestones`).
- **Held-singles state.** Releasing "solo after 5 days" and "sort at release
  time" require remembering *when a single was first held* and *whether it has
  been released*. A pure re-derivation from the 30-day rows can reconstruct the
  hold (first-held = the play's `sourceEventAt`; released = "5 days elapsed" or
  "≥2 playable now"), so this may need **no persistence** — but "sort at release
  time" for a single that gets *company* (not the 5-day path) needs the join
  moment, which is derivable as `max(sourceEventAt)` of the pair. Confirm the
  pure reconstruction holds for every path before adding any table.
- **Completed-card fate:** roll off at 30 days (simple) vs move to a separate
  "history"/"replay" surface once fully answered (`/replay` and `/archive` exist
  but are deliberately unlinked — see DECISIONS.md).
- **Copy** for each context card — needs product sign-off (the D-4 copy was
  already flagged placeholder).
- **Daily/catchup card when the friend's plays span a gap:** a daily batch is one
  card per `(friend, day)` even if they answered the 5 across the morning and
  night — confirmed intended (the *natural unit* wins over the burst gap for
  daily/catchup/game contexts).
