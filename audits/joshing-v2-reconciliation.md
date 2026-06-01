# Joshing v2 — Reconciliation / Gap Analysis

Read-only reconciliation of the v2 target product model against the current
codebase. **No code was changed in this pass.** This is target-vs-reality with
the seams called out; individual changes get specced afterward, one at a time.

**Verdict legend:** ✅ exists & matches · 🟡 partially exists / diverges · ❌ absent · ⚠️ conflict to flag

---

## A. The Daily Ritual (capabilities 1–4)

| # | Capability | Verdict | Reality |
|---|---|---|---|
| 1 | Daily Five **+2** friend-answered bonus, graceful shrink to 5 | ❌ | `DAILY_QUEUE_SIZE = 5` is a hard constant (`src/server/daily/types.ts:85`). There is **no "+2" tier**. Friend-authored questions don't sit in bonus slots — they're mixed *into* the 5 via `pickEligibleAuthoredQuestions()` and LLM backfills the remainder (`src/server/daily/queue-orchestrator.ts:109–119`). The graceful-shrink exists but for a different reason (LLM shortfall → persist N<5, `queue-orchestrator.ts:194–220`), not "no friend material." |
| 2 | Freely choose/change focus areas, no friend-mediated lock | ✅ | **No lock exists.** Domains are added freely via `/api/daily/preferences/add-domain` with no friend gate; no `locked`/`unlock` columns in schema. The "topic lock being removed" is effectively *already gone* — see ⚠️ Conflict 1 for the residual that contradicts this. |
| 3 | Attribution "Robyn got this" on bonus | 🟡 | Friend slots carry `author_id`/`author_name`/`author_note` (`src/server/daily/types.ts:19–71`), but this is **author** attribution (who *wrote* it), not **answerer** attribution (who *got it right*). The "Robyn answered this correctly → it surfaced for you" relationship is not modeled in the queue. |
| 4 | Bonus questions are *accessible* "portal" questions | ❌ | `pickEligibleAuthoredQuestions()` (`src/server/db/queries/daily.ts:735–876`) has **no difficulty/accessibility filter** — it ranks by friend-tier + eligibility score, any difficulty. There is no notion of "accessible peek into a friend's world." |

---

## B. Knowledge & Map (capabilities 5–7)

| # | Capability | Verdict | Reality |
|---|---|---|---|
| 5 | Default-add domain on correct answer in new territory, easy undo | ⚠️🟡 | **Behavior is split and contradicts the target on the main path.** Daily (bot) questions are **hard-gated** — they *cannot* open new domains (`src/app/api/daily/answer/route.ts:332–350`, citing "PRD §8.4.3"). User-authored public questions answered correctly **do** default-add (`src/app/api/questions/[id]/answer/route.ts:78–119`). **No undo affordance exists** on either path. So the audit's "is it already default-add?" question resolves to: *partly, but the Daily path actively forbids it.* |
| 6 | See overlap with friends / what friends are into | 🟡 | `getFriendsHub()` computes `sharedInterests` by intersecting **declared** interests only (`src/server/db/queries/friends.ts:159–294`). No **demonstrated**-territory overlap, and no UI consuming it as a presence surface. |
| 7 | Knowledge map as self-expression portrait | 🟡 | Rich knowledge surfaces exist (`getKnowledgePageData`, `getUserMasteryOverview`, `PortraitCircles.tsx`, `/knowledge`, `/users/[id]/knowledge`) plus per-domain privacy (`profileDomainVisibility`, schema `676–699`). The *expressive* portrait is largely built; the *overlap/targeting* dimension is not. |

---

## C. Creating & Sending (capabilities 8–12)

