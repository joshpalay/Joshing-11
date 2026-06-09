import { describe, expect, it } from 'vitest'

import { milestoneToStreamItem, type StreamQuestion } from '@/lib/activity-stream'
import type { MilestoneBreadth } from '@/lib/lately-milestones'

// The breadth milestone header must name only domains whose questions survived
// resolution — a question can be deleted/hidden after the friend answered it, and
// the header should never claim a domain the expansion can't show.

function lineText(parts: { v?: string; name?: string }[]): string {
  return parts.map((p) => p.v ?? p.name ?? '').join('')
}

function breadth(): MilestoneBreadth {
  return {
    kind: 'milestone_breadth',
    id: 'breadth:f1:0',
    friendId: 'f1',
    friendName: 'Sadie',
    friendFirstName: 'Sadie',
    domains: [
      { domain: 'Harry Potter', questionIds: ['q-hp'], correctCount: 1 },
      { domain: 'Progressive Politics', questionIds: ['q-pol'], correctCount: 1 },
    ],
    questionIds: ['q-hp', 'q-pol'],
    sortAt: new Date('2026-06-01T00:00:00Z'),
  }
}

function question(id: string): StreamQuestion {
  return { questionId: id, text: `Q ${id}`, domain: null, priorResult: null }
}

describe('milestoneToStreamItem breadth header', () => {
  it('names both domains when both questions survive', () => {
    const item = milestoneToStreamItem(breadth(), [question('q-hp'), question('q-pol')])
    const text = lineText(item.line)
    expect(text).toContain('Harry Potter')
    expect(text).toContain('Progressive Politics')
  })

  it('drops a domain whose question did not survive resolution', () => {
    // Only the Harry Potter question resolved; the politics question was deleted.
    const item = milestoneToStreamItem(breadth(), [question('q-hp')])
    const text = lineText(item.line)
    expect(text).toContain('Harry Potter')
    expect(text).not.toContain('Progressive Politics')
  })
})
