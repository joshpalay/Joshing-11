import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import OnboardingFlow from '@/app/onboarding/OnboardingFlow'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

describe('OnboardingFlow invited-interest copy', () => {
  it('names the inviter when available', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Alex Inviter"
        preSeededInterests={[{ domain: 'Sondheim', broadCategory: 'Theater', rationale: null }]}
      />,
    )

    expect(html).toContain('Alex Inviter thought you might like:')
    expect(html).toContain('Sondheim')
    expect(html).toContain("They&#x27;re preselected, but you can edit, remove, or skip them before anything is saved.")
  })

  it('uses friend fallback when inviter name is unavailable', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName={null}
        preSeededInterests={[{ domain: 'Jazz', broadCategory: 'Music', rationale: null }]}
      />,
    )

    expect(html).toContain('A friend thought you might like:')
  })

  it('still renders regular onboarding with no invite', () => {
    const html = renderToStaticMarkup(<OnboardingFlow preSeededInterests={[]} />)

    expect(html).toContain('The trivia you wish you were asked.')
    expect(html).not.toContain('thought you might like:')
  })
})