| # | Capability | Verdict | Reality |
|---|---|---|---|
| 8 | Bank-only / send-all / send-specific | 🟡 | Send-specific → `/api/questions/send` (`sourceType:'direct_sent'`); send-all → creation with `shareToFeed` (`sourceType:'authored_shared'`, `src/app/api/questions/route.ts:242–317`); bank-only = no send. The three-way choice exists in the API but `CreateChooser.tsx` only routes to `/questions?create=1` (the branching lives in `QuestionForm`). |
| 9 | Send to a specific friend → "Sent to you" feed | ✅ | `direct_sent` items render with **"sent this to you"** (`FeedList.tsx:238–244`), filterable via `filter=sent-to-me`. |
| 10 | Send an *LLM* question (curation) | ⚠️ | Possible mechanically but **destroys provenance**: `resolveQuestionIdForSend()` converts a `GeneratedQuestion` into a `Question` with `source:'authored'` and `creatorId = sender` (`src/app/api/questions/send/route.ts:150–181`). The sender becomes the "author" — there is no "curated LLM" marker. |
| 11 | "wrote you this" vs "sent you this" type marker | ⚠️ | The UI distinction is driven by `FeedItem.sourceType`, **not** by question origin. Because of #10, a curated LLM send is indistinguishable from an authored send. The `Question.source` field that *could* carry this is not used for the marker. |
| 12 | Homepage prompt to write questions | 🟡 | Authoring entry points exist (`CreateChooser`, `/questions`), but no dedicated homepage *nudge* prompting authoring was found. (Worth a closer look in `src/app/page.tsx` if this becomes a spec.) |
| — | LLM calibrates difficulty **to recipient** on send | ⚠️❌ | **Dormant.** `Question.calibratedDifficulty` column exists but is **never populated**. Adaptive difficulty (`src/server/adaptive-difficulty.ts`) only feeds *daily generation*, not sends. A sent question keeps its creation-time difficulty; recipient calibration is unimplemented. |

---

## D. Commentary (capabilities 13–14)

| # | Capability | Verdict | Reality |
|---|---|---|---|
| 13 | Attach commentary to an authored question | ⚠️ | **Two overlapping systems exist** — flag this. (a) `Question.creatorNote` (≤200 chars, set at creation, `schema:253`); (b) a separate relational `CreatorNote` table (`schema:434–454`) for notes written *after* a friend gets it wrong (`src/server/creator-notes.ts`). Plus dormant `quip` fields on `FeedItem` and `JoshingGameResponse` (rendered in UI, never written). The target's single "author's why" maps cleanly to `creatorNote`; the other two need disambiguation. |
| 14 | Commentary revealed when someone answers | 🟡 | `creatorNote` is shown to recipients on answer; the post-hoc `CreatorNote` flow is triggered by a *wrong* answer (opposite trigger). One-directional only — matches the "no reaction-back" constraint. |

---

## E. The Feed (capabilities 15–17)

| # | Capability | Verdict | Reality |
|---|---|---|---|
| 15 | Feed = deliberate human intent only | ⚠️ | **Core conflict.** One unified `FeedItem` table mixes all three types via `sourceType`: `authored_shared` (type 1), `direct_sent` (type 2), **`friend_answered`** (type 3) (`src/server/feed/visibility.ts:5–26`). Type 3 is exactly what the target wants *out* of the feed. |
| 16/17 | Sent questions worked at own pace, any topic, separate from Daily | 🟡 | `filter=sent-to-me` already isolates `direct_sent`. But there's no surface separation from Daily, and type 3 still pollutes `filter=all`/`from-friends`. |
| — | Remove type 3 from feed → fold into Daily Five+2 | ❌ (not started) | No schema change needed to split — it's a query/visibility filter change (`feed.ts:395–439`, `visibility.ts:72–82`, `get-feed-page.ts:106–112`, `FeedList.tsx:1182–1219`). But the *destination* (a Daily +2 surface) doesn't exist (see capability 1). So this is a **two-sided** change: stop rendering type 3 in feed **and** build the +2 consumer — currently neither end exists. |

---

## F. Connection & Discovery (capabilities 18–22)

