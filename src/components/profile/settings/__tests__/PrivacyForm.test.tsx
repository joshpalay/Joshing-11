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
// simulation installed).
describe('PrivacyForm', () => {
  it('renders the discovery toggles and points invite-link management at Friends', () => {
    const html = renderToStaticMarkup(<PrivacyForm initialState={baseState} />)

    expect(html).toContain('Match my phone contacts')
    expect(html).toContain('Suggest me through mutual friends')
    expect(html).toContain('Invite links')
    expect(html).toContain('href="/friends"')
    // The old single-token rotate/copy UI and the standalone topic editor are
    // gone — link creation, tagging, deletion, and topic editing all moved
    // onto the consolidated Friends page (B-FRIENDS-INVITE-LINKS-01).
    expect(html).not.toContain('Rotate link')
    expect(html).not.toContain('Topics your link shows')
  })
})
