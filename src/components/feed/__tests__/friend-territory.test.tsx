import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { StreamItem, StreamQuestion } from '@/lib/activity-stream'
import {
  FRIEND_TERRITORY_STATUS_LINES,
  friendTerritoryStatusLine,
} from '@/lib/activity-stream'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/components/SendQuestionDrawer', () => ({ SendQuestionDrawer: () => null }))
vi.mock('@/app/activities/FriendRequestActions', () => ({ FriendRequestActions: () => null }))
vi.mock('@/app/activities/ReactionGotItButton', () => ({ ReactionGotItButton: () => null }))

import { FriendTerritoryCard } from '@/components/feed/FriendTerritoryCard'
import { buildFriendTerritoryCards } from '@/components/feed/friend-territory'

// B-FRIEND-TERRITORY-CARD-01 — friend-territory cards. These pin the
// thesis-critical constraints: two triangle states only (fill on attempt,
// wrong identical to correct), no scores/counts on the card face, a
// discovery-register status pool with no competitive copy and no assumed
// pronouns, and a forward-looking CTA.

function question(over: Partial<StreamQuestion> & { questionId: string }): StreamQuestion {
  return {
    text: 'Who captains the Enterprise-D?',
    domain: 'Star Trek',
    priorResult: null,
    ...over,
  }
}

function milestoneItem(
  id: string,
  friendId: string,
  friendName: string,
  questions: StreamQuestion[],
): StreamItem {
  return {
    id,
    sortAt: new Date('2026-06-01T00:00:00Z'),
    tier: 2,
    friendId,
    homeEligible: true,
    line: [{ t: 'actor', name: friendName, userId: friendId }, { t: 'text', v: ' went deep' }],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'bundle',
    expand: { kind: 'milestone', friendId, friendName, questions },
  }
}

describe('buildFriendTerritoryCards — knowledge portraits, capped at 5 per card', () => {
  it('merges a friend\'s deep + breadth bundles (≤5 questions stay one card), topics deduped in order, lead = newest first', () => {
    const cards = buildFriendTerritoryCards([
      milestoneItem('m1', 'robyn', 'Robyn', [
        question({ questionId: 'q1', domain: 'Star Trek' }),
        question({ questionId: 'q2', domain: 'Star Trek' }),
      ]),
      milestoneItem('m2', 'shanea', 'Shanea', [
        question({ questionId: 'q5', domain: 'Jazz' }),
      ]),
      milestoneItem('m3', 'robyn', 'Robyn', [
        question({ questionId: 'q3', domain: 'French Herbs' }),
        // Same question packed into two of Robyn's bundles: played once.
        question({ questionId: 'q1', domain: 'Star Trek' }),
      ]),
    ])
    expect(cards.map((c) => c.friendId)).toEqual(['robyn', 'shanea'])
    const robyn = cards[0]!
    expect(robyn.friendName).toBe('Robyn')
    expect(robyn.topics.map((t) => t.name)).toEqual(['Star Trek', 'French Herbs'])
    expect(robyn.questions.map((q) => q.questionId)).toEqual(['q1', 'q2', 'q3'])
  })

  it('fills on attempt: a wrong answer marks a topic played EXACTLY like a correct one (two states, no third)', () => {
    const build = (priorResult: 'correct' | 'incorrect' | null) =>
      buildFriendTerritoryCards([
        milestoneItem('m1', 'robyn', 'Robyn', [
          question({ questionId: 'q1', domain: 'Star Trek', priorResult }),
          question({ questionId: 'q2', domain: 'Mock Trial', priorResult: null }),
        ]),
      ])[0]!

    const correct = build('correct')
    const incorrect = build('incorrect')
    const untried = build(null)

    expect(correct.topics).toEqual([
      { name: 'Star Trek', played: true },
      { name: 'Mock Trial', played: false },
    ])
    // Load-bearing: the model a miss produces is indistinguishable from the
    // one a correct answer produces — correctness never reaches this surface.
    expect(incorrect.topics).toEqual(correct.topics)
    expect(untried.topics[0]).toEqual({ name: 'Star Trek', played: false })
  })

  it('splits a friend with more than 5 questions onto consecutive cards (newest first), 5 max each', () => {
    const qs = Array.from({ length: 7 }, (_, i) =>
      question({ questionId: `q${i}`, domain: `Domain ${i}` }),
    )
    const cards = buildFriendTerritoryCards([milestoneItem('m1', 'robyn', 'Robyn', qs)])
    expect(cards).toHaveLength(2)
    // Both cards are the same friend, consecutive in the stack.
    expect(cards.map((c) => c.friendId)).toEqual(['robyn', 'robyn'])
    // The first card carries the 5 newest; the overflow continues on the next.
    expect(cards[0]!.questions.map((q) => q.questionId)).toEqual([
      'q0', 'q1', 'q2', 'q3', 'q4',
    ])
    expect(cards[1]!.questions.map((q) => q.questionId)).toEqual(['q5', 'q6'])
    // Each card's territory is its own slice — no "+N more" spill.
    expect(cards[0]!.topics).toHaveLength(5)
    expect(cards[1]!.topics).toHaveLength(2)
    // Stacked cards draw distinct ids so React keys (and the status seed) differ.
    expect(cards[0]!.id).not.toBe(cards[1]!.id)
  })

  it('suppresses catch-all categories from the territory list but keeps their questions playable', () => {
    const card = buildFriendTerritoryCards([
      milestoneItem('m1', 'robyn', 'Robyn', [
        question({ questionId: 'q1', domain: 'General Knowledge' }),
        question({ questionId: 'q2', domain: 'Jazz' }),
        question({ questionId: 'q3', domain: null }),
      ]),
    ])[0]!
    expect(card.topics.map((t) => t.name)).toEqual(['Jazz'])
    expect(card.questions).toHaveLength(3)
  })

  it('skips non-milestone rows and empty bundles', () => {
    const empty = milestoneItem('m0', 'robyn', 'Robyn', [])
    const plain: StreamItem = { ...milestoneItem('m9', 'x', 'X', []), expand: null, icon: 'diamond' }
    expect(buildFriendTerritoryCards([empty, plain])).toEqual([])
  })
})

