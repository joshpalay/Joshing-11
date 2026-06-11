// Friend-territory cards (B-FRIEND-TERRITORY-CARD-01): the "From Friends"
// zone's milestone bundle rows, reframed as knowledge portraits — name, a warm
// discovery-register status line, and the territory (topics) their recent
// questions cover. One card PER milestone bundle (not per friend): the
// milestone builder already groups a friend's activity into semantic bundles —
// a deep dive (one domain, ≤5 questions) and breadth bins (mixed domains, ≤5
// each) — so each bundle becomes its own card and a deep dive reads distinctly
// from a breadth sweep. A friend's bundles stack consecutively. A question
// packed into two of a friend's bundles plays once (the newer card claims it),
// and a bundle that somehow exceeds the cap splits rather than overflowing into
// a muted "+N more".
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
  // This card's bundle questions (deduped against the friend's earlier cards),
  // newest first — what "Play these →" actually plays.
  questions: StreamQuestion[]
}

// A card carries at most this many questions. Each milestone bundle is already
// built ≤ MILESTONE_CARD_QUESTION_CAP upstream, so per-bundle cards are normally
// under the cap on their own; this is the defensive ceiling — if a bundle ever
// arrives over-cap it splits into extra cards rather than overflowing.
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

// Items must be the From Friends zone's milestone StreamItems, newest first.
// Each qualifying bundle becomes its own card; a friend's bundles stack
// consecutively (friend order = first appearance), so the lead cards belong to
// the most recently active friend.
export function buildFriendTerritoryCards(
  items: readonly StreamItem[],
): FriendTerritoryCardModel[] {
  // Group bundles by friend, preserving first-appearance friend order and the
  // newest-first bundle order within each friend.
  const byFriend = new Map<
    string,
    {
      friendName: string
      bundles: Array<{ itemId: string; questions: readonly StreamQuestion[] }>
    }
  >()

  for (const item of items) {
    const expand = item.expand
    if (expand?.kind !== 'milestone' || expand.questions.length === 0) continue
    let entry = byFriend.get(expand.friendId)
    if (!entry) {
      entry = { friendName: expand.friendName, bundles: [] }
      byFriend.set(expand.friendId, entry)
    }
    entry.bundles.push({ itemId: item.id, questions: expand.questions })
  }

  const cards: FriendTerritoryCardModel[] = []
  for (const [friendId, entry] of byFriend.entries()) {
    // `seen` spans the friend's bundles so a question packed into two of them
    // (deep + breadth overlap) plays once — the newer bundle's card claims it.
    const seen = new Set<string>()
    for (const bundle of entry.bundles) {
      const questions: StreamQuestion[] = []
      for (const q of bundle.questions) {
        if (seen.has(q.questionId)) continue
        seen.add(q.questionId)
        questions.push(q)
      }
      if (questions.length === 0) continue
      // Normally one card per bundle (it arrives ≤ cap). The chunk loop is the
      // defensive ceiling: an over-cap bundle splits into extra cards (seeded
      // distinctly) rather than overflowing into a "+N more".
      const chunkCount = Math.ceil(questions.length / CARD_QUESTION_CAP)
      for (let chunk = 0; chunk < chunkCount; chunk++) {
        const chunkQuestions = questions.slice(
          chunk * CARD_QUESTION_CAP,
          (chunk + 1) * CARD_QUESTION_CAP,
        )
        const seed =
          chunkCount === 1
            ? `${friendId}:${bundle.itemId}`
            : `${friendId}:${bundle.itemId}:${chunk}`
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
  }
  return cards
}
