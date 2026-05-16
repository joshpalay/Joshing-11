import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, userDomainDifficulties, users } from '@/server/db';

const MIN_ADAPTIVE_LEVEL = 1.0;
const MAX_ADAPTIVE_LEVEL = 4.0;
const ADAPTIVE_STEP = 0.2;
const RECENT_ANSWER_LIMIT = 25;

export type AdaptiveDifficultyHint = {
  targetCorrectRate: number;
  difficultyLabel: string;
  promptHint: string;
};

type RecentAnswerRow = {
  isCorrect: boolean;
  answeredAt: Date;
};

function clampAdaptiveLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_ADAPTIVE_LEVEL;
  return Math.min(MAX_ADAPTIVE_LEVEL, Math.max(MIN_ADAPTIVE_LEVEL, level));
}

function roundLevel(level: number): number {
  return Math.round(clampAdaptiveLevel(level) * 10) / 10;
}

async function readCurrentAdaptiveLevel(userId: string): Promise<number> {
  const [user] = await db
    .select({ adaptiveLevel: users.adaptiveLevel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return roundLevel(user?.adaptiveLevel ?? MIN_ADAPTIVE_LEVEL);
}

async function readRecentAnsweredQuestions(userId: string): Promise<RecentAnswerRow[]> {
  const rows = await db.execute(sql<RecentAnswerRow>`
    select "isCorrect", "answeredAt"
    from (
      select
        (slot ->> 'answer_state') = 'correct' as "isCorrect",
        dq."created_at" as "answeredAt"
      from "DailyQueue" dq
      cross join lateral jsonb_array_elements(dq."slots") as slot
      where dq."user_id" = ${userId}
        and (slot ->> 'answered')::boolean = true
        and (slot ->> 'answer_state') in ('correct', 'incorrect')

      union all

      select
        me."answer_state" <> 'incorrect' as "isCorrect",
        me."created_at" as "answeredAt"
      from "MASTERY_EVENTS" me
      where me."answered_by_user_id" = ${userId}
        and me."session_context" = 'feed'
        and me."answer_state" is not null

      union all

      select
        jgr."isCorrect" = true as "isCorrect",
        coalesce(jgr."answeredAt", jgr."createdAt") as "answeredAt"
      from "JoshingGameResponse" jgr
      where jgr."userId" = ${userId}
        and jgr."isCorrect" is not null
    ) recent_answers
    order by "answeredAt" desc
    limit ${RECENT_ANSWER_LIMIT}
  `);

  return rows.rows.map((row) => {
    const record = row as Record<string, unknown>;
    const answeredAt = record.answeredAt;
    return {
      isCorrect: Boolean(record.isCorrect),
      answeredAt: answeredAt instanceof Date ? answeredAt : new Date(answeredAt as string | number),
    };
  });
}

export function applyAdaptiveLevelAdjustment(currentLevel: number, correctRate: number): number {
  if (correctRate > 0.75) return roundLevel(currentLevel + ADAPTIVE_STEP);
  if (correctRate < 0.45) return roundLevel(currentLevel - ADAPTIVE_STEP);
  return currentLevel;
}

export async function computeAdaptiveLevel(userId: string): Promise<number> {
  const [currentLevel, recentAnswers] = await Promise.all([
    readCurrentAdaptiveLevel(userId),
    readRecentAnsweredQuestions(userId),
  ]);

  if (recentAnswers.length === 0) return currentLevel;

  const correctCount = recentAnswers.filter((answer) => answer.isCorrect).length;
  const correctRate = correctCount / recentAnswers.length;

  return applyAdaptiveLevelAdjustment(currentLevel, correctRate);
}

export async function updateAdaptiveLevel(userId: string): Promise<number> {
  const level = await computeAdaptiveLevel(userId);

  await db
    .update(users)
    .set({ adaptiveLevel: level, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return level;
}

export function mapAdaptiveLevelToDifficultyHint(level: number): AdaptiveDifficultyHint {
  const normalized = clampAdaptiveLevel(level);

  if (normalized < 1.5) {
    return {
      targetCorrectRate: 0.78,
      difficultyLabel: 'approachable trivia',
      promptHint: 'Target roughly a 78% correct rate. Write friendly, recognizable questions a casually interested person in the domain would get — lean on well-known facts, not deep cuts.',
    };
  }

  if (normalized < 2.5) {
    return {
      targetCorrectRate: 0.62,
      difficultyLabel: 'fair and familiar',
      promptHint: 'Target roughly a 62% correct rate. Write questions a reasonably engaged fan of the domain should know without needing specialist depth.',
    };
  }

  if (normalized < 3.5) {
    return {
      targetCorrectRate: 0.35,
      difficultyLabel: 'hard for someone with depth',
      promptHint: 'Target roughly a 35% correct rate. Write questions that are hard even for someone with real depth in the domain.',
    };
  }

  return {
    targetCorrectRate: 0.15,
    difficultyLabel: 'expert-level deep cuts',
    promptHint: 'Target roughly a 15% correct rate. Write expert-level deep cuts with specific facts, dates, terminology, or details.',
  };
}

// ---------------------------------------------------------------------------
// Per-domain adaptive difficulty
// ---------------------------------------------------------------------------

export type ServedDifficulty = 'accessible' | 'moderate' | 'specialist';

const DIFFICULTY_LADDER: ServedDifficulty[] = ['accessible', 'moderate', 'specialist'];
const STREAK_TO_STEP = 2;

/** Difficulty preference key understood by generate-questions.ts. */
type DifficultyPreference = 'normal' | 'moderate' | 'challenging';

const SERVED_TO_PREFERENCE: Record<ServedDifficulty, DifficultyPreference> = {
  accessible: 'normal',
  moderate: 'moderate',
  specialist: 'challenging',
};

function seedDifficultyFromAdaptiveLevel(level: number): ServedDifficulty {
  const normalized = clampAdaptiveLevel(level);
  if (normalized < 1.5) return 'accessible';
  if (normalized < 2.5) return 'moderate';
  return 'specialist';
}

function stepDifficulty(current: ServedDifficulty, direction: 1 | -1): ServedDifficulty {
  const idx = DIFFICULTY_LADDER.indexOf(current);
  const next = Math.min(DIFFICULTY_LADDER.length - 1, Math.max(0, idx + direction));
  return DIFFICULTY_LADDER[next];
}

export type DomainDifficultyState = {
  servedDifficulty: ServedDifficulty;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
};

export function computeDomainDifficultyStep(
  existing: DomainDifficultyState,
  isCorrect: boolean,
): DomainDifficultyState {
  let nextCorrect = isCorrect ? existing.consecutiveCorrect + 1 : 0;
  let nextIncorrect = isCorrect ? 0 : existing.consecutiveIncorrect + 1;
  let nextDifficulty: ServedDifficulty = existing.servedDifficulty;

  if (isCorrect && nextCorrect >= STREAK_TO_STEP && existing.servedDifficulty !== 'specialist') {
    nextDifficulty = stepDifficulty(existing.servedDifficulty, 1);
    nextCorrect = 0;
  } else if (!isCorrect && nextIncorrect >= STREAK_TO_STEP && existing.servedDifficulty !== 'accessible') {
    nextDifficulty = stepDifficulty(existing.servedDifficulty, -1);
    nextIncorrect = 0;
  }

  return { servedDifficulty: nextDifficulty, consecutiveCorrect: nextCorrect, consecutiveIncorrect: nextIncorrect };
}

/**
 * Update per-domain difficulty after a graded answer. Two consecutive correct →
 * step up; two consecutive incorrect → step down. Streak counter resets when
 * the level moves so a single wobble doesn't immediately yo-yo.
 */
export async function updateDomainDifficultyOnAnswer(
  userId: string,
  canonicalSubcategory: string,
  isCorrect: boolean,
): Promise<void> {
  if (!canonicalSubcategory) return;

  const [existing] = await db
    .select()
    .from(userDomainDifficulties)
    .where(and(
      eq(userDomainDifficulties.userId, userId),
      eq(userDomainDifficulties.canonicalSubcategory, canonicalSubcategory),
    ))
    .limit(1);

  if (!existing) {
    const seed = seedDifficultyFromAdaptiveLevel(await readCurrentAdaptiveLevel(userId));
    await db.insert(userDomainDifficulties).values({
      userId,
      canonicalSubcategory,
      servedDifficulty: seed,
      consecutiveCorrect: isCorrect ? 1 : 0,
      consecutiveIncorrect: isCorrect ? 0 : 1,
      lastUpdated: new Date(),
    });
    return;
  }

  const next = computeDomainDifficultyStep(existing, isCorrect);

  await db
    .update(userDomainDifficulties)
    .set({
      servedDifficulty: next.servedDifficulty,
      consecutiveCorrect: next.consecutiveCorrect,
      consecutiveIncorrect: next.consecutiveIncorrect,
      lastUpdated: new Date(),
    })
    .where(eq(userDomainDifficulties.id, existing.id));
}

/**
 * For each requested domain, return the user's current per-domain difficulty
 * mapped to a `difficultyPreference` key the prompt builder understands. Domains
 * with no row are seeded from the user's global adaptiveLevel so first-contact
 * still respects overall skill.
 */
export async function getDomainDifficultyOverrides(
  userId: string,
  domains: string[],
): Promise<Map<string, DifficultyPreference>> {
  const overrides = new Map<string, DifficultyPreference>();
  if (domains.length === 0) return overrides;

  const rows = await db
    .select({
      canonicalSubcategory: userDomainDifficulties.canonicalSubcategory,
      servedDifficulty: userDomainDifficulties.servedDifficulty,
    })
    .from(userDomainDifficulties)
    .where(and(
      eq(userDomainDifficulties.userId, userId),
      inArray(userDomainDifficulties.canonicalSubcategory, domains),
    ));

  const known = new Map<string, ServedDifficulty>();
  for (const row of rows) {
    known.set(row.canonicalSubcategory, row.servedDifficulty as ServedDifficulty);
  }

  const seedLevel = known.size === domains.length
    ? null
    : await readCurrentAdaptiveLevel(userId);

  for (const domain of domains) {
    const served = known.get(domain) ?? seedDifficultyFromAdaptiveLevel(seedLevel ?? MIN_ADAPTIVE_LEVEL);
    overrides.set(domain, SERVED_TO_PREFERENCE[served]);
  }

  return overrides;
}
