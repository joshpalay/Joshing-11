import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { BlockUserButton } from '@/components/profile/BlockUserButton'

// Static-render coverage only, matching this codebase's component-test
// convention (renderToStaticMarkup, no jsdom event simulation). The
// interactive block/confirm path is covered at the API-route level
// (src/app/api/users/[id]/block/__tests__/route.test.ts).
describe('BlockUserButton', () => {
  it('renders as a secondary text link, not a primary button', () => {
    const html = renderToStaticMarkup(
      <BlockUserButton targetUserId="target-1" targetDisplayName="Jordan" />,
    )

    expect(html).toContain('Block')
    expect(html).not.toContain('btn-primary')
  })
})
