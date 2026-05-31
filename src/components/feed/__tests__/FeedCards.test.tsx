import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AnsweredByYouCard,
  DirectSentCard,
  FeedCardShell,
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
      'authoredByViewerUnanswered',
    ])
  })

  it('renders the author name, category, and question for each typed Feed card variant', () => {
    const fixtures = feedCardPreviewFixtures

    const directSent = html(<DirectSentCard item={fixtures.directSentUnanswered} />)
    expect(directSent).toContain('Maya')
    expect(directSent).toContain('Food &amp; Drink')
    expect(directSent).toContain('SCOBY')

    const friendAnswered = html(<FriendAnsweredCard item={fixtures.friendAnsweredRight} />)
    expect(friendAnswered).toContain('Noah')
    expect(friendAnswered).toContain('Science')
    expect(friendAnswered).toContain('magnetar')

    const friendAdded = html(<FriendAddedCard item={fixtures.friendAddedWroteQuestion} />)
    expect(friendAdded).toContain('Ari')
    expect(friendAdded).toContain('History')

    const friendLiked = html(<FriendLikedCard item={fixtures.friendLikedShared} />)
    expect(friendLiked).toContain('Sam')
    expect(friendLiked).toContain('Music')

    const answeredByYou = html(<AnsweredByYouCard item={fixtures.answeredByYouCorrect} />)
    expect(answeredByYou).toContain('You both had it')
  })

  it('drops the "has knowledge to share" phrasing from the unanswered question card', () => {
    const variants = [
      html(<DirectSentCard item={feedCardPreviewFixtures.directSentUnanswered} />),
      html(<FriendAnsweredCard item={feedCardPreviewFixtures.friendAnsweredRight} />),
      html(<FriendAddedCard item={feedCardPreviewFixtures.friendAddedWroteQuestion} />),
      html(<FriendLikedCard item={feedCardPreviewFixtures.friendLikedShared} />),
    ]
    for (const rendered of variants) {
      expect(rendered).not.toContain('has knowledge to share')
    }
  })

  it('renders the author name as a link to their profile when authorHref is provided', () => {
    const rendered = html(
      <DirectSentCard item={feedCardPreviewFixtures.directSentUnanswered} />
    )
    expect(rendered).toMatch(/<a[^>]*href="\/users\/maya"[^>]*>Maya<\/a>/)
  })
})

describe('Feed unanswered card actions', () => {
  it('shows the Answer button when onAnswer is provided', () => {
    const rendered = html(
      <DirectSentCard
        item={feedCardPreviewFixtures.directSentUnanswered}
        onAnswer={() => undefined}
      />
    )

    expect(rendered).toContain('Answer →')
    expect(rendered).not.toContain('Skip')
    expect(rendered).not.toContain('Not my focus')
    expect(rendered).not.toContain('Bookmark')
  })

  it('omits Answer button when onAnswer is not provided', () => {
    const rendered = html(
      <DirectSentCard item={feedCardPreviewFixtures.directSentUnanswered} />
    )
    expect(rendered).not.toContain('Answer this')
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
  it('submitting an answer resolves to an answered card with comparison copy', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouCorrect} />
    )

    expect(rendered).toContain('You both had it')
    expect(rendered).toContain('Which city hosted the 1992 Summer Olympics?')
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

  it('reintroduces the personal-message line that the previous redesign dropped', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouWrong} />
    )
    expect(rendered).toContain('I always confuse this one with the Spanish capital.')
  })

  it('renders the "You answered" eyebrow with the italic category', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouCorrect} />
    )
    expect(rendered).toContain('You answered')
    expect(rendered).toContain('Sports')
  })

  it('renders an overlapping pair of avatars when a paired friend is present', () => {
    const rendered = html(
      <AnsweredByYouCard item={feedCardPreviewFixtures.answeredByYouCorrect} />
    )
    // Viewer disc shows "You", friend disc shows initials "JP" (Joshua P).
    expect(rendered).toContain('>You<')
    expect(rendered).toContain('>JP<')
  })

  it('falls back to a single avatar disc when no paired friend is set', () => {
    const rendered = html(
      <AnsweredByYouCard
        item={feedCardPreviewFixtures.unverifiedAnsweredExplanationNote}
      />
    )
    // Only the viewer disc renders; no paired-friend initials.
    expect(rendered).toContain('>You<')
  })

  it('uses the serif slate link recheck action on wrong answers (no boxed button)', () => {
    const recheckAction = { onSubmit: async () => ({ accepted: false, message: '' }) }
    const rendered = html(
      <AnsweredByYouCard
        item={feedCardPreviewFixtures.answeredByYouWrong}
        recheckAction={recheckAction}
      />
    )
    expect(rendered).toContain('Recheck →')
    // Brand action-link treatment (matches "Answer →"): serif, slate, underlined — no offset-shadow box.
    expect(rendered).toContain('text-[var(--brand-link)]')
    expect(rendered).not.toContain('3px 3px 0 var(--ink)')
  })
})

