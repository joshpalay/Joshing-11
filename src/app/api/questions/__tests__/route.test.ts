import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  assessQuestionDifficultyMock,
  categorizeQuestionMock,
  createQuestionMock,
  dbMock,
  generateInsideJokeMock,
  getFriendsMock,
  getQuestionMock,
  getSessionMock,
  isReconcileAuthoredDomainsEnabledMock,
  openKBDomainMock,
  reconcileAuthoredDomainMock,
  rollOffOldItemsMock,
  state,
  userHasQuestionInBlockingFeedMock,
  vetQuestionMock,
} = vi.hoisted(() => {
  const state = {
    dismissedRows: [] as Array<{ userId: string }>,
    feedInsertValues: [] as Array<Record<string, unknown>>,
    questionUpdateValues: [] as Array<Record<string, unknown>>,
  }

  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => state.dismissedRows),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.feedInsertValues.push(values)
        return undefined
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.questionUpdateValues.push(values)
        return { where: vi.fn(async () => undefined) }
      }),
    })),
  }

  return {
    assessQuestionDifficultyMock: vi.fn(),
    categorizeQuestionMock: vi.fn(),
    createQuestionMock: vi.fn(),
    dbMock,
    generateInsideJokeMock: vi.fn(),
    getFriendsMock: vi.fn(),
    getQuestionMock: vi.fn(),
    getSessionMock: vi.fn(),
    isReconcileAuthoredDomainsEnabledMock: vi.fn(),
    openKBDomainMock: vi.fn(),
    reconcileAuthoredDomainMock: vi.fn(),
    rollOffOldItemsMock: vi.fn(),
    state,
    userHasQuestionInBlockingFeedMock: vi.fn(),
    vetQuestionMock: vi.fn(),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({ op: 'and' })),
  eq: vi.fn(() => ({ op: 'eq' })),
  inArray: vi.fn(() => ({ op: 'inArray' })),
  isNull: vi.fn(() => ({ op: 'isNull' })),
}))

vi.mock('@/lib/llm', () => ({
  categorizeQuestion: categorizeQuestionMock,
  generateInsideJoke: generateInsideJokeMock,
}))

vi.mock('@/server/llm/vet-question', () => ({
  vetQuestion: vetQuestionMock,
  verdictToPublicStatus: (verdict: { status: string; score: number | null; reason: string }) => ({
    publicStatus:
      verdict.status === 'approved'
        ? 'eligible_pending'
        : verdict.status === 'rejected'
          ? 'rejected'
          : 'not_scored',
    publicEligibilityScore: verdict.score,
    publicEligibilityReason: verdict.reason,
  }),
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedDismissedDomains: {
    userId: 'feedDismissedDomains.userId',
    canonicalSubcategory: 'feedDismissedDomains.canonicalSubcategory',
    reinstatedAt: 'feedDismissedDomains.reinstatedAt',
  },
  feedItems: { id: 'feedItems.id' },
  questions: { id: 'questions.id' },
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
    phoneNumber: 'users.phoneNumber',
    smsOptIn: 'users.smsOptIn',
  },
}))

vi.mock('@/server/db/queries/questions', () => ({
  createQuestion: createQuestionMock,
  getQuestion: getQuestionMock,
  getQuestionsForUser: vi.fn(async () => []),
}))

vi.mock('@/server/db/queries/friends', () => ({
  getFriends: getFriendsMock,
  // Broadcast fan-out now reads my followers; in these tests the recipient set
  // is the same fixture, so alias it to the existing mock.
  getFollowers: getFriendsMock,
}))

vi.mock('@/server/db/queries/feed', () => ({
  rollOffOldItems: rollOffOldItemsMock,
  userAnsweredQuestionCorrectly: vi.fn(async () => false),
  userHasQuestionInBlockingFeed: userHasQuestionInBlockingFeedMock,
}))

vi.mock('@/server/knowledge/open-domain', () => ({
  openKBDomain: openKBDomainMock,
}))

