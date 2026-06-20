import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import TodaysFiveCard, { type DailyStatus } from '@/components/TodaysFiveCard'

function status(overrides: Partial<DailyStatus> = {}): DailyStatus {
  return {
    questionsRemaining: 0,
    questionsAnswered: 5,
    isComplete: true,
    nextRoundAt: new Date().toISOString(),
    queueId: 'q1',
    slotOutcomes: ['correct', 'correct', 'incorrect', 'correct', 'correct'],
    bonusOutcomes: [],
    ...overrides,
  }
}

const DOT = /class="block rounded-full"/gu

describe('TodaysFiveCard dot track', () => {
  it('no bonus: renders exactly five dots, no separator, no label', () => {
    const html = renderToStaticMarkup(<TodaysFiveCard initialStatus={status()} />)
    expect((html.match(DOT) ?? []).length).toBe(5)
    expect(html).not.toContain('w-px')
    expect(html).not.toContain('friend bonus')
  })

  it('with +2 bonus: renders seven dots, a separator, and the inline label', () => {
    const html = renderToStaticMarkup(
      <TodaysFiveCard initialStatus={status({ bonusOutcomes: ['correct', 'incorrect'] })} />,
    )
    expect((html.match(DOT) ?? []).length).toBe(7)
    expect(html).toContain('w-px')
    expect(html).toContain('+2 friend bonus')
    // Bonus dots are distinguished for assistive tech.
    expect(html).toContain('Bonus 1 of 2, from friends')
    expect(html).toContain('Bonus 2 of 2, from friends')
  })

  it('before the round starts: shows only the five dots, hides the bonus group', () => {
    const html = renderToStaticMarkup(
      <TodaysFiveCard
        initialStatus={status({
          isComplete: false,
          questionsRemaining: 5,
          questionsAnswered: 0,
          queueId: 'q1',
          bonusOutcomes: ['unanswered', 'unanswered'],
        })}
      />,
    )
    expect((html.match(DOT) ?? []).length).toBe(5)
    expect(html).not.toContain('w-px')
    expect(html).not.toContain('friend bonus')
  })

  it('once the round is in progress: reveals the bonus group', () => {
    const html = renderToStaticMarkup(
      <TodaysFiveCard
        initialStatus={status({
          isComplete: false,
          questionsRemaining: 3,
          questionsAnswered: 2,
          queueId: 'q1',
          bonusOutcomes: ['unanswered', 'unanswered'],
        })}
      />,
    )
    expect((html.match(DOT) ?? []).length).toBe(7)
    expect(html).toContain('+2 friend bonus')
  })

  it('the spoken count stays "of 5" even with bonus dots present', () => {
    const html = renderToStaticMarkup(
      <TodaysFiveCard
        initialStatus={status({
          isComplete: false,
          questionsRemaining: 0,
          questionsAnswered: 5,
          bonusOutcomes: ['correct', 'unanswered'],
        })}
      />,
    )
    expect(html).toContain('5 of 5 answered')
    expect(html).not.toContain('of 7')
  })
})
