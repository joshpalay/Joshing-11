import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-5 Change 3: the aside's label carries provenance. A human-authored question
// (non-null creatorId) resolves to the relational label and keeps the
// self/friend display gate; an LLM-origin question (null creatorId) resolves to
// the non-relational editorial label and is NEVER relationally gated — and a
// machine question must never surface under the relational label.
const { areFriendsMock } = vi.hoisted(() => ({
  areFriendsMock: vi.fn(async () => false),
}))

vi.mock('@/server/db/queries/friends', () => ({
  areFriends: areFriendsMock,
}))

import { selectInsideJokeForViewer } from '@/server/questions/inside-joke'

describe('selectInsideJokeForViewer', () => {
  beforeEach(() => {
    areFriendsMock.mockReset()
    areFriendsMock.mockResolvedValue(false)
  })

  it('returns null when there is no aside, without touching the friend graph', async () => {
    expect(await selectInsideJokeForViewer(null, 'creator-1', 'viewer-1')).toBeNull()
    expect(areFriendsMock).not.toHaveBeenCalled()
  })

  it('labels an LLM-origin (null creatorId) aside as editorial and never gates it', async () => {
    expect(await selectInsideJokeForViewer('a machine aside', null, 'viewer-1')).toEqual({
      text: 'a machine aside',
      kind: 'editorial',
    })
    // No relationship to gate on — the friend check must not run.
    expect(areFriendsMock).not.toHaveBeenCalled()
  })

  it('labels the author’s own authored aside as relational without a friend check', async () => {
    expect(await selectInsideJokeForViewer('an authored aside', 'creator-1', 'creator-1')).toEqual({
      text: 'an authored aside',
      kind: 'relational',
    })
    expect(areFriendsMock).not.toHaveBeenCalled()
  })

  it('shows an authored aside to a friend under the relational label', async () => {
    areFriendsMock.mockResolvedValueOnce(true)
    expect(await selectInsideJokeForViewer('an authored aside', 'creator-1', 'viewer-1')).toEqual({
      text: 'an authored aside',
      kind: 'relational',
    })
    expect(areFriendsMock).toHaveBeenCalledWith('viewer-1', 'creator-1')
  })

  it('hides an authored aside from a stranger', async () => {
    areFriendsMock.mockResolvedValueOnce(false)
    expect(await selectInsideJokeForViewer('an authored aside', 'creator-1', 'viewer-1')).toBeNull()
  })

  it('never labels a machine aside as relational', async () => {
    const result = await selectInsideJokeForViewer('a machine aside', null, 'viewer-1')
    expect(result?.kind).not.toBe('relational')
  })
})