describe('FriendAnsweredCard viewer-already-answered footer', () => {
  it('reframes the header around the viewer when both were correct and uses warm footer copy', () => {
    const rendered = html(
      <FriendAnsweredCard
        item={{
          ...feedCardPreviewFixtures.friendAnsweredRight,
          viewerResult: 'correct',
          friendCorrect: true,
        }}
        onAnswer={() => undefined}
      />
    )
    expect(rendered).toContain('got your Science question')
    expect(rendered).toContain('You both know some Science.')
    expect(rendered).not.toContain('You both had it')
    expect(rendered).not.toContain('Answer →')
  })

  it('renders a "missed your … question" header and "you missed it" footer when viewer was wrong and friend was right', () => {
    const rendered = html(
      <FriendAnsweredCard
        item={{
          ...feedCardPreviewFixtures.friendAnsweredRight,
          viewerResult: 'incorrect',
          friendCorrect: true,
        }}
        onAnswer={() => undefined}
      />
    )
    // Friend was right, so from the viewer's perspective the friend "got" their question.
    expect(rendered).toContain('got your Science question')
    expect(rendered).toContain('Noah knew this')
    expect(rendered).toContain('you missed it')
    expect(rendered).not.toContain('Answer →')
  })

  it('omits the status footer and the reframed header when the viewer has not answered yet', () => {
    const rendered = html(
      <FriendAnsweredCard
        item={feedCardPreviewFixtures.friendAnsweredRight}
        onAnswer={() => undefined}
      />
    )
    expect(rendered).toContain('Answer →')
    expect(rendered).not.toContain('You both had it')
    expect(rendered).not.toContain('You both know some')
    expect(rendered).not.toContain('you missed it')
    expect(rendered).not.toContain('got your Science question')
  })
})

describe('Authored-by-viewer card', () => {
  it('renders the authored attribution and category (Figma triangle card has no eyebrow)', () => {
    const rendered = html(
      <FriendAddedCard
        item={feedCardPreviewFixtures.authoredByViewerUnanswered}
      />
    )
    expect(rendered).toContain('added a question')
    expect(rendered).toContain('Detroit Techno')
  })

  it('renders the identity slot as plain text "You" with no profile link', () => {
    const rendered = html(
      <FriendAddedCard
        item={feedCardPreviewFixtures.authoredByViewerUnanswered}
      />
    )
    expect(rendered).toContain('>You<')
    expect(rendered).not.toMatch(/<a[^>]*>You<\/a>/)
  })

  it('hides the Answer button on authored cards even if onAnswer is provided', () => {
    const rendered = html(
      <FriendAddedCard
        item={feedCardPreviewFixtures.authoredByViewerUnanswered}
        onAnswer={() => undefined}
      />
    )
    expect(rendered).not.toContain('Answer →')
  })
})

describe('FeedCardShell (shared C7 shell)', () => {
  it('renders a top accent bar by default', () => {
    const rendered = html(
      <FeedCardShell accentColor="#abc123">
        <p>body</p>
      </FeedCardShell>
    )
    expect(rendered).toContain('inset-x-0 top-0 h-[2px]')
    expect(rendered).not.toContain('w-[2px]')
    expect(rendered).toContain('background-color:#abc123')
    expect(rendered).toContain('border-[var(--brand-rule)]')
    expect(rendered).toContain('bg-[var(--brand-card)]')
  })

  it('moves the accent bar to the left edge when requested', () => {
    const rendered = html(
      <FeedCardShell accentColor="#abc123" accentPlacement="left">
        <p>body</p>
      </FeedCardShell>
    )
    expect(rendered).toContain('inset-y-0 left-0 w-[2px]')
    expect(rendered).not.toContain('h-[2px]')
  })

  it('omits the accent bar entirely when no color is given', () => {
    const rendered = html(
      <FeedCardShell>
        <p>body</p>
      </FeedCardShell>
    )
    expect(rendered).not.toContain('h-[2px]')
    expect(rendered).not.toContain('w-[2px]')
  })

  it('renders the triangle mat variant with an inset brand-card panel', () => {
    const rendered = html(
      <FeedCardShell variant="triangle">
        <p>body</p>
      </FeedCardShell>
    )
    expect(rendered).toContain('/images/Variant4.png')
    expect(rendered).toContain('bg-[var(--brand-card)]')
    // triangle mat has no hairline border (the mat itself is the frame)
    expect(rendered).not.toContain('border-[var(--brand-rule)]')
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
      'Hide questions about Literature',
      'Hide questions from Maya',
      'Send to friend',
      'Report',
    ])
  })

  it('renders the friend-liked author once on a collapsed multi-endorsement card', () => {
    const rendered = html(
      <FriendLikedCard
        item={feedCardPreviewFixtures.friendLikedCollapsedMultiEndorsement}
      />
    )

    expect(rendered).toContain('Sam')
    expect(rendered).toContain('Music')
  })
})
