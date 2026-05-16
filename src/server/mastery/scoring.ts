/**
 * Mastery scoring helpers. Pure functions — no DB access. Used by every
 * answer-writing surface to translate (difficulty, answer_state) into the
 * points to award.
 *
 * See PRD §8.32 for the canonical table. All numeric constants live in
 * src/server/mastery/constants.ts.
 */

import type { AnswerState, DifficultyEstimate } from '@/types/db'

import {
  DIFFICULTY_BASE_POINTS,
  PORTRAIT_DIFFICULTY_WEIGHT,
} from '@/server/mastery/constants'

type LegacyDifficultyEstimate =
  | DifficultyEstimate
  | 'accessible'
  | 'moderate'
  | 'specialist'

export function getDifficultyPoints(difficulty: LegacyDifficultyEstimate): number {
  return PORTRAIT_DIFFICULTY_WEIGHT[difficulty]
}

/** PRD §8.32 — answering points from difficulty + answer_state (live-equivalent base before session weight). */
export function getBasePoints(
  difficulty: LegacyDifficultyEstimate | null,
  answerState: AnswerState,
): number {
  if (answerState === 'repeat_correct' || answerState === 'incorrect') return 0
  const d = difficulty ?? 'moderate'
  return DIFFICULTY_BASE_POINTS[d][answerState]
}

/** PRD §8.32 — creator earnings from empirical correct rate on the question. */
export function creatorEarningsFromEmpiricalRate(correctCount: number, askedCount: number): number {
  if (askedCount <= 0) return 50
  const rate = correctCount / askedCount
  if (rate > 0.7) return 25
  if (rate >= 0.4) return 50
  return 100
}

type CreatorMasteryWindowConfig = {
  basePoints: number
  fullCreditWindow: number
  reducedCreditWindow: number
}

function creatorMasteryWindowFromEmpiricalRate(
  correctCount: number,
  askedCount: number,
): CreatorMasteryWindowConfig {
  if (askedCount <= 0) {
    return { basePoints: 50, fullCreditWindow: 3, reducedCreditWindow: 3 }
  }
  const rate = correctCount / askedCount
  if (rate > 0.7) {
    return { basePoints: 25, fullCreditWindow: 2, reducedCreditWindow: 2 }
  }
  if (rate >= 0.4) {
    return { basePoints: 50, fullCreditWindow: 3, reducedCreditWindow: 3 }
  }
  return { basePoints: 100, fullCreditWindow: 5, reducedCreditWindow: 5 }
}

/**
 * Author credit uses the empirical-rate windowed scheme (confirmed 2026-05-16,
 * product decision: Option B). Accessible questions earn no credit — only
 * Moderate and Specialist questions qualify, per PRD §8.32.
 */
export function creatorMasteryAwardForNthCorrect(
  correctCount: number,
  askedCount: number,
  countedCorrectOrdinal: number,
  difficulty?: LegacyDifficultyEstimate | null,
): { basePoints: number; weight: number; awardedPoints: number } {
  // Accessible questions do not earn author credit (PRD §8.32, all models agree).
  if (difficulty === 'accessible') {
    const { basePoints } = creatorMasteryWindowFromEmpiricalRate(correctCount, askedCount)
    return { basePoints, weight: 0, awardedPoints: 0 }
  }

  const { basePoints, fullCreditWindow, reducedCreditWindow } = creatorMasteryWindowFromEmpiricalRate(
    correctCount,
    askedCount,
  )
  const maxCountedCorrectAnswers = fullCreditWindow + reducedCreditWindow
  if (countedCorrectOrdinal > maxCountedCorrectAnswers) {
    return { basePoints, weight: 0, awardedPoints: 0 }
  }
  const weight = countedCorrectOrdinal <= fullCreditWindow ? 1 : 0.5
  return {
    basePoints,
    weight,
    awardedPoints: Math.round(basePoints * weight),
  }
}
