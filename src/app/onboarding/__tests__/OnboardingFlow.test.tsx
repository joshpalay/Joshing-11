import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import OnboardingFlow, { OnboardingReminderStep } from '@/app/onboarding/OnboardingFlow'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

describe('Onboarding reminder choice', () => {
  it('offers the SMS reminder primary action and the decline button', () => {
    const html = renderToStaticMarkup(
      <OnboardingReminderStep
        phoneNumber="+17345550123"
        topics={['Sondheim', 'Jazz']}
        saving={false}
        error={null}
        onContinueWithReminders={vi.fn()}
        onContinueWithoutReminders={vi.fn()}
      />
    )

    expect(html).toContain('We’re writing your first five.')
    expect(html).toContain('Text me when they open')
    expect(html).toContain('I’ll check back on my own')
    expect(html).toContain('(734) 555-0123')
    expect(html).toContain('automated Joshing reminder texts')
    expect(html).toContain('Sondheim')
    expect(html).toContain('Jazz')
    expect(html).not.toContain('Email me')
    // No duration claim — the crafting screen that follows proves the wait
    // rather than the copy asserting a length for it.
    expect(html).not.toMatch(/minute|second/i)
  })
})

describe('OnboardingFlow invited interests', () => {
  it('pre-selects a seeded interest on the interests step', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Alex Inviter"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
        ]}
      />
    )

    expect(html).toContain('Welcome to Joshing')
    expect(html).toContain('Your trivia questions will come from these subjects')
    expect(html).toContain('1 selected · pick at least 2 more')
    expect(html).toContain('Sondheim')
  })

  it('pre-selects all three seeded interests', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Josh"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
          { domain: 'Jazz', broadCategory: 'Music', rationale: null },
          { domain: 'Poetry', broadCategory: 'Literature', rationale: null },
        ]}
      />
    )

    expect(html).toContain('Your trivia questions will come from these subjects')
    expect(html).toContain('3 selected · add up to 9 more')
    expect(html).toContain('Sondheim')
    expect(html).toContain('Jazz')
    expect(html).toContain('Poetry')
  })

  it('lands setup-skipping users on the interests step with nothing seeded', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        initialDisplayName="Returning User"
        initialHandle="returninguser"
      />
    )

    expect(html).toContain('Welcome to Joshing')
    expect(html).toContain('0 selected')
    expect(html).not.toContain('suggested these for you.')
  })
})

// Stage 2 (invite-link seed topics): link-sourced seeds must render as
// unselected suggestion chips, never pre-populate the selection the way a
// named invite's seeds do — a link may reach someone the inviter never had in
// mind.
describe('OnboardingFlow seedSource = link', () => {
  it('renders link-sourced topics unselected, not pre-selected', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        seedSource="link"
        inviterName="Josh"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
          { domain: 'Jazz', broadCategory: 'Music', rationale: null },
        ]}
      />
    )

    // Counter reads 0 selected, not 2 — the topics are offered, not chosen.
    expect(html).toContain('0 selected')
    expect(html).not.toContain('2 selected')
    // Still surfaced as suggestion chips the invitee can tap to add.
    expect(html).toContain('Sondheim')
    expect(html).toContain('Jazz')
    // Link-specific framing, not the named-invite "we picked for you" copy.
    expect(html).toContain('Here are a few from Josh')
    expect(html).not.toContain('Here are some topics we picked for you')
  })

  it('a named invite (default seedSource) still pre-selects, for contrast', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Josh"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
          { domain: 'Jazz', broadCategory: 'Music', rationale: null },
        ]}
      />
    )

    expect(html).toContain('2 selected · pick at least 1 more')
    expect(html).toContain('Here are some topics we picked for you')
  })
})

describe('OnboardingFlow display-name gate', () => {
  it('renders the setup step first when no displayName is set', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
        ]}
        inviterName="Alex Inviter"
      />
    )

    expect(html).toContain('Set up your profile')
    expect(html).not.toContain('suggested these for you.')
  })

  it('prefills the name input with the invitee name the inviter entered', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        inviterName="Alex Inviter"
        inviteeDisplayName="Morgan Lee"
      />
    )

    expect(html).toContain('Set up your profile')
    expect(html).toContain('value="Morgan Lee"')
    // The subtitle attributes the pre-filled name to the inviter.
    expect(html).toContain('Alex Inviter')
  })

  it('uses the generic subtitle when no inviteeDisplayName is provided', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow preSeededInterests={[]} inviterName={null} />
    )

    expect(html).toContain('Set up your profile')
    expect(html).toContain('Pick the name friends see')
  })

  it('skips the setup step when the user already has a displayName and handle', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        initialDisplayName="Existing Name"
        initialHandle="existingname"
      />
    )

    expect(html).not.toContain('Set up your profile')
    expect(html).toContain('Welcome to Joshing')
  })

  it('hints that the add-topic field accepts several comma-separated topics', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        initialDisplayName="Existing Name"
        initialHandle="existingname"
      />
    )

    expect(html).toContain('separated by commas')
  })
})
