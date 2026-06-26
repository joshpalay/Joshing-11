import { describe, expect, it } from 'vitest'

import { canonicalPointsForAnswer } from '@/lib/game-constants'
import {
  CATCHUP_SURFACE_WEIGHT,
  DIFFICULTY_BASE_POINTS,
  LIVE_SURFACE_WEIGHT,
  RECOVERY_STATE_WEIGHT,
} from '@/server/mastery/constants'
import type { AnswerState, DifficultyEstimate } from '@/types/db'

/**
 * Pins the single answer scorer (D-RECOVERY-SCORING-UNIFY-01). All five answer
 * routes call canonicalPointsForAnswer; this is the contract they share.
 *
 * The expected numbers below are hand-computed (NOT derived from the same
 * constants the helper reads) so the table is an independent check — a refactor
 * that quietly re-tunes a weight or column has to break a literal here.
 */
describe('canonicalPointsForAnswer', () => {
  // Hand-computed expectations: [difficulty, state, catchUp] -> points.
  // base: specialist 100 / moderate 50 / accessible 10 (= first_correct).
  // live first_correct  = base
  // live recovery       = round(base × 0.25)  → 25 / 13 / 3
  // catch-up first      = round(base × 0.25)  → 25 / 13 / 3
  // catch-up recovery   = round(base × 0.25)  → 25 / 13 / 3  (D1: 25%, NOT 6.25%)
  // repeat_correct / incorrect = 0 everywhere
  const EXPECTED: Array<{
    difficulty: DifficultyEstimate | null
    answerState: AnswerState
    catchUp: boolean
    expected: number
  }> = [
    // specialist (base 100)
    { difficulty: 'specialist', answerState: 'first_correct', catchUp: false, expected: 100 },
    { difficulty: 'specialist', answerState: 'first_correct', catchUp: true, expected: 25 },
    { difficulty: 'specialist', answerState: 'first_correct_after_wrong', catchUp: false, expected: 25 },
    { difficulty: 'specialist', answerState: 'first_correct_after_wrong', catchUp: true, expected: 25 },
    { difficulty: 'specialist', answerState: 'repeat_correct', catchUp: false, expected: 0 },
    { difficulty: 'specialist', answerState: 'incorrect', catchUp: false, expected: 0 },
    { difficulty: 'specialist', answerState: 'repeat_correct', catchUp: true, expected: 0 },
    { difficulty: 'specialist', answerState: 'incorrect', catchUp: true, expected: 0 },
    // moderate (base 50)
    { difficulty: 'moderate', answerState: 'first_correct', catchUp: false, expected: 50 },
    { difficulty: 'moderate', answerState: 'first_correct', catchUp: true, expected: 13 },
    { difficulty: 'moderate', answerState: 'first_correct_after_wrong', catchUp: false, expected: 13 },
    { difficulty: 'moderate', answerState: 'first_correct_after_wrong', catchUp: true, expected: 13 },
    { difficulty: 'moderate', answerState: 'repeat_correct', catchUp: false, expected: 0 },
    { difficulty: 'moderate', answerState: 'incorrect', catchUp: false, expected: 0 },
    // accessible (base 10)
    { difficulty: 'accessible', answerState: 'first_correct', catchUp: false, expected: 10 },
    { difficulty: 'accessible', answerState: 'first_correct', catchUp: true, expected: 3 },
    { difficulty: 'accessible', answerState: 'first_correct_after_wrong', catchUp: false, expected: 3 },
    { difficulty: 'accessible', answerState: 'first_correct_after_wrong', catchUp: true, expected: 3 },
    { difficulty: 'accessible', answerState: 'repeat_correct', catchUp: false, expected: 0 },
    { difficulty: 'accessible', answerState: 'incorrect', catchUp: false, expected: 0 },
  ]

  it.each(EXPECTED)(
    '$difficulty / $answerState / catchUp=$catchUp → $expected',
    ({ difficulty, answerState, catchUp, expected }) => {
      expect(canonicalPointsForAnswer({ difficulty, answerState, catchUp })).toBe(expected)
    },
  )

  it('first_correct earns the full difficulty base (live)', () => {
    expect(canonicalPointsForAnswer({ difficulty: 'specialist', answerState: 'first_correct' })).toBe(100)
    expect(canonicalPointsForAnswer({ difficulty: 'moderate', answerState: 'first_correct' })).toBe(50)
    expect(canonicalPointsForAnswer({ difficulty: 'accessible', answerState: 'first_correct' })).toBe(10)
  })

  it('repeat_correct and incorrect always earn 0 (no double-credit), live or catch-up', () => {
    for (const catchUp of [false, true]) {
      for (const difficulty of ['specialist', 'moderate', 'accessible', null] as const) {
        expect(canonicalPointsForAnswer({ difficulty, answerState: 'repeat_correct', catchUp })).toBe(0)
        expect(canonicalPointsForAnswer({ difficulty, answerState: 'incorrect', catchUp })).toBe(0)
      }
    }
  })

  it('catch-up first_correct applies the 0.25× catch-up surface weight', () => {
    expect(canonicalPointsForAnswer({ difficulty: 'specialist', answerState: 'first_correct', catchUp: true })).toBe(25)
    expect(canonicalPointsForAnswer({ difficulty: 'moderate', answerState: 'first_correct', catchUp: true })).toBe(13)
    expect(canonicalPointsForAnswer({ difficulty: 'accessible', answerState: 'first_correct', catchUp: true })).toBe(3)
  })

  it('catch-up recovery is 25% of full base — the recovery weight does NOT stack on catch-up (D1)', () => {
    // The decided rule: recovery earns round(base × RECOVERY_STATE_WEIGHT)
    // whether live or catch-up — never CATCHUP × RECOVERY (6.25% → 6/3/1).
    expect(canonicalPointsForAnswer({ difficulty: 'specialist', answerState: 'first_correct_after_wrong', catchUp: true })).toBe(25)
    expect(canonicalPointsForAnswer({ difficulty: 'moderate', answerState: 'first_correct_after_wrong', catchUp: true })).toBe(13)
    expect(canonicalPointsForAnswer({ difficulty: 'accessible', answerState: 'first_correct_after_wrong', catchUp: true })).toBe(3)
    // And it equals the live recovery value (catchUp must not change recovery).
    for (const difficulty of ['specialist', 'moderate', 'accessible'] as const) {
      expect(
        canonicalPointsForAnswer({ difficulty, answerState: 'first_correct_after_wrong', catchUp: true }),
      ).toBe(canonicalPointsForAnswer({ difficulty, answerState: 'first_correct_after_wrong', catchUp: false }))
    }
  })

  it('null/unknown difficulty falls back to moderate', () => {
    expect(canonicalPointsForAnswer({ difficulty: null, answerState: 'first_correct' })).toBe(
      DIFFICULTY_BASE_POINTS.moderate.first_correct,
    )
    expect(canonicalPointsForAnswer({ difficulty: undefined, answerState: 'first_correct' })).toBe(50)
  })

  it('weights are the expected 1 / 0.25 / 0.25 (guards an accidental retune)', () => {
    expect(LIVE_SURFACE_WEIGHT).toBe(1)
    expect(CATCHUP_SURFACE_WEIGHT).toBe(0.25)
    expect(RECOVERY_STATE_WEIGHT).toBe(0.25)
  })
})

/**
 * C1 invariant — the load-bearing cross-check. The multiply path is canonical
 * (Decision A1), but the live routes historically read the
 * first_correct_after_wrong table column. They stay byte-identical only while
 * the column equals round(first_correct × RECOVERY_STATE_WEIGHT). Pin it per
 * tier so editing either side can never silently desync them.
 */
describe('C1 invariant: first_correct_after_wrong column === round(first_correct × RECOVERY_STATE_WEIGHT)', () => {
  it.each(['specialist', 'moderate', 'accessible'] as const)(
    '%s tier',
    (tier) => {
      const { first_correct, first_correct_after_wrong } = DIFFICULTY_BASE_POINTS[tier]
      expect(Math.round(first_correct * RECOVERY_STATE_WEIGHT)).toBe(first_correct_after_wrong)
    },
  )
})
