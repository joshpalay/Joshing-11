import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { EditorialFeature } from '@/components/feed/EditorialFeature'

describe('EditorialFeature', () => {
  function render(extra?: Partial<Parameters<typeof EditorialFeature>[0]>) {
    return renderToStaticMarkup(
      <EditorialFeature
        tone="parchment"
        eyebrow="Shared Ground"
        headline={<>You and Robyn keep finding one another here.</>}
        artwork={<div data-mock="art" />}
        supporting="2 shared interests"
        cta={{ label: 'Explore your overlap →', href: '/users/robyn' }}
        {...extra}
      />,
    )
  }

  it('renders the eyebrow, headline, supporting line, and artwork', () => {
    const html = render()
    expect(html).toContain('Shared Ground')
    expect(html).toContain('You and Robyn keep finding one another here.')
    expect(html).toContain('2 shared interests')
    expect(html).toContain('data-mock="art"')
  })

  it('renders the CTA as a single text link (no button) to the given href', () => {
    const html = render()
    expect(html).toContain('href="/users/robyn"')
    expect(html).toContain('Explore your overlap →')
    // Editorial language: the CTA is a text link, never a <button>.
    expect(html).not.toContain('<button')
  })

  it('applies the tone background wash and accent', () => {
    expect(render({ tone: 'parchment' })).toContain('bg-[var(--editorial-parchment)]')
    expect(render({ tone: 'sage' })).toContain('bg-[var(--editorial-sage)]')
    expect(render({ tone: 'slate' })).toContain('bg-[var(--editorial-slate)]')
  })

  it('is full-bleed with no border, radius, or shadow', () => {
    const html = render()
    expect(html).toContain('-mx-4')
    expect(html).not.toMatch(/\bborder\b/)
    expect(html).not.toMatch(/rounded/)
    expect(html).not.toMatch(/shadow/)
  })

  it('omits the supporting line when not provided', () => {
    const html = render({ supporting: undefined })
    expect(html).not.toContain('2 shared interests')
  })
})
