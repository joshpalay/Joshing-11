import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  assessQuestionDifficultyMock,
  categorizeQuestionMock,
  createQuestionMock,
  dbMock,
  getFriendsMock,
  getQuestionMock,
  getSessionMock,
  openKBDomainMock,
  rollOffOldItemsMock,
  state,
  userHasQuestionInBlockingFeedMock,
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
    getFriendsMock: vi.fn(),
    getQuestionMock: vi.fn(),
    getSessionMock: vi.fn(),
    openKBDomainMock: vi.fn(),
    rollOffOldItemsMock: vi.fn(),
    state,
    userHasQuestionInBlockingFeedMock: vi.fn(),
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
}))

vi.mock('@/server/db/queries/feed', () => ({
  rollOffOldItems: rollOffOldItemsMock,
  userAnsweredQuestionCorrectly: vi.fn(async () => false),
  userHasQuestionInBlockingFeed: userHasQuestionInBlockingFeedMock,
}))

vi.mock('@/server/knowledge/open-domain', () => ({
  openKBDomain: openKBDomainMock,
}))

vi.mock('@/server/questions/llm-difficulty', () => ({
  assessQuestionDifficulty: assessQuestionDifficultyMock,
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
    assessQuestionDifficultyMock.mockResolvedValue({ difficulty: 3, tier: 'moderate' })
    createQuestionMock.mockResolvedValue({ id: 'question-1' })
    getQuestionMock.mockResolvedValue({ id: 'question-1', question_text: 'Who wrote Middlemarch?' })
    openKBDomainMock.mockResolvedValue({ opened: true })
    rollOffOldItemsMock.mockResolvedValue(0)
    userHasQuestionInBlockingFeedMock.mockResolvedValue(false)
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
