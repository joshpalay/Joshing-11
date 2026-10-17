import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const fixture = vi.hoisted(() => ({
  blocked: new Set<string>(), hidden: new Set<string>(),
  friends: [{ userId: 'chiann', name: 'Chiann' }],
  answers: [] as Array<Record<string, unknown>>,
  predicates: [] as unknown[],
}))
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema')
  function query(selection: Record<string, unknown>) {
    let table: unknown
    const chain = {
      from(value: unknown) { table = value; return chain },
      innerJoin() { return chain },
      where(predicate: unknown) { fixture.predicates.push(predicate); return chain },
      then(resolve: (value: unknown) => unknown) {
        const rows = table === schema.users ? fixture.friends
          : table === schema.feedItems ? []
          : 'questionText' in selection ? fixture.answers : [{ questionId: 'q' }]
        return Promise.resolve(rows).then(resolve)
      },
    }
    return chain
  }
  return { ...schema, db: { select: query, selectDistinct: query } }
})
vi.mock('@/server/db/queries/follow-visibility', async () => {
  const { sql } = await import('drizzle-orm')
  return { mutualFollowApproved: vi.fn(() => sql`true`) }
})
vi.mock('@/server/db/queries/user-blocks', () => ({ blockedIdsAmong: vi.fn(async () => fixture.blocked) }))
vi.mock('@/server/db/queries/content-reports', () => ({ getViewerHiddenQuestionIds: vi.fn(async () => fixture.hidden) }))
vi.mock('@/server/daily/verification-gating', () => ({
  FRIEND_FACING_TIERS: ['author_confirmed'], applyTierGate: (_surface: string, rows: unknown[]) => ({ rows }),
}))
import { getSharedAnswerActivity } from '@/server/db/queries/shared-answer-activity'
import { mutualFollowApproved } from '@/server/db/queries/follow-visibility'

beforeEach(() => {
  fixture.blocked = new Set()
  fixture.hidden = new Set()
  fixture.predicates = []
  fixture.answers = ['me', 'chiann'].map(userId => ({
    userId, questionId: 'q', questionText: 'Which composer?', correctAnswer: 'Bach',
    answerId: `daily:queue:q:${userId}`, answeredAt: new Date(), trustTier: 'author_confirmed',
  }))
})

describe('shared-answer query boundaries', () => {
  it('requires mutual friends and correct live answers, excluding deleted and blocked questions in SQL', async () => {
    const items = await getSharedAnswerActivity('me', 7)
    expect(items).toHaveLength(1)
    expect(mutualFollowApproved).toHaveBeenCalledWith('me', expect.anything(), 'shared_answer_activity')
    const statements = fixture.predicates.map(p => new PgDialect().sqlToQuery(p as Parameters<PgDialect['sqlToQuery']>[0]))
    const statement = statements.find(s => s.sql.includes('deleted_at'))!
    expect(statement.sql).toContain('is null')
    expect(statement.sql).toContain('visibility')
    expect(statement.params).toContain('blocked')
    expect(statement.params).toEqual(expect.arrayContaining(['live_correct', 'catchup_correct', 'first_correct', 'first_correct_after_wrong', 'repeat_correct']))
    expect(statement.params).not.toContain('author_credit')
    expect(statement.params).not.toContain('first_wrong')
  })
  it('removes blocked friends before looking up questions', async () => {
    fixture.blocked.add('chiann')
    expect(await getSharedAnswerActivity('me', 7)).toEqual([])
    expect(fixture.predicates).toHaveLength(1)
  })
  it('removes reported questions before returning answers to the client', async () => {
    fixture.hidden.add('q')
    expect(await getSharedAnswerActivity('me', 7)).toEqual([])
  })
})
