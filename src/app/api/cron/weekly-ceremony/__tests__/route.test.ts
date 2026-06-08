import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fireCeremonyMock, onboardedUsersMock, recentCeremonyMock, dbMock } = vi.hoisted(() => {
  const onboardedUsersMock = vi.fn(async () => [] as Array<{ id: string; createdAt: Date }>)
  const recentCeremonyMock = vi.fn(async () => [] as unknown[])
  // The route issues two distinct select() shapes:
  //   1) onboarded users: select({id, createdAt}).from(users).where(eq(...))  — no .limit
  //   2) recent ceremony: select({id}).from(biweeklyCeremonies).where(and(...)).orderBy(...).limit(1)
  const dbMock = {
    select: vi.fn(() => ({
      from: () => ({
        where: (...args: unknown[]) => {
          // The recent-ceremony query chains .orderBy().limit(); the onboarded
          // query awaits the where() result directly. Return a thenable that
          // also exposes orderBy/limit so both shapes resolve correctly.
          void args
          const recent = {
            orderBy: () => ({ limit: () => recentCeremonyMock() }),
          }
          return Object.assign(Promise.resolve(onboardedUsersMock()), recent)
        },
      }),
    })),
  }
  return {
    fireCeremonyMock: vi.fn(async () => 'cer-1' as string | null),
    onboardedUsersMock,
    recentCeremonyMock,
    dbMock,
  }
})

vi.mock('@/server/ceremony/fire-ceremony', () => ({
  fireCeremony: fireCeremonyMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  biweeklyCeremonies: { id: 'b.id', userId: 'b.uid', firedAt: 'b.fired' },
  users: { id: 'u.id', createdAt: 'u.created', onboardingComplete: 'u.onboard' },
}))

import { GET } from '@/app/api/cron/weekly-ceremony/route'

// A Sunday in UTC so the ceremony-day gate passes and the loop actually runs.
const SUNDAY = new Date('2026-06-07T08:00:00.000Z')
// Account old enough to clear MIN_ACCOUNT_AGE_DAYS.
const OLD_ACCOUNT = new Date('2026-01-01T00:00:00.000Z')

const CRON_SECRET = 'test-cron-secret'

function buildRequest() {
  return new Request('https://joshing.example/api/cron/weekly-ceremony', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

describe('GET /api/cron/weekly-ceremony — per-user resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(SUNDAY)
    process.env.CRON_SECRET = CRON_SECRET
    recentCeremonyMock.mockResolvedValue([])
    fireCeremonyMock.mockResolvedValue('cer-1')
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.CRON_SECRET
  })

  it('does not 500 when one user fails — it skips them and fires the rest', async () => {
    onboardedUsersMock.mockResolvedValue([
      { id: 'user-ok-1', createdAt: OLD_ACCOUNT },
      { id: 'user-boom', createdAt: OLD_ACCOUNT },
      { id: 'user-ok-2', createdAt: OLD_ACCOUNT },
    ])
    fireCeremonyMock
      .mockResolvedValueOnce('cer-1')
      .mockRejectedValueOnce(new Error('LLM merge suggestion failed: 429'))
      .mockResolvedValueOnce('cer-2')

    const response = await GET(buildRequest() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ fired: 2, failed: 1, skippedNoActivity: 0 })
    expect(fireCeremonyMock).toHaveBeenCalledTimes(3)
  })

  it('counts a no-activity null return separately from a failure', async () => {
    onboardedUsersMock.mockResolvedValue([{ id: 'user-quiet', createdAt: OLD_ACCOUNT }])
    fireCeremonyMock.mockResolvedValueOnce(null)

    const response = await GET(buildRequest() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ fired: 0, failed: 0, skippedNoActivity: 1 })
  })
})
