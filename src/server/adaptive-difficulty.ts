/**
 * Bidirectional adaptive difficulty — updates the per-user, per-domain
 * served_difficulty preference after each answered question.
 *
 * Rules (PRD Prompt 5):
 *   - 3+ consecutive incorrect in a domain → step difficulty down (floor: accessible)
 *   - 3+ consecutive correct in a domain  → step difficulty up   (ceiling: specialist)
 *   - Adjustments are independent of mastery tier / mastery points.
 *   - Default served difficulty for a new domain: moderate.
 */

import { prisma } from '@/lib/prisma';
import type { DifficultyEstimate } from '@prisma/client';

const DIFFICULTY_STEPS: DifficultyEstimate[] = ['accessible', 'moderate', 'specialist'];

function stepDown(d: DifficultyEstimate): DifficultyEstimate {
  const idx = DIFFICULTY_STEPS.indexOf(d);
  return idx > 0 ? DIFFICULTY_STEPS[idx - 1] : d;
}

function stepUp(d: DifficultyEstimate): DifficultyEstimate {
  const idx = DIFFICULTY_STEPS.indexOf(d);
  return idx < DIFFICULTY_STEPS.length - 1 ? DIFFICULTY_STEPS[idx + 1] : d;
}

/**
 * Update the UserDomainDifficulty record for a user's domain after an answer.
 * Must be called fire-and-forget — does not block the answer submission response.
 */
export async function updateDomainDifficulty(
  userId: string,
  canonicalSubcategory: string | null | undefined,
  result: 'correct' | 'wrong'
): Promise<void> {
  if (!canonicalSubcategory) return;

  // Upsert to ensure the record exists with defaults before we read it.
  const existing = await prisma.userDomainDifficulty.upsert({
    where: { user_id_canonical_subcategory: { user_id: userId, canonical_subcategory: canonicalSubcategory } },
    create: {
      user_id: userId,
      canonical_subcategory: canonicalSubcategory,
      served_difficulty: 'moderate',
      consecutive_correct: 0,
      consecutive_incorrect: 0,
    },
    update: {},
  });

  const isCorrect = result === 'correct';
  const newCorrect = isCorrect ? existing.consecutive_correct + 1 : 0;
  const newIncorrect = isCorrect ? 0 : existing.consecutive_incorrect + 1;

  let newServedDifficulty = existing.served_difficulty;
  let finalCorrect = newCorrect;
  let finalIncorrect = newIncorrect;

  if (newIncorrect >= 3 && newServedDifficulty !== 'accessible') {
    newServedDifficulty = stepDown(newServedDifficulty);
    finalCorrect = 0;
    finalIncorrect = 0;
  } else if (newCorrect >= 3 && newServedDifficulty !== 'specialist') {
    newServedDifficulty = stepUp(newServedDifficulty);
    finalCorrect = 0;
    finalIncorrect = 0;
  }

  await prisma.userDomainDifficulty.update({
    where: { user_id_canonical_subcategory: { user_id: userId, canonical_subcategory: canonicalSubcategory } },
    data: {
      served_difficulty: newServedDifficulty,
      consecutive_correct: finalCorrect,
      consecutive_incorrect: finalIncorrect,
    },
  });
}