vi.mock('@/server/questions/reconcile-authored-domain', () => ({
  reconcileAuthoredDomain: reconcileAuthoredDomainMock,
  isReconcileAuthoredDomainsEnabled: isReconcileAuthoredDomainsEnabledMock,
}))

vi.mock('@/server/questions/llm-difficulty', () => ({
  assessQuestionDifficulty: assessQuestionDifficultyMock,
  fallbackQuestionDifficulty: () => ({ tier: 'solid', difficulty: 3 }),
}))

vi.mock('@/server/sms', () => ({
  sendSms: vi.fn(),
}))

import { POST } from '@/app/api/questions/route'

function questionRequest(body: Record<string, unknown>) {
  return new Request('https://joshing.example/api/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: 'Who wrote Middlemarch?',
      correctAnswer: 'George Eliot',
      alternateAnswers: [],
      explanation: 'Mary Ann Evans wrote under the pen name George Eliot.',
      verified: true,
      critiqueIterations: 0,
      ...body,
    }),
  })
}

describe('POST /api/questions shareToFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.dismissedRows = []
    state.feedInsertValues = []
    state.questionUpdateValues = []

    getSessionMock.mockResolvedValue({ userId: 'creator-1' })
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Arts & Literature',
      subcategory: 'Victorian Literature',
    })
    // Phase 1 default: flag off and reconcile reports no fold — strict no-op.
    isReconcileAuthoredDomainsEnabledMock.mockReturnValue(false)
    reconcileAuthoredDomainMock.mockImplementation(async (proposed: string) => ({
      proposed,
      canonicalDomain: proposed,
      reconciled: false,
      differs: false,
      method: 'none',
      trgmExactLabel: null,
      trgmFuzzyCandidates: [],
      llmReconciled: false,
    }))
    assessQuestionDifficultyMock.mockResolvedValue({ difficulty: 3, tier: 'moderate' })
    createQuestionMock.mockResolvedValue({ id: 'question-1' })
    generateInsideJokeMock.mockResolvedValue(null)
    getQuestionMock.mockResolvedValue({ id: 'question-1', question_text: 'Who wrote Middlemarch?' })
    openKBDomainMock.mockResolvedValue({ opened: true })
    rollOffOldItemsMock.mockResolvedValue(0)
    userHasQuestionInBlockingFeedMock.mockResolvedValue(false)
    vetQuestionMock.mockResolvedValue({ status: 'approved', score: 0.8, reason: 'looks good' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('creates authored_shared feed rows for active friends when shareToFeed is true', async () => {
    getFriendsMock.mockResolvedValue([
      { id: 'friend-1', displayName: 'Friend One' },
      { id: 'friend-2', displayName: 'Friend Two' },
    ])

    const response = await POST(questionRequest({ shareToFeed: true }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.id).toBe('question-1')
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 2,
      friendCount: 2,
      sharedRecipientIds: ['friend-1', 'friend-2'],
      skippedDismissedDomainRecipientIds: [],
      skippedExistingFeedRecipientIds: [],
    })
    expect(getFriendsMock).toHaveBeenCalledWith('creator-1')
    expect(state.feedInsertValues).toEqual([
      expect.objectContaining({
        recipientUserId: 'friend-1',
        questionId: 'question-1',
        sourceType: 'authored_shared',
        sourceUserId: 'creator-1',
        state: 'active',
      }),
      expect.objectContaining({
        recipientUserId: 'friend-2',
        questionId: 'question-1',
        sourceType: 'authored_shared',
        sourceUserId: 'creator-1',
        state: 'active',
      }),
    ])
    expect(state.feedInsertValues[0]?.sourceEventAt).toBeInstanceOf(Date)
    expect(rollOffOldItemsMock).toHaveBeenCalledWith('friend-1')
    expect(rollOffOldItemsMock).toHaveBeenCalledWith('friend-2')
    expect(state.questionUpdateValues).toContainEqual({ sharedToFriendsFeed: true })
  })

  it('logs parsed shareToFeed intent and creates feed rows for legacy share-with-friends payload flags', async () => {
    const consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    getFriendsMock.mockResolvedValue([{ id: 'friend-1', displayName: 'Friend One' }])

    const response = await POST(questionRequest({ share_with_friends: 'true' }))
    const body = await response.json()
    const createPayloadLogCall = consoleInfoMock.mock.calls.find(([label]) => label === '[questions/createPayload]')
    const createPayloadLog = createPayloadLogCall?.[1]

    expect(response.status).toBe(201)
    expect(createPayloadLog).toEqual(expect.objectContaining({
      userId: 'creator-1',
      hasErrors: false,
      shareToFeed: true,
      sendToFriendCount: 0,
      payloadShareKeysPresent: {
        shareToFeed: false,
        shareWithFriends: false,
        share_with_friends: true,
        share_to_feed: false,
        sharedToFriendsFeed: false,
      },
    }))
    expect(createPayloadLog).not.toHaveProperty('text')
    expect(createPayloadLog).not.toHaveProperty('correctAnswer')
    expect(createPayloadLog).not.toHaveProperty('sendToFriendIds')
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 1,
      friendCount: 1,
      sharedRecipientIds: ['friend-1'],
      skippedDismissedDomainRecipientIds: [],
      skippedExistingFeedRecipientIds: [],
    })
    expect(state.feedInsertValues).toEqual([
      expect.objectContaining({
        recipientUserId: 'friend-1',
        questionId: 'question-1',
        sourceType: 'authored_shared',
        sourceUserId: 'creator-1',
        state: 'active',
      }),
    ])
    expect(state.questionUpdateValues).toContainEqual({ sharedToFriendsFeed: true })
  })

  it('shares to friends before non-critical knowledge-domain opening can fail', async () => {
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getFriendsMock.mockResolvedValue([{ id: 'friend-1', displayName: 'Friend One' }])
    openKBDomainMock.mockRejectedValue(new Error('knowledge write failed'))

    const response = await POST(questionRequest({ shareToFeed: true }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 1,
      friendCount: 1,
      sharedRecipientIds: ['friend-1'],
      skippedDismissedDomainRecipientIds: [],
      skippedExistingFeedRecipientIds: [],
    })
    expect(body.openedDomain).toBeNull()
    expect(state.feedInsertValues).toEqual([
      expect.objectContaining({
        recipientUserId: 'friend-1',
        questionId: 'question-1',
        sourceType: 'authored_shared',
        sourceUserId: 'creator-1',
        state: 'active',
      }),
    ])
    expect(state.questionUpdateValues).toContainEqual({ sharedToFriendsFeed: true })
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[questions/create] openKBDomain failed after question save/share; continuing response',
      expect.objectContaining({ questionId: 'question-1', userId: 'creator-1', error: 'knowledge write failed' }),
    )
  })

  it('does not require explicit recipient ids for all-friends sharing', async () => {
    getFriendsMock.mockResolvedValue([{ id: 'friend-1', displayName: 'Friend One' }])

    const response = await POST(questionRequest({ shareToFeed: true }))

    expect(response.status).toBe(201)
    expect(createQuestionMock).toHaveBeenCalled()
    const body = await response.json()
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 1,
      friendCount: 1,
      sharedRecipientIds: ['friend-1'],
      skippedDismissedDomainRecipientIds: [],
      skippedExistingFeedRecipientIds: [],
    })
    expect(state.feedInsertValues).toHaveLength(1)
    expect(state.feedInsertValues[0]).toEqual(expect.objectContaining({ recipientUserId: 'friend-1' }))
  })

  it('skips dismissed domains and duplicate blocking feed rows', async () => {
    getFriendsMock.mockResolvedValue([
      { id: 'friend-1', displayName: 'Friend One' },
      { id: 'friend-2', displayName: 'Friend Two' },
      { id: 'friend-3', displayName: 'Friend Three' },
    ])
    state.dismissedRows = [{ userId: 'friend-3' }]
    userHasQuestionInBlockingFeedMock.mockImplementation(async (userId: string) => userId === 'friend-2')

    const response = await POST(questionRequest({ shareToFeed: true }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 1,
      friendCount: 3,
      sharedRecipientIds: ['friend-1'],
      skippedDismissedDomainRecipientIds: ['friend-3'],
      skippedExistingFeedRecipientIds: ['friend-2'],
    })
    expect(userHasQuestionInBlockingFeedMock).toHaveBeenCalledWith('friend-1', 'question-1')
    expect(userHasQuestionInBlockingFeedMock).toHaveBeenCalledWith('friend-2', 'question-1')
    expect(userHasQuestionInBlockingFeedMock).not.toHaveBeenCalledWith('friend-3', 'question-1')
    expect(state.feedInsertValues).toEqual([
      expect.objectContaining({ recipientUserId: 'friend-1', questionId: 'question-1' }),
    ])
    expect(rollOffOldItemsMock).toHaveBeenCalledTimes(1)
    expect(rollOffOldItemsMock).toHaveBeenCalledWith('friend-1')
  })

  it('reports zero created rows when all-friends sharing has no eligible recipients', async () => {
    getFriendsMock.mockResolvedValue([])

    const response = await POST(questionRequest({ shareToFeed: true }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 0,
      friendCount: 0,
      sharedRecipientIds: [],
      skippedDismissedDomainRecipientIds: [],
      skippedExistingFeedRecipientIds: [],
    })
    expect(state.feedInsertValues).toEqual([])
    expect(state.questionUpdateValues).toEqual([])
  })

  it('reports visible skip reasons when zero rows are created for non-empty all-friends sharing', async () => {
    getFriendsMock.mockResolvedValue([
      { id: 'friend-1', displayName: 'Friend One' },
      { id: 'friend-2', displayName: 'Friend Two' },
    ])
    state.dismissedRows = [{ userId: 'friend-2' }]
    userHasQuestionInBlockingFeedMock.mockImplementation(async (userId: string) => userId === 'friend-1')

    const response = await POST(questionRequest({ shareToFeed: true }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 0,
      friendCount: 2,
      sharedRecipientIds: [],
      skippedDismissedDomainRecipientIds: ['friend-2'],
      skippedExistingFeedRecipientIds: ['friend-1'],
    })
    expect(state.feedInsertValues).toEqual([])
    expect(state.questionUpdateValues).toEqual([])
  })

  it('exposes production response diagnostics while redacting recipient ids from logs by default', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    getFriendsMock.mockResolvedValue([
      { id: 'friend-1', displayName: 'Friend One' },
      { id: 'friend-2', displayName: 'Friend Two' },
      { id: 'friend-3', displayName: 'Friend Three' },
    ])
    state.dismissedRows = [{ userId: 'friend-3' }]
    userHasQuestionInBlockingFeedMock.mockImplementation(async (userId: string) => userId === 'friend-2')

    const response = await POST(questionRequest({ shareToFeed: true }))
    const body = await response.json()
    const shareLogCall = consoleInfoMock.mock.calls.find(([label]) => label === '[questions/shareToFeed]')

    expect(response.status).toBe(201)
    expect(body.feedShare).toEqual({
      requested: true,
      createdCount: 1,
      friendCount: 3,
      sharedRecipientIds: ['friend-1'],
      skippedDismissedDomainRecipientIds: ['friend-3'],
      skippedExistingFeedRecipientIds: ['friend-2'],
    })
    expect(shareLogCall).toBeDefined()
    expect(shareLogCall?.[1]).toEqual({
      questionId: 'question-1',
      userId: 'creator-1',
      requested: true,
      friendCount: 3,
      sharedCount: 1,
      skippedDismissedDomainCount: 1,
      skippedExistingFeedCount: 1,
    })
    expect(JSON.stringify(shareLogCall)).not.toContain('friend-1')
    expect(JSON.stringify(shareLogCall)).not.toContain('friend-2')
    expect(JSON.stringify(shareLogCall)).not.toContain('friend-3')
  })

  it('includes share-to-feed recipient ids when production diagnostics debug mode is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHARE_TO_FEED_DEBUG_RECIPIENT_IDS', 'true')
    const consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    getFriendsMock.mockResolvedValue([
      { id: 'friend-1', displayName: 'Friend One' },
      { id: 'friend-2', displayName: 'Friend Two' },
      { id: 'friend-3', displayName: 'Friend Three' },
    ])
    state.dismissedRows = [{ userId: 'friend-3' }]
    userHasQuestionInBlockingFeedMock.mockImplementation(async (userId: string) => userId === 'friend-2')

    const response = await POST(questionRequest({ shareToFeed: true }))
    const shareLogCall = consoleInfoMock.mock.calls.find(([label]) => label === '[questions/shareToFeed]')

    expect(response.status).toBe(201)
    expect(shareLogCall?.[1]).toEqual(expect.objectContaining({
      requested: true,
      sharedRecipientIds: ['friend-1'],
      skippedDismissedDomainRecipientIds: ['friend-3'],
      skippedExistingFeedRecipientIds: ['friend-2'],
    }))
  })
})

