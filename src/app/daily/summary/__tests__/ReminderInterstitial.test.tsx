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
    expect(html).not.toContain('Email me')
    expect(html).not.toContain('type="email"')
  })
})
