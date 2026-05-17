import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AnsweredByYouCard,
  DirectSentCard,
  FeedOverflowMenu,
  FriendAddedCard,
  FriendAnsweredCard,
  FriendLikedCard,
  feedCardPreviewFixtures,
  getFeedOverflowMenuLabels,
  visibleFeedCategory,
} from '@/components/feed'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('lucide-react', () => ({
  Flag: () => <span aria-hidden="true" />,
  MoreHorizontal: () => <span aria-hidden="true">⋯</span>,
  X: () => <span aria-hidden="true" />,
}))

vi.mock('@/components/AddToBankAction', () => ({
  AddToBankAction: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}))

vi.mock('@/components/SendQuestionAction', () => ({
  SendQuestionAction: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}))

function html(node: React.ReactElement) {
  return renderToStaticMarkup(node)
}

describe('Feed card preview fixtures', () => {
  it('covers every requested typed card state', () => {
    expect(Object.keys(feedCardPreviewFixtures)).toEqual([
      'directSentUnanswered',
      'friendAnsweredRight',
      'friendAddedWroteQuestion',
      'friendLikedShared',
      'friendLikedCollapsedMultiEndorsement',
      'answeredByYouCorrect',
      'answeredByYouWrong',
      'missingSuppressedCategory',
      'alreadyBankedItem',
      'unverifiedAnsweredExplanationNote',
    ])
  })

  it('renders each typed Feed card variant with social signal text', () => {
    const fixtures = feedCardPreviewFixtures
    expect(
      html(<DirectSentCard item={fixtures.directSentUnanswered} />)
    ).toContain("thought you")
    expect(
      html(<FriendAnsweredCard item={fixtures.friendAnsweredRight} />)
    ).toContain('recognized this one')
    expect(
      html(<FriendAddedCard item={fixtures.friendAddedWroteQuestion} />)
    ).toContain('added a question')
    expect(
      html(<FriendLikedCard item={fixtures.friendLikedShared} />)
    ).toContain('liked this question')
    expect(
      html(<AnsweredByYouCard item={fixtures.answeredByYouCorrect} />)
    ).toContain('You both had it')
  })
})

describe('Feed unanswered card actions', () => {
  it('shows Answer button in the card bottom strip when onAnswer is provided', () => {
    const rendered = html(
      <DirectSentCard
        item={feedCardPreviewFixtures.directSentUnanswered}
        onAnswer={() => undefined}
      />
    )

    expect(rendered).toContain('Answer')
    expect(rendered).not.toContain('Skip')
    expect(rendered).not.toContain('Not my focus')
    expect(rendered).not.toContain('Bookmark')
  })

  it('omits Answer button when onAnswer is not provided', () => {
    const rendered = html(
      <DirectSentCard item={feedCardPreviewFixtures.directSentUnanswered} />
    )
    expect(rendered).not.toContain('Answer →')
  })

  it('shows overflow menu when passed', () => {
    const rendered = html(
      <DirectSentCard
        item={feedCardPreviewFixtures.directSentUnanswered}
        overflow={
          <FeedOverflowMenu
            sourceName="Maya"
            category="Food & Drink"
            question={{
              id: 'question-1',
              text: 'Question?',
              domain: 'Food & Drink',
            }}
          />
        }
      />
    )
    expect(rendered).toContain('More Feed actions')
    expect(rendered).not.toContain('Send to friend')
  })
})

describe('Feed answered states', () => {
  it('submitting an answer resolves to an answered card with comparison copy and correct answer', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouCorrect} />
    )

    expect(rendered).toContain('You both had it')
    expect(rendered).toContain('Barcelona')
  })

  it('shows the knowledge-gain circle (no raw points pill) on a correct answer that crosses a tier', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouCorrect} />
    )

    expect(rendered).not.toContain('+5 pts')
    expect(rendered).toContain('+ Knowledge in Sports')
    expect(rendered).toContain('Familiar → Solid')
  })

  it('correct answers without a tier change show the circle but no tier subtitle', () => {
    const rendered = html(
      <AnsweredByYouCard
        item={feedCardPreviewFixtures.unverifiedAnsweredExplanationNote}
      />
    )

    expect(rendered).toContain('+ Knowledge in Film')
    expect(rendered).not.toMatch(/→/)
  })

  it('wrong answers show correct answer, avoid red Feed styling, and skip the knowledge circle', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouWrong} />
    )

    expect(rendered).toContain('Lisbon')
    expect(rendered).not.toContain('bg-red')
    expect(rendered).not.toContain('text-red')
    expect(rendered).not.toContain('destructive')
    expect(rendered).not.toContain('+ Knowledge')
  })
})

describe('Feed card category and overflow affordances', () => {
  it('omits suppressed category labels', () => {
    expect(
      visibleFeedCategory(
        feedCardPreviewFixtures.missingSuppressedCategory.category
      )
    ).toBeNull()
    expect(
      html(
        <FriendAddedCard
          item={feedCardPreviewFixtures.missingSuppressedCategory}
        />
      )
    ).not.toContain('GENERAL KNOWLEDGE')
  })

  it('omits Add to bank from overflow choices for already-banked questions', () => {
    expect(
      getFeedOverflowMenuLabels({
        sourceName: 'Maya',
        category: 'Literature',
        hasQuestion: true,
        isInBank: true,
      })
    ).toEqual([
      'Hide this category',
      'Hide questions from Maya',
      'Send to friend',
      'Report',
    ])
  })

  it('renders collapsed multi-endorsement friend-liked copy', () => {
    const rendered = html(
      <FriendLikedCard
        item={feedCardPreviewFixtures.friendLikedCollapsedMultiEndorsement}
      />
    )

    expect(rendered).toContain('Sam')
    expect(rendered).toContain('2 friends liked this question')
    expect(rendered).toContain('Lena, Kai')
  })
})
