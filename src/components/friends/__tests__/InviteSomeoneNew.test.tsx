import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { InviteSomeoneNew } from '@/components/friends/InviteSomeoneNew'

// Stage 3 (B-Friends-3): the invite link is the default placement — verify
// its button carries the primary emphasis and the phone path stays reachable
// as the secondary action, not removed. Interactive behavior (navigator.share,
// the clipboard fallback, the AbortError-is-not-an-error path) isn't covered
// here: this codebase's component tests are static renderToStaticMarkup only
// (no @testing-library/react / jsdom event simulation installed), so those
// paths were verified by reading the implementation and manually in a
// browser rather than via an automated click.
describe('InviteSomeoneNew', () => {
  it('renders the invite link as the primary action, phone invite as secondary', () => {
    const html = renderToStaticMarkup(<InviteSomeoneNew />)

    expect(html).toContain('Share invite link')
    expect(html).toContain('Text a personal invite')

    const shareButtonIndex = html.indexOf('Share invite link')
    const shareButtonOpenTag = html.lastIndexOf('<button', shareButtonIndex)
    const personalButtonIndex = html.indexOf('Text a personal invite')
    const personalButtonOpenTag = html.lastIndexOf('<button', personalButtonIndex)

    expect(html.slice(shareButtonOpenTag, shareButtonIndex)).toContain('btn-primary')
    expect(html.slice(personalButtonOpenTag, personalButtonIndex)).toContain('btn-ghost')
  })

  it('does not render a topic count before the invite link has loaded', () => {
    const html = renderToStaticMarkup(<InviteSomeoneNew />)

    expect(html).not.toContain('Your link shows')
  })
})
