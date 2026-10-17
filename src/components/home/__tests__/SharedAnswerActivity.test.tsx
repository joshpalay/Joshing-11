import type * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SharedAnswerActivity as SharedAnswer } from '@/lib/shared-answer-activity'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))
import { SharedAnswerActivity } from '@/components/home/SharedAnswerActivity'

const item: SharedAnswer = {
  questionId: 'q', questionText: 'Who composed the Brandenburg Concertos?', correctAnswer: 'J. S. Bach',
  domain: 'Baroque Music', topic: 'Bach concertos',
  happenedAt: '2026-10-15T12:00:00Z', friends: [{ userId: 'chiann', name: 'Chiann', fromYourFeed: false }],
}
describe('shared-answer presentation', () => {
  it('keeps each friend’s triangle color stable across topics, names, and row order', () => {
    const david = { userId: 'david', name: 'David', fromYourFeed: false }
    const colors = (items: SharedAnswer[]) => [...renderToStaticMarkup(<SharedAnswerActivity items={items} />).matchAll(/href="\/users\/([^\"]+)"[^>]*><svg[^>]*fill="([^\"]+)"/g)].map((match) => [match[1], match[2]])
    const first = colors([item, { ...item, questionId: 'q2', friends: [david] }])
    const reordered = colors([{ ...item, questionId: 'q3', topic: 'Another topic', friends: [david, { ...item.friends[0], name: 'Renamed friend' }] }, item])
    expect(first[0][1]).not.toBe(first[1][1])
    expect(reordered).toEqual([first[1], first[0], first[0]])
  })
  it('shows every question and answer without disclosure controls', () => {
    const html = renderToStaticMarkup(<SharedAnswerActivity items={[item, { ...item, questionId: 'q2', questionText: 'Second question', correctAnswer: 'Second answer' }]} />)
    for (const text of ['rocked ', 'Bach concertos', item.questionText, item.correctAnswer, 'Second question', 'Second answer', 'href="/users/chiann"']) expect(html).toContain(text)
    expect(html).not.toMatch(/<details|\shidden(?:=|\s|>)|independently/)
    expect(html.match(/aria-label="Send to a friend"/g)).toHaveLength(2)
  })
  it('names different topics while retaining profile links and send buttons', () => {
    const html = renderToStaticMarkup(<SharedAnswerActivity items={[item, {
      ...item, questionId: 'kangaroo', topic: 'kangaroo knowledge',
      questionText: 'What is a baby kangaroo called?', correctAnswer: 'A joey',
    }]} />)
    expect(html).toContain('Bach concertos')
    expect(html).toContain('kangaroo knowledge')
    expect(html).not.toContain('rocked this')
    expect(html.split('href="/users/chiann"').length - 1).toBe(2)
    expect(html.match(/aria-label="Send to a friend"/g)).toHaveLength(2)
    expect(html).toContain('A joey')
  })
  it('falls back to the real domain or a neutral phrase when topic metadata is missing', () => {
    expect(renderToStaticMarkup(<SharedAnswerActivity items={[{ ...item, topic: null }]} />)).toContain('Baroque Music')
    expect(renderToStaticMarkup(<SharedAnswerActivity items={[{ ...item, topic: null, domain: null }]} />)).toContain('this one')
  })
  it('labels confirmed feed origin and provides a quiet empty state', () => {
    const html = renderToStaticMarkup(<SharedAnswerActivity items={[{ ...item, friends: [{ ...item.friends[0], fromYourFeed: true }] }]} />)
    expect(html).toContain('rocked ')
    expect(html).toContain('Bach concertos')
    expect(html).toContain(' too.')
    expect(html).toContain('From your feed.')
    expect(html).not.toContain('You and')
    expect(renderToStaticMarkup(<SharedAnswerActivity items={[]} />)).toContain('No new shared answers this week.')
  })
})
