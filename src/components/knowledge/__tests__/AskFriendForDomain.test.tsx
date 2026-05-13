import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  AskFriendForDomain,
  buildDomainAskMessage,
  normalizeInterestList,
} from '@/components/knowledge/AskFriendForDomain'

const noop = () => undefined

describe('Knowledge-page Ask a friend integration', () => {
  it('renders the Ask a friend modal with the domain as the leading suggested interest', () => {
    const html = renderToStaticMarkup(
      <AskFriendForDomain
        domain="Italian Renaissance painting"
        onClose={noop}
      />
    )

    expect(html).toContain('Ask a friend about Italian Renaissance painting')
    expect(html).toContain(
      'Suggested interests start with Italian Renaissance painting'
    )
    expect(html).toContain('Existing friend')
    expect(html).toContain('New friend')
    expect(html).not.toMatch(/leaderboard|ranking|score|points?|percent|%/i)
  })

  it('dedupes and caps suggested interests for the new-friend invite path with domain first', () => {
    expect(
      normalizeInterestList([
        'Italian Renaissance painting',
        'Jazz',
        'italian renaissance painting',
        'Poetry',
        'Film',
      ])
    ).toEqual(['Italian Renaissance painting', 'Jazz', 'Poetry'])
  })

  it('builds existing-friend and new-friend handoff messages without AI filler or gamification language', () => {
    const existingFriendMessage = buildDomainAskMessage('Film noir')
    const newFriendMessage = buildDomainAskMessage(
      'Film noir',
      'https://joshing.example/invite/token-1'
    )

    expect(existingFriendMessage).toContain('Film noir')
    expect(existingFriendMessage).not.toContain('/invite/')
    expect(newFriendMessage).toContain('https://joshing.example/invite/token-1')
    expect(`${existingFriendMessage} ${newFriendMessage}`).not.toMatch(
      /leaderboard|ranking|score|points?|percent|%|AI-generated|placeholder/i
    )
  })
})