describe('POST /api/questions category leak handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.dismissedRows = []
    state.feedInsertValues = []
    state.questionUpdateValues = []

    getSessionMock.mockResolvedValue({ userId: 'creator-1' })
    isReconcileAuthoredDomainsEnabledMock.mockReturnValue(false)
    reconcileAuthoredDomainMock.mockImplementation(async (proposed: string) => ({
      proposed,
      canonicalDomain: proposed,
      reconciled: false,
      differs: false,
      method: 'none',
      trgmExactLabel: null,
      trgmFuzzyCandidates: [],
      llmReconciled: false,
    }))
    assessQuestionDifficultyMock.mockResolvedValue({ difficulty: 3, tier: 'moderate' })
    createQuestionMock.mockResolvedValue({ id: 'question-1' })
    generateInsideJokeMock.mockResolvedValue(null)
    getQuestionMock.mockResolvedValue({ id: 'question-1' })
    openKBDomainMock.mockResolvedValue({ opened: true })
    rollOffOldItemsMock.mockResolvedValue(0)
    userHasQuestionInBlockingFeedMock.mockResolvedValue(false)
    vetQuestionMock.mockResolvedValue({ status: 'approved', score: 0.8, reason: 'looks good' })
  })

  it('saves a question with a leaky category instead of 422-rejecting, and marks publicStatus rejected', async () => {
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Civics',
      subcategory: "Robert's Rules of Order",
    })

    const response = await POST(questionRequest({
      text: 'What is the name of the standard parliamentary authority used by most organizations in the United States?',
      correctAnswer: "Robert's Rules of Order",
      alternateAnswers: ['RONR', "Robert's Rules", 'Rules of Order'],
    }))

    expect(response.status).toBe(201)
    expect(createQuestionMock).toHaveBeenCalledTimes(1)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as {
      publicStatus: string
      publicEligibilityReason: string
    }
    expect(createArgs.publicStatus).toBe('rejected')
    expect(createArgs.publicEligibilityReason).toBe('category_leaks_answer')
  })

  it('saves with publicStatus eligible_pending when the category does not leak the answer', async () => {
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Civics',
      subcategory: 'Parliamentary Procedure',
    })

    const response = await POST(questionRequest({
      text: 'What is the name of the standard parliamentary authority used by most organizations in the United States?',
      correctAnswer: "Robert's Rules of Order",
      alternateAnswers: ['RONR', "Robert's Rules", 'Rules of Order'],
    }))

    expect(response.status).toBe(201)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { publicStatus: string }
    expect(createArgs.publicStatus).toBe('eligible_pending')
  })

  it('hard-blocks a safety-fail verdict: saves as visibility blocked, skips all fan-out, returns a non-graphic content-check error', async () => {
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Arts & Literature',
      subcategory: 'Victorian Literature',
    })
    // Real verdictToBlockedVisibility (vet-verdict is not mocked) keys off rejectionKind.
    vetQuestionMock.mockResolvedValue({ status: 'rejected', score: 0.1, reason: 'safety: …', rejectionKind: 'safety' })
    getFriendsMock.mockResolvedValue([{ id: 'friend-1', displayName: 'Friend One' }])

    const response = await POST(questionRequest({ shareToFeed: true, sendToFriendIds: [] }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error).toBe('failed_content_check')
    // Must not echo or name the triggered safety category.
    expect(JSON.stringify(body)).not.toMatch(/slur|harass|minor|doxx|safety/i)

    // Persisted as blocked so it can never be re-shared, even from the bank.
    expect(createQuestionMock).toHaveBeenCalledTimes(1)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { visibility?: string; publicStatus: string }
    expect(createArgs.visibility).toBe('blocked')
    expect(createArgs.publicStatus).toBe('rejected')

    // No fan-out: no broadcast or direct-send feed rows in the same request.
    expect(state.feedInsertValues).toEqual([])
    expect(state.questionUpdateValues).toEqual([])
  })

  it('still saves the question with a fallback difficulty when difficulty enrichment throws', async () => {
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Arts & Literature',
      subcategory: 'Victorian Literature',
    })
    assessQuestionDifficultyMock.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(questionRequest({}))

    // Enrichment is optional: an outage degrades the signal, it does not 500 the save.
    expect(response.status).toBe(201)
    expect(createQuestionMock).toHaveBeenCalledTimes(1)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { difficulty: number }
    expect(createArgs.difficulty).toBe(3)
  })

  it('saves with needs_review status when the vet step throws, never auto-publishing', async () => {
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Arts & Literature',
      subcategory: 'Victorian Literature',
    })
    vetQuestionMock.mockRejectedValue(new Error('vet down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(questionRequest({}))

    expect(response.status).toBe(201)
    expect(createQuestionMock).toHaveBeenCalledTimes(1)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { publicStatus: string }
    // verdictToPublicStatus maps needs_review → not_scored (never eligible/public).
    expect(createArgs.publicStatus).toBe('not_scored')
  })
})

