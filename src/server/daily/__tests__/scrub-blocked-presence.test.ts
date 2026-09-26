import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueueSlot } from '@/server/daily/types'

const { blockedIdsAmongMock, existingUserIds } = vi.hoisted(() => ({
  blockedIdsAmongMock: vi.fn(async () => new Set<string>()),
  existingUserIds: { value: [] as string[] },
}))

vi.mock('@/server/db/queries/user-blocks', () => ({ blockedIdsAmong: blockedIdsAmongMock }))
vi.mock('@/server/db', () => ({
  users: { id: 'users.id' },
  db: {
    select: () => ({
      from: () => ({
        where: async () => existingUserIds.value.map((id) => ({ id })),
      }),
    }),
  },
}))

import { scrubBlockedPresence } from '@/server/daily/scrub-blocked-presence'

function bonusSlot(sourceId: string, name: string, slotIndex = 5): QueueSlot {
  return {
    slot_index: slotIndex,
    source: 'bot',
    generated_question_id: `gen-${slotIndex}`,
    domain: 'Chess Openings',
    question_text: 'q?',
    answered: true,
    presence_source_id: sourceId,
    presence_source_name: name,
    presence_source_extra_count: 0,
  }
}

describe('scrubBlockedPresence', () => {
  beforeEach(() => {
    blockedIdsAmongMock.mockResolvedValue(new Set())
    existingUserIds.value = ['friend-live']
  })

  it('keeps the name of a live, unblocked friend', async () => {
    const [slot] = await scrubBlockedPresence('viewer', [bonusSlot('friend-live', 'Quat')])
    expect(slot!.presence_source_name).toBe('Quat')
  })

  // QA 2026-09-26, S14: "from Quat's knowledge" outlived Quat's account.
  it('drops the name of a friend whose account was deleted, keeping the bonus marker', async () => {
    const [slot] = await scrubBlockedPresence('viewer', [bonusSlot('friend-gone', 'Quat')])
    expect(slot!.presence_source_name).toBeNull()
    expect(slot!.presence_source_id).toBe('friend-gone')
  })

  it('drops the name of a blocked friend', async () => {
    blockedIdsAmongMock.mockResolvedValue(new Set(['friend-live']))
    const [slot] = await scrubBlockedPresence('viewer', [bonusSlot('friend-live', 'Quat')])
    expect(slot!.presence_source_name).toBeNull()
  })
})
