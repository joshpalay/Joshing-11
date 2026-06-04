import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, declaredInterests, playerMastery, userDomainDifficulties, users } from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';

const MIN_ADAPTIVE_LEVEL = 1.0;
const MAX_ADAPTIVE_LEVEL = 4.0;
const ADAPTIVE_STEP = 0.2;
const RECENT_ANSWER_LIMIT = 25;

export type AdaptiveDifficultyHint = {
  targetCorrectRate: number;
  difficultyLabel: string;
  promptHint: string;
  // The difficulty_estimate tier a question generated at this level targets.
  // The generator only emits three tiers, so the three hardest adaptive bands
  // (enthusiast, specialist, expert) all map to 'specialist'. Lets the bank-reuse
  // path request a stored question whose tier matches what fresh generation would
  // have produced.
  estimate: 'accessible' | 'moderate' | 'specialist';
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
      promptHint: 'Target roughly a 78% correct rate. Write questions someone with a passing interest in the domain would recognize — lean on its well-known landmarks and the facts anyone who has encountered it would have met, not deep cuts.',
      estimate: 'accessible',
    };
  }

  if (normalized < 2.5) {
    return {
      targetCorrectRate: 0.62,
      difficultyLabel: 'engaged fan',
      promptHint: 'Target roughly a 62% correct rate. Write questions someone who actively follows the domain should know — the works, figures, and moments a regular fan keeps track of, without needing specialist depth.',
      estimate: 'moderate',
    };
  }

  // Enthusiast rung — the calibration guardrail (PRD-D-5 §5.2). This text is
  // load-bearing: it must stay "chose to learn ... NOT scholar/archivist
  // minutiae" so the floor does not swing back to "really REALLY hard."
  if (normalized < 3.0) {
    return {
      targetCorrectRate: 0.50,
      difficultyLabel: 'enthusiast',
      promptHint: 'Target roughly a 50% correct rate. Write questions someone who CHOSE to learn this domain would know — its structure, its famous moments, and the second-order facts enthusiasts trade — but NOT scholar- or archivist-level minutiae.',
      estimate: 'specialist',
    };
  }

  if (normalized < 3.5) {
    return {
      targetCorrectRate: 0.35,
      difficultyLabel: 'hard for someone with depth',
      promptHint: 'Target roughly a 35% correct rate. Write questions that are hard even for someone with real depth in the domain.',
      estimate: 'specialist',
    };
  }

  return {
    targetCorrectRate: 0.15,
    difficultyLabel: 'expert-level deep cuts',
    promptHint: 'Target roughly a 15% correct rate. Write expert-level deep cuts with specific facts, dates, terminology, or details.',
    estimate: 'specialist',
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

/**
 * The "engaged-fan" rung, expressed on the per-domain served-difficulty ladder
 * (moderate). It is the hard floor for a domain the player explicitly DECLARED:
 * someone who raised their hand for a topic finds accessible ("tourist") trivia
 * condescendingly easy, so a declared domain both *seeds* here and *cannot erode
 * below* here (PRD-D-5 §5.2, D3). Demonstrated domains are NOT floored — they
 * start low and retain the full adaptive range down to accessible.
 */
const FOCUS_DOMAIN_MIN_DIFFICULTY: ServedDifficulty = 'moderate';

export function applyFocusFloor(difficulty: ServedDifficulty, isDeclaredDomain: boolean): ServedDifficulty {
  if (!isDeclaredDomain) return difficulty;
  return DIFFICULTY_LADDER.indexOf(difficulty) >= DIFFICULTY_LADDER.indexOf(FOCUS_DOMAIN_MIN_DIFFICULTY)
    ? difficulty
    : FOCUS_DOMAIN_MIN_DIFFICULTY;
}

/**
 * Canonical subcategories the player explicitly DECLARED — stated focus areas
 * (`declaredInterests`) plus PLAYER_MASTERY rows whose `territoryType` is
 * 'declared' (friend-mediated acceptances that came in as declared territory).
 * This is the signal that keys the difficulty floor (D2/D3): declared domains
 * seed at engaged-fan and cannot erode to accessible; demonstrated domains (the
 * rest) get the full adaptive range. Splitting declared from demonstrated here
 * is what stops the floor from pinning newcomer/demonstrated domains too high
 * (PRD-D-5 §5.2, DRIFT RISK 2). Pass `domains` to scope the lookup to the round.
 */
async function getDeclaredDomainSet(userId: string, domains: string[]): Promise<Set<string>> {
  const declared = new Set<string>();
  if (domains.length === 0) return declared;

  const declaredRows = await db
    .select({ domain: declaredInterests.domain })
    .from(declaredInterests)
    .where(and(
      eq(declaredInterests.userId, userId),
      eq(declaredInterests.isActive, true),
      inArray(declaredInterests.domain, domains),
    ));
  for (const row of declaredRows) declared.add(row.domain);

  try {
    const masteryRows = await db
      .select({
        domain: playerMastery.canonicalSubcategory,
        territoryType: playerMastery.territoryType,
      })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, userId),
        inArray(playerMastery.canonicalSubcategory, domains),
      ));
    for (const row of masteryRows) {
      if (row.territoryType === 'declared') declared.add(row.domain);
    }
  } catch (error) {
    // territoryType is additive; on a DB where the column hasn't landed yet
    // (42703) fall back to declaredInterests alone — the safe direction, since
    // a missed declared mastery row only means a domain isn't floored, never
    // that a demonstrated one is wrongly pinned.
    if (pgErrorCode(error) !== '42703') throw error;
  }

  return declared;
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
  floor: ServedDifficulty = 'accessible',
): DomainDifficultyState {
  let nextCorrect = isCorrect ? existing.consecutiveCorrect + 1 : 0;
  let nextIncorrect = isCorrect ? 0 : existing.consecutiveIncorrect + 1;
  let nextDifficulty: ServedDifficulty = existing.servedDifficulty;

  const floorIdx = DIFFICULTY_LADDER.indexOf(floor);

  if (isCorrect && nextCorrect >= STREAK_TO_STEP && existing.servedDifficulty !== 'specialist') {
    nextDifficulty = stepDifficulty(existing.servedDifficulty, 1);
    nextCorrect = 0;
  } else if (!isCorrect && nextIncorrect >= STREAK_TO_STEP && DIFFICULTY_LADDER.indexOf(existing.servedDifficulty) > floorIdx) {
    // Two-incorrect step-down — but never below the floor. For a declared
    // domain the floor is the engaged-fan rung (moderate), so it erodes within
    // the upper band but can't drop to accessible/tourist level (PRD-D-5 §5.2).
    // Demonstrated domains pass the default 'accessible' floor and retain the
    // full range, matching the prior behaviour exactly.
    nextDifficulty = stepDifficulty(existing.servedDifficulty, -1);
    nextIncorrect = 0;
  }

  return { servedDifficulty: nextDifficulty, consecutiveCorrect: nextCorrect, consecutiveIncorrect: nextIncorrect };
}

