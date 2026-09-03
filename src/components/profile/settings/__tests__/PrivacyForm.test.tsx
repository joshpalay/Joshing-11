import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PrivacyForm } from '@/components/profile/settings/PrivacyForm'
import type { DiscoverabilityState } from '@/server/db/queries/account'

const baseState: DiscoverabilityState = {
  discoverableByContacts: false,
  discoverableByMutualFriends: false,
  discoverableByNicheMatch: false,
}

// Static-render coverage only, matching this codebase's component-test
// convention (renderToStaticMarkup, no @testing-library/react / jsdom event
// simulation installed) — the add/remove/save interactions themselves are
// exercised by src/app/api/account/invite-token/topics/__tests__/route.test.ts
// (the endpoint this form calls) rather than by clicking through the UI here.
describe('PrivacyForm invite-link topic editor', () => {
  it('renders the seeded curated topics as chips', () => {
    const html = renderToStaticMarkup(
      <PrivacyForm
        initialState={baseState}
        initialInviteUrl="https://example.com/u/josh/tok"
        initialSeedTopics={['Jazz', 'Poetry']}
      />,
    )

    expect(html).toContain('Topics your link shows')
    expect(html).toContain('Jazz')
    expect(html).toContain('Poetry')
    expect(html).toContain('Save topics')
    // Add input still offered — under the 3-topic cap.
    expect(html).toContain('Add a topic')
  })

  it('hides the add-topic input once the 3-topic cap is reached', () => {
    const html = renderToStaticMarkup(
      <PrivacyForm
        initialState={baseState}
        initialInviteUrl="https://example.com/u/josh/tok"
        initialSeedTopics={['Jazz', 'Poetry', 'Chess']}
      />,
    )

    expect(html).toContain('Jazz')
    expect(html).toContain('Poetry')
    expect(html).toContain('Chess')
    expect(html).not.toContain('Add a topic')
  })

  it('renders no chips and offers the add input when nothing is curated', () => {
    const html = renderToStaticMarkup(
      <PrivacyForm
        initialState={baseState}
        initialInviteUrl="https://example.com/u/josh/tok"
        initialSeedTopics={[]}
      />,
    )

    expect(html).toContain('Topics your link shows')
    expect(html).toContain('Add a topic')
    expect(html).toContain('automatically use your own top topics')
  })

  it('renders nothing invite-related when there is no invite URL yet', () => {
    const html = renderToStaticMarkup(
      <PrivacyForm initialState={baseState} initialInviteUrl={null} initialSeedTopics={[]} />,
    )

    expect(html).not.toContain('Your invite link')
    expect(html).not.toContain('Topics your link shows')
  })
})
