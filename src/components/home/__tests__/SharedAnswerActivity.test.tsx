import type * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SharedAnswerActivity as SharedAnswer } from '@/lib/shared-answer-activity'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))
import { SharedAnswerActivity } from '@/components/home/SharedAnswerActivity'

const item: SharedAnswer = {
  questionId: 'q', questionText: 'Who composed the Brandenburg Concertos?', correctAnswer: 'J. S. Bach',
  happenedAt: '2026-10-15T12:00:00Z', friends: [{ userId: 'chiann', name: 'Chiann', fromYourFeed: false }],
}
describe('shared-answer presentation', () => {
  it('shows every question and answer without disclosure controls', () => {
    const html = renderToStaticMarkup(<SharedAnswerActivity items={[item, { ...item, questionId: 'q2', questionText: 'Second question', correctAnswer: 'Second answer' }]} />)
    for (const text of ['both rocked this.', item.questionText, item.correctAnswer, 'Second question', 'Second answer', 'href="/users/chiann"']) expect(html).toContain(text)
    expect(html).not.toMatch(/<details|\shidden(?:=|\s|>)|independently/)
    expect(html.match(/aria-label="Send to a friend"/g)).toHaveLength(2)
  })
  it('labels confirmed feed origin and provides a quiet empty state', () => {
    const html = renderToStaticMarkup(<SharedAnswerActivity items={[{ ...item, friends: [{ ...item.friends[0], fromYourFeed: true }] }]} />)
    expect(html).toContain('nailed this too.')
    expect(html).toContain('From your feed.')
    expect(html).not.toContain('You and')
    expect(renderToStaticMarkup(<SharedAnswerActivity items={[]} />)).toContain('No new shared answers this week.')
  })
})
