import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The vet sweep is the safety net for questions whose inline create vet failed
// (Haiku error / unknown → needs_review): those questions are already saved —
// and may already be fanned out to direct recipients — so the sweep must
// (a) scan EVERY visibility except 'blocked', not just 'public' (a friends/
//     private question with a failed inline vet would otherwise stay unvetted
//     forever), and
// (b) apply the same safety hard-block the create route does when it is the
//     first place a safety-fail is detected.
// These tests pin both behaviors structurally.

const { state, dbMock, vetQuestionMock } = vi.hoisted(() => {
  type Predicate = Record<string, unknown>

  const state = {
    pendingRows: [] as Array<Record<string, unknown>>,
    selectPredicate: undefined as Predicate | undefined,
    updates: [] as Array<{ set: Record<string, unknown>; where: Predicate | undefined }>,
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((predicate: Predicate) => {
          state.selectPredicate = predicate
          return { limit: vi.fn(async () => state.pendingRows) }
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async (predicate: Predicate) => {
          state.updates.push({ set: values, where: predicate })
        }),
      })),
    })),
  }

  return { state, dbMock, vetQuestionMock: vi.fn() }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  questions: {
    id: 'questions.id',
    questionText: 'questions.questionText',
    answerText: 'questions.answerText',
    acceptedAlternatives: 'questions.acceptedAlternatives',
    factualExplanation: 'questions.factualExplanation',
    broadCategory: 'questions.broadCategory',
    canonicalSubcategory: 'questions.canonicalSubcategory',
    publicStatus: 'questions.publicStatus',
    visibility: 'questions.visibility',
    deletedAt: 'questions.deletedAt',
  },
}))

// vetQuestion is the Haiku call — mocked. verdictToPublicStatus is re-exported
// through vet-question.ts; use the real pure mapping from vet-verdict so the
// publicStatus/visibility writes below reflect production behavior.
vi.mock('@/server/llm/vet-question', async () => {
  const { verdictToPublicStatus } = await vi.importActual<typeof import('@/server/llm/vet-verdict')>('@/server/llm/vet-verdict')
  return { vetQuestion: vetQuestionMock, verdictToPublicStatus }
})

import { GET } from '@/app/api/cron/vet-questions/route'

const CRON_SECRET = 'test-cron-secret'

function buildRequest() {
  return new Request('https://joshing.example/api/cron/vet-questions', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }) as never
}

function pendingRow(id: string) {
  return {
    id,
    questionText: 'What is the capital of France?',
    answerText: 'Paris',
    acceptedAlternatives: [],
    factualExplanation: null,
    broadCategory: 'Geography',
    canonicalSubcategory: 'European capitals',
  }
}

describe('GET /api/cron/vet-questions — sweep scope and safety hard-block', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    state.pendingRows = []
    state.selectPredicate = undefined
    state.updates = []
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('sweeps every visibility except blocked — not only public', async () => {
    await GET(buildRequest())

    const parts = (state.selectPredicate as { parts: unknown[] }).parts
    // The safety net must reach friends/private questions whose inline vet
    // failed: they may already be fanned out to direct recipients.
    expect(parts).toContainEqual({ op: 'ne', column: 'questions.visibility', value: 'blocked' })
    expect(parts).not.toContainEqual({ op: 'eq', column: 'questions.visibility', value: 'public' })
    // Still only re-vets rows the inline vet left undecided.
    expect(parts).toContainEqual({ op: 'eq', column: 'questions.publicStatus', value: 'not_scored' })
  })

  it('hard-blocks on a safety-fail verdict (first detection after a failed inline vet)', async () => {
    state.pendingRows = [pendingRow('q-unsafe')]
    vetQuestionMock.mockResolvedValue({
      status: 'rejected',
      score: 0,
      reason: 'harassment',
      rejectionKind: 'safety',
    })

    const response = await GET(buildRequest())

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].set).toMatchObject({ publicStatus: 'rejected', visibility: 'blocked' })
    expect(await response.json()).toMatchObject({ scanned: 1, rejected: 1 })
  })

  it('does not touch visibility on a non-safety rejection or approval', async () => {
    state.pendingRows = [pendingRow('q-wrong'), pendingRow('q-good')]
    vetQuestionMock
      .mockResolvedValueOnce({ status: 'rejected', score: 20, reason: 'wrong answer', rejectionKind: 'factual' })
      .mockResolvedValueOnce({ status: 'approved', score: 90, reason: 'solid' })

    await GET(buildRequest())

    expect(state.updates).toHaveLength(2)
    for (const update of state.updates) {
      expect(update.set).not.toHaveProperty('visibility')
    }
  })
})
