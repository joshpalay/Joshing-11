import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import OnboardingFlow, {
  OnboardingReminderScreen,
  OnboardingReminderStep
} from '@/app/onboarding/OnboardingFlow'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))

describe('Onboarding reminder choice', () => {
  it('offers the SMS reminder primary action and the decline button', () => {
    const html = renderToStaticMarkup(
      <OnboardingReminderStep
        displayName="Kiki"
        phoneNumber="+17345550123"
        saving={false}
        error={null}
        onContinueWithReminders={vi.fn()}
        onContinueWithoutReminders={vi.fn()}
      />
    )

    expect(html).toContain('Kiki, we’re writing your first five.')
    expect(html).toContain('Text me when they open')
    expect(html).toContain('I’ll check back on my own')
    expect(html).toContain('(734) 555-0123')
    expect(html).toContain('automated Joshing reminder texts')
    expect(html).not.toContain('<ul')
    expect(html).not.toContain('Email me')
    // No duration claim — the crafting screen that follows proves the wait
    // rather than the copy asserting a length for it.
    expect(html).not.toMatch(/minute|second/i)
  })

  it('places the reminder choice on the animated loading tile field', () => {
    const html = renderToStaticMarkup(
      <OnboardingReminderScreen
        displayName="Kiki"
        phoneNumber="+17345550123"
        saving={false}
        error={null}
        onContinueWithReminders={vi.fn()}
        onContinueWithoutReminders={vi.fn()}
      />
    )

    expect(html).toContain('triangle-loader-tri')
    expect(html).toContain('triangle-loader-grain')
    expect(html).toContain('Kiki, we’re writing your first five.')
    expect(html).toContain('Text me when they open')
  })
})

describe('OnboardingFlow invited interests', () => {
  it('pre-selects a seeded interest on the interests step', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Alex Inviter"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[{ domain: 'Sondheim', broadCategory: 'Theater', rationale: null }]}
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
          { domain: 'Poetry', broadCategory: 'Literature', rationale: null }
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

// Stage 2 (invite-link seed topics): link-sourced seeds now pre-select just
// like a named invite's — the invitee shouldn't have to tap every suggestion
// just to accept the defaults. They're still ordinary toggle chips (see
// InterestToggleChip), so removing one shows "Removed … Undo" in place rather
// than moving it to a separate list.
describe('OnboardingFlow seedSource = link', () => {
  it('pre-selects Duo Prova’s link-sourced topics too, above Add your own', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        seedSource="link"
        inviterName="Duo Prova"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[
          { domain: 'Great Lakes shipwrecks', broadCategory: 'History', rationale: null },
          { domain: 'Renaissance Florence', broadCategory: 'History', rationale: null },
          { domain: 'Final Fantasy', broadCategory: 'Games', rationale: null }
        ]}
      />
    )

    // Counter reads 3 selected — the topics arrive pre-chosen, not just offered.
    expect(html).toContain('3 selected · add up to 9 more')
    expect(html).not.toContain('0 selected')
    expect(html).toContain('Great Lakes shipwrecks')
    expect(html).toContain('Renaissance Florence')
    expect(html).toContain('Final Fantasy')
    expect(html).toContain(
      'Duo Prova picked these for you. Take any that feel right, or remove what doesn&#x27;t fit.'
    )
    expect(html).toContain('aria-label="Remove Great Lakes shipwrecks"')
    expect(html.indexOf('Your trivia questions will come from these subjects')).toBeLessThan(
      html.indexOf('Add your own')
    )
    // Link-specific welcome framing remains intact.
    expect(html).toContain('Here are a few from Duo Prova')
    expect(html).not.toContain('Here are some topics we picked for you')
  })

  it('falls back to "A friend" when no inviter name is available', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        seedSource="link"
        inviterName={null}
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[{ domain: 'Sondheim', broadCategory: 'Theater', rationale: null }]}
      />
    )

    expect(html).toContain('A friend picked these for you')
    expect(html).toContain('1 selected')
    expect(html).not.toContain('undefined')
  })

  it('a named invite (default seedSource) also pre-selects', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        inviterName="Josh"
        initialDisplayName="Returning User"
        initialHandle="returninguser"
        preSeededInterests={[
          { domain: 'Sondheim', broadCategory: 'Theater', rationale: null },
          { domain: 'Jazz', broadCategory: 'Music', rationale: null }
        ]}
      />
    )

    expect(html).toContain('2 selected · pick at least 1 more')
    expect(html).toContain('Here are some topics we picked for you')
    expect(html).toContain('aria-label="Remove Sondheim"')
    expect(html).toContain('aria-label="Remove Jazz"')
  })
})

describe('OnboardingFlow display-name gate', () => {
  it('renders the setup step first when no displayName is set', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[{ domain: 'Sondheim', broadCategory: 'Theater', rationale: null }]}
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
    const html = renderToStaticMarkup(<OnboardingFlow preSeededInterests={[]} inviterName={null} />)

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

  it('keeps the standard non-invitation topic entry experience unchanged', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        preSeededInterests={[]}
        initialDisplayName="Existing Name"
        initialHandle="existingname"
      />
    )

    expect(html).toContain(
      'A trivia game built for you. Add a few topics you&#x27;d want questions about, and we&#x27;ll build your first round from them.'
    )
    expect(html).toContain('Add your own')
    expect(html).toContain(
      'Add anything: a book, musician, team, era, show, place, person, or theory…'
    )
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Add<\/button>/)
    expect(html).not.toContain('Suggested by')
    expect(html).not.toContain('Suggested for you')
    expect(html.indexOf('Your trivia questions will come from these subjects')).toBeLessThan(
      html.indexOf('Add your own')
    )
  })
})
