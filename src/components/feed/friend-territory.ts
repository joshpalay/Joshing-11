// Friend-territory cards (B-FRIEND-TERRITORY-CARD-01): the "From Friends"
// zone's milestone bundle rows, reframed per friend as a knowledge portrait —
// name, a warm discovery-register status line, and the territory (topics) their
// recent questions cover. Each card is a single playable unit capped at
// CARD_QUESTION_CAP questions — the same per-bundle cap the milestone rows
// carried. A friend's deep + breadth milestone rows merge and dedupe, then
// split across consecutive cards (newest questions first) when they overflow
// the cap, rather than collapsing into one card with a muted "+N more".
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

// At most this many questions ride on a single card. A friend with more recent
// questions than this splits across consecutive cards (newest first) — the cap
// matches the milestone builder's MILESTONE_CARD_QUESTION_CAP so each card stays
// a digestible, fully-playable bundle.
export const CARD_QUESTION_CAP = 5

// Distinct visible topics in question order (newest milestone first).
// Suppressed catch-all categories ("Other", "General…") never make the
// territory list, though their questions stay playable. `played` is the
// VIEWER's "have I been here?" — attempted, right OR wrong, identically.
function topicsForQuestions(
  questions: readonly StreamQuestion[],
): FriendTerritoryTopic[] {
  const topics: FriendTerritoryTopic[] = []
  const topicByName = new Map<string, FriendTerritoryTopic>()
  for (const q of questions) {
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
  return topics
}

// Items must be the From Friends zone's milestone StreamItems, newest first;
// card order follows first appearance, so the lead card is the most recently
// active friend. Each friend's questions split into one or more cards of at
// most CARD_QUESTION_CAP, consecutive in the stack.
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

  const cards: FriendTerritoryCardModel[] = []
  for (const [friendId, entry] of byFriend.entries()) {
    // Split the friend's deduped questions (newest milestone first) into cards
    // of at most CARD_QUESTION_CAP; overflow lands on the next card. Each card
    // derives its own topics and plays only its own slice, so the territory
    // list never spills into a "+N more" — it continues on the card beneath.
    const chunkCount = Math.ceil(entry.questions.length / CARD_QUESTION_CAP)
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkQuestions = entry.questions.slice(
        chunk * CARD_QUESTION_CAP,
        (chunk + 1) * CARD_QUESTION_CAP,
      )
      if (chunkQuestions.length === 0) continue
      // Seed includes the chunk index so a friend's stacked cards draw
      // different status lines from the pool instead of repeating one line.
      const seed = `${friendId}:${entry.newestItemId}:${chunk}`
      cards.push({
        id: `territory:${seed}`,
        friendId,
        friendName: entry.friendName,
        statusLine: friendTerritoryStatusLine(seed),
        topics: topicsForQuestions(chunkQuestions),
        questions: chunkQuestions,
      })
    }
  }
  return cards
}
