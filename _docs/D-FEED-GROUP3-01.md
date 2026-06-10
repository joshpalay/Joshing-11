# D-FEED-GROUP3-01 — "Everything Else" Social Stream (cut 1, build notes)

**Status:** Cut 1 built against latest `dev2`. Straight-stream-first; per-person
clustering deliberately gated (NOT shipped). Grounded in `D-FEED-INVENTORY-01.md`.

## What shipped (cut 1)

**Structure (§2).** Group 3 — the "everything else" zone (relationship events +
promos, i.e. the recency-bucketed `restRows`) — now renders as a **straight
chronological stream of full-sentence LONE events**. `PersonActivityCard`
clustering is dropped for this zone (`FeedList.tsx`, rest-zone render). Recency
buckets are kept. For You / From Friends are untouched (they never clustered).
The component is left in place; re-enabling clustering here is a one-line change
(restore `groupActivityByFriend(group.items)`).

**Copy (§3, Appendix A).** Full-sentence relationship copy, hash-selected per
event id so a feed of the same type still varies (`activity-stream.ts`):
- Pool 1 `got_you` and Pool 2 `you_got` — topic folded into the line, second
  line cleared (no echo). Topic-less fallback when an event carries no domain.
- Pool 3 convergence — replaced the old 6-line pool with **3a single-topic**
  (when all 3 cluster questions share one domain, detected in `build-stream.ts`)
  and **3b topic-less** (`lately.ts`). Never lists all three topics.
- Pool 4 promos — headline rotates by a day-seeded `headlineIndex` on the embed
  (`EditorialPromos.tsx`); eyebrow / CTA / supporting copy stay fixed.
- Register is connection-only; the banned competition words are kept out by
  construction (and asserted in tests).

**Expand-to-send-onward + honest authorship (§4).** A row gets a chevron only
when it references a sendable question. Newly expandable: `saved`
(`question_curated`) and `reacted` (`reaction_received`) now carry a
`your_question` expand and reveal the question with a Send affordance. Pure
status events stay flat. The reveal marks provenance honestly: **house →
"Joshing · Editorial", LLM-origin → "Generated", human → unmarked** — a machine
question can never read as if a person wrote it. This required server work:
`hydrateCuratedQuestions` / `hydrateReactions` / `hydrateFriendAnsweredQuestions`
and `getMilestoneQuestionText` (covers convergence) now thread domain +
`creatorId`/`source` → `resolveAuthorDisplay`.

**Calm baseline (§5).** Already largely in place from the prior calm-baseline
work (no row hairlines, demoted timestamps/chevrons, no blue-for-emphasis). No
new design tokens; no changes to groups 1 & 2.

**Dead copy (§E).** Confirmed unused and NOT designed around: the "killing it"
breadth phrasing and the all-caps `THEY_GOT_YOU_CAPTIONS` / `YOU_GOT_THEM_CAPTIONS`
pools (Home renders `momentToStreamItem`, not those).

## Evaluation note — does the straight stream read calm, or is clustering needed?

**Checkpoint, pending real-content review.** Cut 1 is the deliberate experiment:
get density from visual quiet, not copy compression. The reasoning that the
*wording* problem is now fixed independent of clustering holds — the broken form
was the cluster's subject-stripped fragments ("got Robyn — French Herbs"), and
those are gone; every row is a full lone sentence. The *busyness* question can
only be judged against a real, dense feed.

**Re-introduce clustering ONLY if** the straight stream, viewed with a busy real
account (many same-friend events in one bucket), still reads as a wall. Signals
to watch: the same friend's name repeating many times in a single recency
bucket; the eye unable to find a resting point. If that happens, the gated path
is a one-line restore in `FeedList.tsx` — but clustering must then use the
full-sentence lone copy, not regress to fragments.

**Open threads for Josh:**
- Convergence 3a depends on detecting "all 3 questions share one topic" from
  data — implemented in `build-stream.ts` (all domains non-null and equal),
  defaulting to 3b otherwise. Confirm the topic-detection feels right on real
  clusters.
- Promo eyebrows stay fixed (headline-only rotation). Confirm.