| # | Capability | Verdict | Reality |
|---|---|---|---|
| 18 | Follow = friend, single relationship | ✅ | Single `friendships` table (`schema:717–740`), states `none/pending_*/friends/recently_sent`. No separate follow table — already unified. |
| 19 | Broadcasts only from people you follow | ⚠️ | Gated by **mutual active friendship**, not directional follow (`getFriends()` filters `status='active'`, `friends.ts:64–82`; eligibility in `create-feed-items-for-answer.ts:70–86`). Target says "follow = consent"; reality requires *mutual* friendship — flag the directionality mismatch. Also: `questionVisibilityEnum` has `'friends'`/`'private'` but they're **never writable** — questions are hardcoded `public`. |
| 20 | Informed when someone answers my authored question → go follow | 🟡 | `ActivityItem` type `'friend_answered_your_question'` exists and writes to the bell/`/activities` (`src/server/activity/write-activity.ts:3–22`). The "then connect" loop isn't wired from that notification. |
| 21 | Be discovered when I answer someone's authored question | 🟡 | Discovery infra exists (`/api/friends/has-new-discovery`, `getNewDiscoveryStatus`, `/api/account/discoverability`, `/friends/find`) but is **contact-hash / phone-based**, not "niche-match via answering." The mutual-niche discovery engine is not built. |
| 22 | House/editorial author (never simulated friend) | ❌ | No house-author identity. `creatorId` is nullable → renders as the literal string **"the author"** fallback (`get-feed-page.ts:249`). No labeled editorial entity; would need either a flagged `User` row or a first-class non-human author type. |

---

## ⚠️ Seams & Conflicts to flag (not resolving)

1. **Residual "friend_mediated" territory source vs. "no lock" claim.** Capability 2 says the lock is being removed, and structurally it's gone — *but* `getKnowledgeBase()` still tags domains with `source: 'friend_mediated'` (`daily.ts:46,220`) and the deprecated `upgradeKBDomainToDemonstrated()` lingers "for in-flight code paths." This is vestigial language from the old model that will confuse anyone reading the KB code as if a lock still exists.

2. **The Daily KB gate directly contradicts capability 5.** `daily/answer/route.ts:332–350` *forbids* bot questions from opening domains, citing a PRD section. Capability 5 wants default-add. These cannot both stand — a decision is needed on whether the gate is removed, and whether "default-add" applies to the Daily path or only the authored path.

3. **The feed split is two-sided and only the table is ready.** Splitting type 3 out of the feed is a cheap filter change, but it has nowhere to land until the "+2" surface exists — and the queue is a fixed-5 JSONB with no bonus tier and no *answerer* attribution. The expensive half is the Daily +2 consumer, not the feed filter.

4. **Provenance loss makes capability 11 currently unbuildable as specced.** Until sending an LLM question stops rewriting it to `source:'authored'`/`creatorId=sender` (`send/route.ts:150–181`), there is no data to distinguish "wrote you this" from "sent you this."

5. **Three commentary mechanisms** (`Question.creatorNote`, `CreatorNote` table, dormant `quip`) overlap and are triggered differently (at-creation vs. after-wrong-answer vs. never-written). Capabilities 13–14 assume one. This needs consolidation before speccing.

6. **Mutual-friendship vs. directional-follow.** Capability 19 frames follow as one-directional consent; the codebase enforces *mutual* `status='active'`. Either the target loosens to mutual, or the relationship model gains directionality.

7. **`/activities` is fully built and reachable** (bell icon, `Nav.tsx:122–139`, 15 activity types) — it is **not** the unreachable infra the doc remembered. It's a *notification/digest* ("Lately."), semantically distinct from a "what friends are into" *presence* surface. Reusing it for capability 6 would blur those roles; flag before assuming it's the host.

---

## Open questions for the spec phase

- **Capability 5 vs. the §8.4.3 gate** — which path wins, and does undo replace the gate?
- **"+2" attribution model** — the queue tracks *authors*, but +2 needs *answerers*. New field/source, or derive from `friend_answered` feed items at queue-build time?
- **"Accessible" definition** — is it `calibratedDifficulty`, `llmDifficulty`, or a new threshold? Nothing today encodes "portal-easy."
- **Follow directionality** (open decision in the doc anyway) — keep mutual, or split?
- **House author** — flagged `User` row vs. first-class type; affects `creatorId` nullability semantics everywhere.

---

*Generated as a read-only reconciliation pass. No source files were modified.*
