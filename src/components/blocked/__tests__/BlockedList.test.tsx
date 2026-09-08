import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { BlockedList, type BlockedListItem } from '@/components/blocked/BlockedList'

// Static-render coverage only, matching this codebase's component-test
// convention. Unblock's fetch path is covered at the API-route level.
describe('BlockedList', () => {
  it('shows an empty state when nothing is blocked', () => {
    const html = renderToStaticMarkup(<BlockedList initialItems={[]} />)
    expect(html).toContain('haven&#x27;t blocked anyone')
  })

  it('lists each blocked person with an Unblock action', () => {
    const items: BlockedListItem[] = [
      { id: 'u1', handle: 'jordan', displayName: 'Jordan', avatarColor: null },
    ]
    const html = renderToStaticMarkup(<BlockedList initialItems={items} />)
    expect(html).toContain('Jordan')
    expect(html).toContain('@jordan')
    expect(html).toContain('Unblock')
  })
})
