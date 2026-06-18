import { describe, expect, it } from 'vitest'

import {
  ADD_SOMEONE_FOCUS_EVENT,
  addSuccessToast,
  buildAddSomeoneHandoff,
  classifyQuery,
  describeMatchStatus,
  resolveAddSomeoneOutcome,
} from '@/components/friends/add-someone'
import type { RelationshipState } from '@/server/db/queries/friend-requests'

describe('classifyQuery', () => {
  it('treats blank input as empty', () => {
    expect(classifyQuery('')).toBe('empty')
    expect(classifyQuery('   ')).toBe('empty')
  })

  it('recognizes @handles and bare handles', () => {
    expect(classifyQuery('@josh')).toBe('handle')
    expect(classifyQuery('josh_palay')).toBe('handle')
  })

  it('recognizes US phone numbers, formatted or bare', () => {
    expect(classifyQuery('(415) 555-1234')).toBe('phone')
    expect(classifyQuery('7346578284')).toBe('phone')
    expect(classifyQuery('1 734 657 8284')).toBe('phone')
  })

  it('falls back to name for free text', () => {
    expect(classifyQuery('Sarah Connor')).toBe('name')
    // Leading digit means it is not a valid handle, and 4 digits is not a phone.
    expect(classifyQuery('123')).toBe('name')
  })
})

describe('describeMatchStatus', () => {
  const cases: Array<[RelationshipState, string]> = [
    ['none', 'add'],
    ['follows_you', 'add'],
    ['pending_outbound', 'pending'],
    ['pending_inbound', 'respond'],
    ['friends', 'connected'],
    ['following', 'connected'],
  ]
  it.each(cases)('maps %s to %s', (state, expected) => {
    expect(describeMatchStatus(state)).toBe(expected)
  })
})

describe('resolveAddSomeoneOutcome', () => {
  const base = { query: '@josh', searching: false, searched: false, error: false, match: null }

  it('is idle before any search resolves', () => {
    expect(resolveAddSomeoneOutcome(base)).toEqual({ kind: 'idle' })
  })

  it('reports searching while in flight', () => {
    expect(resolveAddSomeoneOutcome({ ...base, searching: true })).toEqual({ kind: 'searching' })
  })

  it('reports error', () => {
    expect(resolveAddSomeoneOutcome({ ...base, searched: true, error: true })).toEqual({
      kind: 'error',
    })
  })

  it('surfaces a match with its add status', () => {
    expect(
      resolveAddSomeoneOutcome({
        ...base,
        searched: true,
        match: { relationship: { state: 'none' } },
      }),
    ).toEqual({ kind: 'match', status: 'add' })
  })

  it('surfaces an already-pending match without offering a duplicate send', () => {
    expect(
      resolveAddSomeoneOutcome({
        ...base,
        searched: true,
        match: { relationship: { state: 'pending_outbound' } },
      }),
    ).toEqual({ kind: 'match', status: 'pending' })
  })

  it('surfaces an already-connected match with no add action', () => {
    expect(
      resolveAddSomeoneOutcome({
        ...base,
        searched: true,
        match: { relationship: { state: 'friends' } },
      }),
    ).toEqual({ kind: 'match', status: 'connected' })
  })

  it('falls to no_match carrying the classification for the invite hand-off', () => {
    expect(
      resolveAddSomeoneOutcome({ ...base, query: '(415) 555-1234', searched: true }),
    ).toEqual({ kind: 'no_match', classification: 'phone' })
    expect(resolveAddSomeoneOutcome({ ...base, query: '@ghost', searched: true })).toEqual({
      kind: 'no_match',
      classification: 'handle',
    })
  })
})

describe('buildAddSomeoneHandoff', () => {
  it('targets the Add-someone block', () => {
    expect(buildAddSomeoneHandoff().type).toBe(ADD_SOMEONE_FOCUS_EVENT)
  })

  it('carries no search term into the lookup path', () => {
    // The friends-filter term is a name; the lookup is exact handle-or-phone
    // only. The exit must hand the user off with an empty input, never seed the
    // typed fragment — so the event detail stays undefined.
    expect(buildAddSomeoneHandoff().detail).toBeUndefined()
  })
})

describe('addSuccessToast', () => {
  it('reads as a pending request for an approval-required account', () => {
    expect(addSuccessToast('created', 'none')).toBe('Request sent.')
    expect(addSuccessToast(undefined, 'none')).toBe('Request sent.')
  })

  it('reads as a one-way follow when auto-approved from a cold start', () => {
    expect(addSuccessToast('auto_approved', 'none')).toBe("You're now following.")
  })

  it('reads as a mutual friendship when auto-approved while following back', () => {
    expect(addSuccessToast('auto_approved', 'follows_you')).toBe("You're now friends.")
  })
})
