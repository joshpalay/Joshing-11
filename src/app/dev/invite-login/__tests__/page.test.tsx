import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
}))

import DevInviteLoginPage from '@/app/dev/invite-login/page'

// Stage 6: the ?screen=linkCard param (linked from the Growth dev-tools
// group) must land directly on the invite-LINK preview tab — no phone field,
// synthetic topic chips instead.
describe('DevInviteLoginPage', () => {
  it('defaults to the named phone-first tab when no ?screen param is set', () => {
    searchParams.delete('screen')
    const html = renderToStaticMarkup(<DevInviteLoginPage />)

    expect(html).toContain('aria-selected="true"')
    // The named (invitePrefill) path shows a specific number to confirm, not
    // the generic "what is your number" entry.
    expect(html).toContain('We just need to send a text to confirm it')
    expect(html).toContain('(734) 555-6819')
  })

  it('lands on the invite-link card tab via ?screen=linkCard, with topic chips and no known number to confirm', () => {
    searchParams.set('screen', 'linkCard')
    const html = renderToStaticMarkup(<DevInviteLoginPage />)

    // inviterFirstName() truncates to the first token.
    expect(html).toContain('Robyn invited you to Joshing')
    expect(html).toContain('Jazz')
    expect(html).toContain('Chess Openings')
    expect(html).toContain('1990s Sitcoms')
    // No invitePrefill on this tab, so the number-to-confirm screen never
    // renders — only the generic phone-entry form does (a link visitor's
    // number isn't known ahead of time, unlike a named invite).
    expect(html).not.toContain('(734) 555-6819')
    expect(html).toContain('What is your phone number?')
  })

  it('ignores an unrecognized ?screen value and falls back to the phone tab', () => {
    searchParams.set('screen', 'bogus')
    const html = renderToStaticMarkup(<DevInviteLoginPage />)

    expect(html).toContain('We just need to send a text to confirm it')
  })
})
