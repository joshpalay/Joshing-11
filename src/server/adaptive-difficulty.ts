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

import { and, eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { userDomainDifficulties } from '@/server/db/schema';
import type { DifficultyEstimate } from '@/types/db';

type ServedDifficultyEstimate = Extract<DifficultyEstimate, never> | 'accessible' | 'moderate' | 'specialist';

const DIFFICULTY_STEPS: ServedDifficultyEstimate[] = ['accessible', 'moderate', 'specialist'];

function stepDown(d: ServedDifficultyEstimate): ServedDifficultyEstimate {
  const idx = DIFFICULTY_STEPS.indexOf(d);
  return idx > 0 ? DIFFICULTY_STEPS[idx - 1] : d;
}

function stepUp(d: ServedDifficultyEstimate): ServedDifficultyEstimate {
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
  const [existing] = await db
    .insert(userDomainDifficulties)
    .values({
      userId,
      canonicalSubcategory,
      servedDifficulty: 'moderate',
      consecutiveCorrect: 0,
      consecutiveIncorrect: 0,
    })
    .onConflictDoNothing({
      target: [userDomainDifficulties.userId, userDomainDifficulties.canonicalSubcategory],
    })
    .returning();

  const current =
    existing ??
    (await db.query.userDomainDifficulties.findFirst({
      where: and(
        eq(userDomainDifficulties.userId, userId),
        eq(userDomainDifficulties.canonicalSubcategory, canonicalSubcategory),
      ),
    }));

  if (!current) return;

  const isCorrect = result === 'correct';
  const newCorrect = isCorrect ? current.consecutiveCorrect + 1 : 0;
  const newIncorrect = isCorrect ? 0 : current.consecutiveIncorrect + 1;

  let newServedDifficulty = current.servedDifficulty;
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

  await db
    .update(userDomainDifficulties)
    .set({
      servedDifficulty: newServedDifficulty,
      consecutiveCorrect: finalCorrect,
      consecutiveIncorrect: finalIncorrect,
      lastUpdated: new Date(),
    })
    .where(
      and(
        eq(userDomainDifficulties.userId, userId),
        eq(userDomainDifficulties.canonicalSubcategory, canonicalSubcategory),
      ),
    );
}
