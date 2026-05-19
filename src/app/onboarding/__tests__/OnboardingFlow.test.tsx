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
        initialDisplayName="Returning User"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
        ]}
      />
    )

    expect(html).toContain('Alex Inviter suggested these for you.')
    expect(html).toContain('Sondheim')
  })

  it("renders Josh as Jaime's inviter with all three suggested interests", () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Josh"
        initialDisplayName="Returning User"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
          { domain: 'Jazz', broadCategory: 'Music', rationale: null },
          { domain: 'Poetry', broadCategory: 'Literature', rationale: null },
        ]}
      />
    )

    expect(html).toContain('Josh suggested these for you.')
    expect(html).toContain('Sondheim')
    expect(html).toContain('Jazz')
    expect(html).toContain('Poetry')
  })

  it('uses friend fallback when inviter name is unavailable', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName={null}
        initialDisplayName="Returning User"
        preSeededInterests={[
          { domain: 'Jazz', broadCategory: 'Music', rationale: null },
        ]}
      />
    )

    expect(html).toContain('A friend suggested these for you.')
  })

  it('still renders regular onboarding with no invite', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow preSeededInterests={[]} initialDisplayName="Returning User" />
    )

    expect(html).toContain('Welcome to Joshing')
    expect(html).not.toContain('suggested these for you.')
  })
})

describe('OnboardingFlow display-name gate', () => {
  it('renders the name step first when no displayName is set', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
        ]}
        inviterName="Alex Inviter"
      />
    )

    expect(html).toContain('What should we call you?')
    expect(html).not.toContain('suggested these for you.')
  })

  it('prefills the input with the invitee name from the invitation', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        inviterName="Alex Inviter"
        inviteeDisplayName="Morgan Lee"
      />
    )

    expect(html).toContain('What should we call you?')
    expect(html).toContain('value="Morgan Lee"')
    expect(html).toContain('Alex Inviter')
  })

  it('uses the generic subtitle when no inviteeDisplayName is provided', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow preSeededInterests={[]} inviterName={null} />
    )

    expect(html).toContain('What should we call you?')
    expect(html).toContain("This is how you&#x27;ll appear to friends.")
  })

  it('skips the name step when the user already has a displayName', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        initialDisplayName="Existing Name"
      />
    )

    expect(html).not.toContain('What should we call you?')
    expect(html).toContain('Welcome to Joshing')
  })
})
