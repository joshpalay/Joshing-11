import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { ViaAttribution, type ViaAnswerer } from '@/components/feed'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function answerer(name: string, id = name.toLowerCase()): ViaAnswerer {
  return {
    userId: id,
    displayName: name,
    href: `/users/${id}`,
    answeredAt: '2026-06-01T00:00:00Z',
  }
}

describe('ViaAttribution', () => {
  it('renders nothing for an empty answerer set', () => {
    expect(renderToStaticMarkup(<ViaAttribution answerers={[]} />)).toBe('')
  })

  it('renders a lead name with no expand control for a single answerer', () => {
    const html = renderToStaticMarkup(
      <ViaAttribution answerers={[answerer('Sadie')]} />,
    )
    expect(html).toContain('Via ')
    expect(html).toContain('Sadie')
    expect(html).toContain('/users/sadie')
    // No count door when only one friend answered.
    expect(html).not.toContain('friends answered')
    expect(html).not.toContain('<button')
  })

  it('labels the expand control with the FULL set count (no hidden names)', () => {
    const set = [
      answerer('Sadie'),
      answerer('Robyn'),
      answerer('Allan'),
      answerer('Mara'),
      answerer('Tom'),
    ]
    const html = renderToStaticMarkup(<ViaAttribution answerers={set} />)
    // Lead is shown; the count labels the door and equals the real set size —
    // it never stands in for hidden people ("no 'and N others'").
    expect(html).toContain('Sadie')
    expect(html).toContain('5 friends answered')
    expect(html).not.toMatch(/\band \d+ others?\b/)
    // Collapsed by default: the expand button advertises the complete set.
    expect(html).toContain('aria-expanded="false"')
  })

  it('makes no relevance/closeness claim in the copy', () => {
    const html = renderToStaticMarkup(
      <ViaAttribution answerers={[answerer('Sadie'), answerer('Robyn')]} />,
    )
    expect(html.toLowerCase()).not.toContain('most relevant')
    expect(html.toLowerCase()).not.toContain('closest')
    expect(html.toLowerCase()).not.toContain('most recent')
  })
})
