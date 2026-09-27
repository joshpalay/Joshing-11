import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ReminderInterstitial } from '@/app/daily/summary/ReminderInterstitial'

describe('ReminderInterstitial', () => {
  it('uses the verified phone and SMS consent language for the one follow-up', () => {
    const html = renderToStaticMarkup(
      <ReminderInterstitial
        preview
        phoneNumber="+17345550123"
        onProceed={vi.fn()}
      />,
    )

    expect(html).toContain('Text me')
    expect(html).toContain('Not now')
    expect(html).toContain('(734) 555-0123')
    expect(html).toContain('automated Joshing reminder texts')
    // Email is offered only as a quieter alternative link; the SMS ask and its
    // consent language above stay exactly as submitted for the A2P campaign,
    // and no email field is shown until the player chooses it.
    expect(html).toContain('Email me instead')
    expect(html).not.toContain('type="email"')
  })
})
