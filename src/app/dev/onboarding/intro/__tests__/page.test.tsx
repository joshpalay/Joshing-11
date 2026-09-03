import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import DevOnboardingIntroPage from '@/app/dev/onboarding/intro/page'

async function renderPage(searchParams: { walk?: string; seedSource?: string } = {}) {
  const element = await DevOnboardingIntroPage({ searchParams: Promise.resolve(searchParams) })
  return renderToStaticMarkup(element)
}

// Stage 6: ?seedSource=link previews the invite-link experience (Stage 2) —
// the same mock topics, but unselected and with the link-specific copy —
// without needing a real link-arrived session. The harness always lands on
// the name/call-sign setup step first (no interests screen reachable via a
// static render — that transition needs real interaction), so these tests
// cover the query-param parsing and prop-threading via the status bar badge
// rather than the interests-screen content itself (already covered directly
// against OnboardingFlow in src/app/onboarding/__tests__/OnboardingFlow.test.tsx).
describe('DevOnboardingIntroPage', () => {
  it('defaults to the named-invite experience: no invite-link badge', async () => {
    const html = await renderPage()

    expect(html).toContain('Read-only replay · writes stubbed')
    expect(html).not.toContain('invite-link seeds')
    // Setup step first — the harness never pre-fills a name/handle.
    expect(html).toContain('Set up your profile')
  })

  it('?seedSource=link surfaces the invite-link badge', async () => {
    const html = await renderPage({ seedSource: 'link' })

    expect(html).toContain('Read-only replay · writes stubbed · invite-link seeds')
  })

  it('an unrecognized seedSource value falls back to the named experience (no badge)', async () => {
    const html = await renderPage({ seedSource: 'bogus' })

    expect(html).not.toContain('invite-link seeds')
  })

  it('?walk=1 still chains to the walkthrough welcome-tour href regardless of seedSource', async () => {
    const html = await renderPage({ walk: '1', seedSource: 'link' })

    expect(html).toContain('Full walkthrough · writes stubbed · invite-link seeds')
  })
})