describe('POST /api/questions authored domain reconcile (B-CATEGORY-AUTHORED-RECONCILE-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.dismissedRows = []
    state.feedInsertValues = []
    state.questionUpdateValues = []

    getSessionMock.mockResolvedValue({ userId: 'creator-1' })
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Arts & Literature',
      subcategory: 'Hamlet',
    })
    isReconcileAuthoredDomainsEnabledMock.mockReturnValue(false)
    reconcileAuthoredDomainMock.mockImplementation(async (proposed: string) => ({
      proposed,
      canonicalDomain: proposed,
      reconciled: false,
      differs: false,
      method: 'none',
      trgmExactLabel: null,
      trgmFuzzyCandidates: [],
      llmReconciled: false,
    }))
    assessQuestionDifficultyMock.mockResolvedValue({ difficulty: 3, tier: 'moderate' })
    createQuestionMock.mockResolvedValue({ id: 'question-1' })
    generateInsideJokeMock.mockResolvedValue(null)
    getQuestionMock.mockResolvedValue({ id: 'question-1' })
    openKBDomainMock.mockResolvedValue({ opened: true })
    rollOffOldItemsMock.mockResolvedValue(0)
    userHasQuestionInBlockingFeedMock.mockResolvedValue(false)
    vetQuestionMock.mockResolvedValue({ status: 'approved', score: 0.8, reason: 'looks good' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function foldOutcome(proposed: string, canonicalDomain: string, method: 'trgm-exact' | 'llm') {
    return {
      proposed,
      canonicalDomain,
      reconciled: true,
      differs: true,
      method,
      trgmExactLabel: method === 'trgm-exact' ? canonicalDomain : null,
      trgmFuzzyCandidates: [],
      llmReconciled: method === 'llm',
    }
  }

  it('shadow-logs the reconcile but is a strict no-op on the written label when the flag is OFF', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    // Reconcile WOULD fold Hamlet → Shakespearean Tragedy, but the flag is off.
    reconcileAuthoredDomainMock.mockResolvedValue(foldOutcome('Hamlet', 'Shakespearean Tragedy', 'llm'))

    const response = await POST(questionRequest({ text: 'Who skull does Hamlet hold?', correctAnswer: 'Yorick' }))

    expect(response.status).toBe(201)
    // Flag off → the blind label is still what gets written.
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { canonicalSubcategory: string }
    expect(createArgs.canonicalSubcategory).toBe('Hamlet')
    // …but the shadow-log records what the fold WOULD have been. The payload is
    // a JSON string (deterministically parseable from exported logs).
    const shadowLog = infoSpy.mock.calls.find((c) => c[0] === '[questions/authored-reconcile]')
    expect(JSON.parse(shadowLog?.[1] as string)).toMatchObject({
      proposed: 'Hamlet',
      reconciled: 'Shakespearean Tragedy',
      differs: true,
      flagEnabled: false,
      applied: false,
    })
  })

  it('writes the reconciled domain (trgm exact) across canonical_subcategory/subcategory/domain when the flag is ON', async () => {
    isReconcileAuthoredDomainsEnabledMock.mockReturnValue(true)
    reconcileAuthoredDomainMock.mockResolvedValue(foldOutcome('Hamlet', 'Shakespearean Tragedy', 'trgm-exact'))

    const response = await POST(questionRequest({ text: 'Who skull does Hamlet hold?', correctAnswer: 'Yorick' }))

    expect(response.status).toBe(201)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as {
      canonicalSubcategory: string
      subcategory: string
      domain: string
    }
    // The authored "Hamlet" folds onto the existing "Shakespearean Tragedy"
    // instead of minting a sibling — written consistently everywhere.
    expect(createArgs.canonicalSubcategory).toBe('Shakespearean Tragedy')
    expect(createArgs.subcategory).toBe('Shakespearean Tragedy')
    expect(createArgs.domain).toBe('Shakespearean Tragedy')
    // Phase 3: the KB domain opened for the author uses the reconciled label, so
    // mastery credit lands on the reconciled domain, not the blind duplicate.
    expect(openKBDomainMock).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'Shakespearean Tragedy', via: 'authorship' }),
    )
  })

  it('writes the reconciled domain from the Haiku (llm) fold when the flag is ON', async () => {
    isReconcileAuthoredDomainsEnabledMock.mockReturnValue(true)
    categorizeQuestionMock.mockResolvedValue({
      broad_category: 'Arts & Literature',
      subcategory: 'The Bard’s Tragedies',
    })
    reconcileAuthoredDomainMock.mockResolvedValue(
      foldOutcome('The Bard’s Tragedies', 'Shakespearean Tragedy', 'llm'),
    )

    const response = await POST(questionRequest({ text: 'Who skull does Hamlet hold?', correctAnswer: 'Yorick' }))

    expect(response.status).toBe(201)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { canonicalSubcategory: string }
    expect(createArgs.canonicalSubcategory).toBe('Shakespearean Tragedy')
  })

  it('falls through to the proposed label (never throws) if reconcile yields a generic label, even flag ON', async () => {
    isReconcileAuthoredDomainsEnabledMock.mockReturnValue(true)
    // A would-be fold onto a generic bucket the F4.5 write-guard forbids.
    reconcileAuthoredDomainMock.mockResolvedValue(foldOutcome('Hamlet', 'General Knowledge', 'llm'))

    const response = await POST(questionRequest({ text: 'Who skull does Hamlet hold?', correctAnswer: 'Yorick' }))

    expect(response.status).toBe(201)
    const createArgs = createQuestionMock.mock.calls[0]?.[0] as { canonicalSubcategory: string }
    // Guard preserved: we keep the already-validated proposed label.
    expect(createArgs.canonicalSubcategory).toBe('Hamlet')
  })
})
