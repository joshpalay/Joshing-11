// Friend-territory cards (B-FRIEND-TERRITORY-CARD-01): the "From Friends"
// zone's milestone bundle rows, reframed per friend as a knowledge portrait —
// name, a warm discovery-register status line, and the territory (topics) their
// recent questions cover. One card per friend: a friend's deep + breadth
// milestone rows in the zone merge here, so a single deep milestone (one
// domain) still joins their other bundles into one breadth-of-curiosity list.
//
// Thesis constraint (load-bearing): the card celebrates breadth, never
// performance. A topic's `played` is the VIEWER's "have I been here?" —
// attempted, right OR wrong, identically — and nothing on the model carries
// correctness or counts.

import type { StreamItem, StreamQuestion } from '@/lib/activity-stream'
import { friendTerritoryStatusLine } from '@/lib/activity-stream'

import { visibleFeedCategory } from './category'

export type FriendTerritoryTopic = {
  name: string
  // Viewer-relative: has the viewer attempted any of this topic's questions in
  // the friend's bundles. Fill-on-attempt — a miss marks it exactly like a
  // correct answer (wrong answers are connection events; no third state).
  played: boolean
}

export type FriendTerritoryCardModel = {
  id: string
  friendId: string
  friendName: string
  statusLine: string
  topics: FriendTerritoryTopic[]
  // The deduped union of the friend's bundle questions, newest milestone
  // first — what "Play these →" actually plays.
  questions: StreamQuestion[]
}

// Items must be the From Friends zone's milestone StreamItems, newest first;
// card order follows first appearance, so the hero is the most recently
// active friend.
export function buildFriendTerritoryCards(
  items: readonly StreamItem[],
): FriendTerritoryCardModel[] {
  const byFriend = new Map<
    string,
    {
      friendName: string
      newestItemId: string
      questions: StreamQuestion[]
      seen: Set<string>
    }
  >()

  for (const item of items) {
    const expand = item.expand
    if (expand?.kind !== 'milestone' || expand.questions.length === 0) continue
    let entry = byFriend.get(expand.friendId)
    if (!entry) {
      entry = {
        friendName: expand.friendName,
        newestItemId: item.id,
        questions: [],
        seen: new Set(),
      }
      byFriend.set(expand.friendId, entry)
    }
    // A question can sit in two of the same friend's bundles (deep + breadth
    // packing overlap); the card plays it once.
    for (const q of expand.questions) {
      if (entry.seen.has(q.questionId)) continue
      entry.seen.add(q.questionId)
      entry.questions.push(q)
    }
  }

  return [...byFriend.entries()].map(([friendId, entry]) => {
    // Distinct visible topics in question order (newest milestone first).
    // Suppressed catch-all categories ("Other", "General…") never make the
    // territory list, though their questions stay playable.
    const topics: FriendTerritoryTopic[] = []
    const topicByName = new Map<string, FriendTerritoryTopic>()
    for (const q of entry.questions) {
      const name = visibleFeedCategory(q.domain)
      if (!name) continue
      const played = q.priorResult !== null
      const existing = topicByName.get(name)
      if (existing) {
        existing.played = existing.played || played
      } else {
        const topic: FriendTerritoryTopic = { name, played }
        topicByName.set(name, topic)
        topics.push(topic)
      }
    }
    const seed = `${friendId}:${entry.newestItemId}`
    return {
      id: `territory:${seed}`,
      friendId,
      friendName: entry.friendName,
      statusLine: friendTerritoryStatusLine(seed),
      topics,
      questions: entry.questions,
    }
  })
}