/**
 * Update per-domain difficulty after a graded answer. Two consecutive correct →
 * step up; two consecutive incorrect → step down. Streak counter resets when
 * the level moves so a single wobble doesn't immediately yo-yo. Declared domains
 * are floored at the engaged-fan rung (moderate) on both seed and erosion;
 * demonstrated domains seed low and retain the full range down to accessible.
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
    const [level, declaredDomains] = await Promise.all([
      readCurrentAdaptiveLevel(userId),
      getDeclaredDomainSet(userId, [canonicalSubcategory]),
    ]);
    const seed = applyFocusFloor(
      seedDifficultyFromAdaptiveLevel(level),
      declaredDomains.has(canonicalSubcategory),
    );
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

  // Declared domains carry the engaged-fan erosion floor; demonstrated domains
  // step down freely (default 'accessible' floor).
  const declaredDomains = await getDeclaredDomainSet(userId, [canonicalSubcategory]);
  const floor: ServedDifficulty = declaredDomains.has(canonicalSubcategory)
    ? FOCUS_DOMAIN_MIN_DIFFICULTY
    : 'accessible';
  const next = computeDomainDifficultyStep(existing, isCorrect, floor);

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

  // Only domains without a persisted row need a first-contact seed. Pull the
  // user's adaptive level and which of those domains are declared so we can
  // floor the seed to the engaged-fan rung for the latter (demonstrated domains
  // seed straight off the adaptive level and may start at accessible).
  const domainsNeedingSeed = domains.filter((domain) => !known.has(domain));
  const [seedLevel, declaredDomains] = domainsNeedingSeed.length === 0
    ? [MIN_ADAPTIVE_LEVEL, new Set<string>()]
    : await Promise.all([
        readCurrentAdaptiveLevel(userId),
        getDeclaredDomainSet(userId, domainsNeedingSeed),
      ]);

  for (const domain of domains) {
    const served = known.get(domain)
      ?? applyFocusFloor(seedDifficultyFromAdaptiveLevel(seedLevel), declaredDomains.has(domain));
    overrides.set(domain, SERVED_TO_PREFERENCE[served]);
  }

  return overrides;
}
