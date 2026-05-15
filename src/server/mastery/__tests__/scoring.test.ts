import { describe, expect, it } from 'vitest'
import {
  creatorEarningsFromEmpiricalRate,
  creatorMasteryAwardForNthCorrect,
  getBasePoints,
  getDifficultyPoints,
} from '@/server/mastery/scoring'

describe('mastery scoring helpers (F2.6)', () => {
  it('maps portrait difficulty weights for accessible/moderate/specialist', () => {
    expect(getDifficultyPoints('accessible')).toBe(1)
    expect(getDifficultyPoints('moderate')).toBe(2)
    expect(getDifficultyPoints('specialist')).toBe(3)
  })

  it('getBasePoints follows §8.32 tables', () => {
    expect(getBasePoints('moderate', 'first_correct')).toBe(50)
    expect(getBasePoints('moderate', 'first_correct_after_wrong')).toBe(13)
    expect(getBasePoints('moderate', 'repeat_correct')).toBe(0)
    expect(getBasePoints('moderate', 'incorrect')).toBe(0)
    expect(getBasePoints('specialist', 'first_correct')).toBe(100)
    expect(getBasePoints('accessible', 'first_correct')).toBe(10)
  })

  it('defaults to moderate when difficulty is null', () => {
    expect(getBasePoints(null, 'first_correct')).toBe(50)
  })

  it('creator earnings use empirical buckets with medium default', () => {
    expect(creatorEarningsFromEmpiricalRate(8, 10)).toBe(25)
    expect(creatorEarningsFromEmpiricalRate(5, 10)).toBe(50)
    expect(creatorEarningsFromEmpiricalRate(2, 10)).toBe(100)
    expect(creatorEarningsFromEmpiricalRate(0, 0)).toBe(50)
  })

  it('creator mastery diminishing returns + cap uses easy/medium/hard windows', () => {
    expect(creatorMasteryAwardForNthCorrect(8, 10, 1)).toMatchObject({
      basePoints: 25,
      weight: 1,
      awardedPoints: 25,
    })
    expect(creatorMasteryAwardForNthCorrect(8, 10, 3)).toMatchObject({
      basePoints: 25,
      weight: 0.5,
      awardedPoints: 13,
    })
    expect(creatorMasteryAwardForNthCorrect(8, 10, 5)).toMatchObject({
      basePoints: 25,
      weight: 0,
      awardedPoints: 0,
    })

    expect(creatorMasteryAwardForNthCorrect(5, 10, 3)).toMatchObject({
      basePoints: 50,
      weight: 1,
      awardedPoints: 50,
    })
    expect(creatorMasteryAwardForNthCorrect(5, 10, 6)).toMatchObject({
      basePoints: 50,
      weight: 0.5,
      awardedPoints: 25,
    })

    expect(creatorMasteryAwardForNthCorrect(2, 10, 5)).toMatchObject({
      basePoints: 100,
      weight: 1,
      awardedPoints: 100,
    })
    expect(creatorMasteryAwardForNthCorrect(2, 10, 10)).toMatchObject({
      basePoints: 100,
      weight: 0.5,
      awardedPoints: 50,
    })
    expect(creatorMasteryAwardForNthCorrect(2, 10, 11)).toMatchObject({
      basePoints: 100,
      weight: 0,
      awardedPoints: 0,
    })
  })
})
