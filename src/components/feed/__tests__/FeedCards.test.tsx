import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AnswerForm,
  AnsweredByYouCard,
  DirectSentCard,
  FeedOverflowMenu,
  FriendAddedCard,
  FriendAnsweredCard,
  FriendLikedCard,
  UnansweredFeedActions,
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

  it('renders each typed Feed card variant without changing the fixture discriminant', () => {
    const fixtures = feedCardPreviewFixtures
    expect(
      html(<DirectSentCard item={fixtures.directSentUnanswered} />)
    ).toContain('For you')
    expect(
      html(<FriendAnsweredCard item={fixtures.friendAnsweredRight} />)
    ).toContain('Friend answered')
    expect(
      html(<FriendAddedCard item={fixtures.friendAddedWroteQuestion} />)
    ).toContain('New question')
    expect(
      html(<FriendLikedCard item={fixtures.friendLikedShared} />)
    ).toContain('Friend liked')
    expect(
      html(<AnsweredByYouCard item={fixtures.answeredByYouCorrect} />)
    ).toContain('+5 points')
  })
})

describe('Feed unanswered card actions', () => {
  it('shows Answer plus overflow only in the inline action row', () => {
    const rendered = html(
      <DirectSentCard
        item={feedCardPreviewFixtures.directSentUnanswered}
        actions={
          <UnansweredFeedActions
            onAnswer={() => undefined}
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
        }
      />
    )

    expect(rendered).toContain('Answer')
    expect(rendered).toContain('More Feed actions')
    expect(rendered).not.toContain('Send to friend')
    expect(rendered).not.toContain('Skip')
    expect(rendered).not.toContain('Not my focus')
    expect(rendered).not.toContain('Bookmark')
  })

  it('uses the answering fixture state to expand the inline answer input', () => {
    const rendered = html(
      <DirectSentCard
        item={feedCardPreviewFixtures.directSentUnanswered}
        actions={
          <AnswerForm
            value="kombucha"
            onChange={() => undefined}
            onSubmit={() => undefined}
            onCancel={() => undefined}
          />
        }
      />
    )

    expect(rendered).toContain('Your answer...')
    expect(rendered).toContain('Submit answer')
    expect(rendered).toContain('Cancel')
  })
})

describe('Feed answered states', () => {
  it('submitting an answer resolves to an answered card with the correct answer copy', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouCorrect} />
    )

    expect(rendered).toContain('Correct answer:')
    expect(rendered).toContain('Barcelona')
    expect(rendered).toContain('+5 points')
    expect(rendered).toContain('Feed answer progress')
  })

  it('wrong answers use neutral missed-question copy and avoid red Feed styling', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouWrong} />
    )

    expect(rendered).toContain('Added to your missed questions')
    expect(rendered).not.toContain('bg-red')
    expect(rendered).not.toContain('text-red')
    expect(rendered).not.toContain('destructive')
  })

  it('shows unverified answer and explanation notes', () => {
    const rendered = html(
      <AnsweredByYouCard
        item={feedCardPreviewFixtures.unverifiedAnsweredExplanationNote}
      />
    )

    expect(rendered).toContain('LLM answer — unverified.')
    expect(rendered).toContain('Explanation is pending verification')
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