describe('friend-territory status pool — discovery register, person-centric', () => {
  it('never uses winning/scoreboard register and never assumes a pronoun', () => {
    for (const line of FRIEND_TERRITORY_STATUS_LINES) {
      expect(line.toLowerCase()).not.toMatch(
        /unstoppable|on a roll|lighting it up|crush|dominat|beat|nailed|schooled|killing/,
      )
      // No pronoun field exists in the data model, so no line may assume one.
      expect(` ${line.toLowerCase()} `).not.toMatch(/\s(she|her|hers|he|him|his)\s/)
    }
  })

  it('is stable per seed and varies across seeds', () => {
    expect(friendTerritoryStatusLine('robyn:m1')).toBe(friendTerritoryStatusLine('robyn:m1'))
    const distinct = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => friendTerritoryStatusLine(s)),
    )
    expect(distinct.size).toBeGreaterThan(1)
  })
})

describe('FriendTerritoryCard — render', () => {
  const topics = ['Star Trek', 'Mock Trial', 'French Herbs', 'Jazz', 'Cubism']
  const card = () =>
    buildFriendTerritoryCards([
      milestoneItem(
        'm1',
        'robyn',
        'Robyn',
        topics.map((domain, i) =>
          question({
            questionId: `q${i}`,
            domain,
            priorResult: i === 0 ? 'incorrect' : null,
          }),
        ),
      ),
    ])[0]!

  it('shows name, status line, topics, and the forward CTA — never counts or scores', () => {
    const html = renderToStaticMarkup(<FriendTerritoryCard card={card()} />)
    expect(html).toContain('Robyn')
    expect(html).toContain(card().statusLine)
    expect(html).toContain('Play these →')
    // No backward inspection, no scoreboard surface.
    expect(html).not.toMatch(/\d+ of \d+/)
    expect(html).not.toMatch(/See what/i)
    expect(html).not.toMatch(/Correct|Not this time/)
  })

  it('shows every topic on a full 5-question card — no "+N more" fold (overflow goes to the next card)', () => {
    const html = renderToStaticMarkup(<FriendTerritoryCard card={card()} />)
    expect(html).toContain('Jazz')
    expect(html).toContain('Cubism')
    expect(html).not.toMatch(/\+\d+ more/)
  })

  it('renders exactly two triangle states — played (filled) and untried (hollow bordered)', () => {
    const html = renderToStaticMarkup(<FriendTerritoryCard card={card()} />)
    const states = [...html.matchAll(/data-territory-state="(\w+)"/g)].map((m) => m[1])
    expect(states).toEqual(['played', 'untried', 'untried', 'untried', 'untried'])
    expect(new Set(states).size).toBe(2)
  })

  it('a missed question renders the SAME markup as a correct one (no wrong/error marker)', () => {
    const build = (priorResult: 'correct' | 'incorrect') =>
      buildFriendTerritoryCards([
        milestoneItem('m1', 'robyn', 'Robyn', [
          question({ questionId: 'q1', domain: 'Star Trek', priorResult }),
          question({ questionId: 'q2', domain: 'Jazz', priorResult: null }),
        ]),
      ])[0]!
    const asCorrect = renderToStaticMarkup(<FriendTerritoryCard card={build('correct')} />)
    const asIncorrect = renderToStaticMarkup(<FriendTerritoryCard card={build('incorrect')} />)
    expect(asIncorrect).toBe(asCorrect)
  })
})
