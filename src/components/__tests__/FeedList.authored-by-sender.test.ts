import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

import { isAuthoredBySender } from '@/components/FeedList'

describe('isAuthoredBySender', () => {
  it('is true only when the sender wrote the human-authored question', () => {
    expect(isAuthoredBySender({ question_source: 'authored', sender_is_author: true })).toBe(true)
  })

  it("is false for a forwarded friend's question (authored, but not by the sender)", () => {
    // QA 2026-10-01 run 2: "Duo Prova sent you a question they wrote" above "by Uno Prova".
    expect(isAuthoredBySender({ question_source: 'authored', sender_is_author: false })).toBe(false)
    expect(isAuthoredBySender({ question_source: 'authored' })).toBe(false)
  })

  it('is false for a curated question even if the sender created the row', () => {
    expect(isAuthoredBySender({ question_source: 'daily_generated', sender_is_author: true })).toBe(false)
  })
})
