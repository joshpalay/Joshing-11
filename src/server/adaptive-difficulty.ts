import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

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
 * Minimum first-contact / erosion difficulty for a domain the player opted into
 * (declared focus, or a friend-shared domain). It floors the *seed* (and, for a
 * DECLARED domain, the *erosion* step-down — PRD-D-5 §5.2, D3) so the difficulty
 * machinery never requests below this for a focus domain.
 *
 * RECALIBRATED 2026-06-28: defaults to 'accessible' (i.e. effectively OFF). The
 * old hard 'moderate' floor blanket-pinned every focus domain to ≥moderate, which
 * (a) BURIED genuinely-good easy questions — they landed below the requested tier
 * and were deflected to the under-difficulty reserve — and (b) pressured the
 * generator to write "deep cut / specialist" questions for naturally-easy topics
 * (a kids'-book series, a sitcom), a driver of hallucinated false canon. Climbing
 * is now left to the signal-keyed levers that already exist — the adaptive-level
 * seed (skilled players still START at moderate/specialist), the two-correct
 * streak ladder, empirical re-labelling, and supply recalibration — rather than a
 * blanket floor. Override via FOCUS_DOMAIN_MIN_DIFFICULTY (set 'moderate' to
 * restore the old behaviour, no deploy).
 */
export function focusDomainMinDifficulty(): ServedDifficulty {
  const raw = process.env.FOCUS_DOMAIN_MIN_DIFFICULTY?.trim();
  return raw === 'moderate' || raw === 'specialist' || raw === 'accessible' ? raw : 'accessible';
}

export function applyFocusFloor(
  difficulty: ServedDifficulty,
  isFocusDomain: boolean,
  floor: ServedDifficulty = focusDomainMinDifficulty(),
): ServedDifficulty {
  if (!isFocusDomain) return difficulty;
  return DIFFICULTY_LADDER.indexOf(difficulty) >= DIFFICULTY_LADDER.indexOf(floor)
    ? difficulty
    : floor;
}

/**
 * Canonical subcategories the player has opted into: declared interests (stated
 * focus areas) plus any open territory in PLAYER_MASTERY — friend-mediated
 * acceptances and authored domains both land there. Used to floor the
 * first-contact *seed* to "Familiar" for any opted-in domain (declared OR
 * demonstrated). The declared/demonstrated split that governs the *erosion*
 * floor lives in `getDeclaredDomainSet`. Pass `domains` to scope the lookup.
 */
async function getFocusDomainSet(userId: string, domains: string[]): Promise<Set<string>> {
  const focus = new Set<string>();
  if (domains.length === 0) return focus;

  const [declaredRows, masteryRows] = await Promise.all([
    db
      .select({ domain: declaredInterests.domain })
      .from(declaredInterests)
      .where(and(
        eq(declaredInterests.userId, userId),
        eq(declaredInterests.isActive, true),
        inArray(declaredInterests.domain, domains),
      )),
    db
      .select({ domain: playerMastery.canonicalSubcategory })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, userId),
        inArray(playerMastery.canonicalSubcategory, domains),
      )),
  ]);

  for (const row of declaredRows) focus.add(row.domain);
  for (const row of masteryRows) focus.add(row.domain);
  return focus;
}

/**
 * Canonical subcategories the player explicitly DECLARED — stated focus areas
 * (`declaredInterests`) plus PLAYER_MASTERY rows whose `territoryType` is
 * 'declared' (friend-mediated acceptances that came in as declared territory).
 * This narrower set keys the hard *erosion* floor (D2/D3): a declared domain
 * cannot erode below engaged-fan, while a demonstrated domain — though it still
 * *seeds* at moderate (see `getFocusDomainSet`) — keeps the full range and can
 * step down to accessible (PRD-D-5 §5.2, DRIFT RISK 2). Pass `domains` to scope.
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
    // Seed floor is for any opted-in (focus) domain — declared or demonstrated.
    const [level, focusDomains] = await Promise.all([
      readCurrentAdaptiveLevel(userId),
      getFocusDomainSet(userId, [canonicalSubcategory]),
    ]);
    const seed = applyFocusFloor(
      seedDifficultyFromAdaptiveLevel(level),
      focusDomains.has(canonicalSubcategory),
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

  if (isFrozen(existing.freezeUntil, new Date())) {
    // Refine Your Game "Ease off": the served difficulty is pinned for the
    // freeze window. Hold the level AND the streak counters so the domain
    // resumes exactly where it left off once the freeze lapses.
    return;
  }

  // Erosion floor is declared-only: declared domains carry the engaged-fan
  // floor, demonstrated domains step down freely (default 'accessible' floor).
  const declaredDomains = await getDeclaredDomainSet(userId, [canonicalSubcategory]);
  const floor: ServedDifficulty = declaredDomains.has(canonicalSubcategory)
    ? focusDomainMinDifficulty()
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

/** True while an "Ease off" freeze is in effect for a domain. */
export function isFrozen(freezeUntil: Date | null | undefined, now: Date): boolean {
  return Boolean(freezeUntil && freezeUntil.getTime() > now.getTime());
}

/**
 * Pure decision for the supply-side correction. Given a domain's currently stored
 * tier, the highest tier we could actually DELIVER for it this run, and its erosion
 * floor, return the tier to pin it to — or `null` when no correction applies. Only
 * ever corrects *overshoot* (returns a strictly lower tier); never promotes. The
 * delivered tier is clamped up to the floor so a declared fan is never demoted below
 * the engaged-fan rung even if only accessible content could be fielded.
 */
export function computeSupplyCorrection(
  current: ServedDifficulty,
  delivered: ServedDifficulty,
  floor: ServedDifficulty,
): ServedDifficulty | null {
  const targetIdx = Math.max(DIFFICULTY_LADDER.indexOf(floor), DIFFICULTY_LADDER.indexOf(delivered));
  if (targetIdx >= DIFFICULTY_LADDER.indexOf(current)) return null;
  return DIFFICULTY_LADDER[targetIdx];
}

/**
 * Supply-side difficulty correction — the counterpart to the demand-side streak
 * ladder in updateDomainDifficultyOnAnswer. A streak step-up is *optimistic*: it can
 * raise a domain to a tier the generator can't actually field (there is, for example,
 * no specialist-tier Tears-of-the-Kingdom content anywhere), so the difficulty gate
 * eats the whole domain and the daily pipeline degrades toward a short Five. Part 1
 * catches that at serve time by filling the slots from the under-difficulty reserve —
 * good questions one or more tiers below what was asked. THIS records the supply
 * ceiling those reserve fills reveal: it pulls the stored servedDifficulty back down
 * to the tier we could actually deliver, so the NEXT run requests what the domain can
 * sustain instead of re-gating the same too-hard ask (Butkicker's ToTK settles at
 * moderate). It only moves a domain DOWN (corrects overshoot, never promotes — that
 * stays the streak ladder's job), respects the same declared/demonstrated erosion
 * floor as the answer-time step-down, and leaves frozen ("Ease off") domains alone.
 * Streak counters reset on a correction, so a re-climb needs a fresh mastery streak;
 * the mastery+thin moment this exposes is also the cue for the expansion offer.
 *
 * `deliveries` is the per-domain list of tiers actually served from the reserve this
 * run (typically the orchestrator's under-difficulty backfill); the highest tier per
 * domain is taken as what the domain could sustain.
 */
export async function recalibrateDomainDifficultyToSupply(
  userId: string,
  deliveries: Array<{ domain: string; deliveredTier: string }>,
): Promise<void> {
  // Collapse to the highest valid tier delivered per domain.
  const deliveredByDomain = new Map<string, ServedDifficulty>();
  for (const { domain, deliveredTier } of deliveries) {
    if (!domain) continue;
    const tier = deliveredTier as ServedDifficulty;
    if (DIFFICULTY_LADDER.indexOf(tier) === -1) continue;
    const prev = deliveredByDomain.get(domain);
    if (!prev || DIFFICULTY_LADDER.indexOf(tier) > DIFFICULTY_LADDER.indexOf(prev)) {
      deliveredByDomain.set(domain, tier);
    }
  }

  const domains = [...deliveredByDomain.keys()];
  if (domains.length === 0) return;

  const now = new Date();
  const [rows, declaredDomains] = await Promise.all([
    db
      .select()
      .from(userDomainDifficulties)
      .where(and(
        eq(userDomainDifficulties.userId, userId),
        inArray(userDomainDifficulties.canonicalSubcategory, domains),
      )),
    getDeclaredDomainSet(userId, domains),
  ]);
  const existingByDomain = new Map(rows.map((row) => [row.canonicalSubcategory, row]));

  for (const domain of domains) {
    const delivered = deliveredByDomain.get(domain)!;
    const floor: ServedDifficulty = declaredDomains.has(domain)
      ? focusDomainMinDifficulty()
      : 'accessible';
    const floorIdx = DIFFICULTY_LADDER.indexOf(floor);
    const target = DIFFICULTY_LADDER[Math.max(floorIdx, DIFFICULTY_LADDER.indexOf(delivered))];

    const existing = existingByDomain.get(domain);

    if (!existing) {
      // No persisted row yet — difficulty was seeded in-memory for this run
      // (getDomainDifficultyOverrides only persists on the first answer). Persist
      // the supply ceiling so the next run reads it instead of re-seeding high.
      await db
        .insert(userDomainDifficulties)
        .values({
          userId,
          canonicalSubcategory: domain,
          servedDifficulty: target,
          consecutiveCorrect: 0,
          consecutiveIncorrect: 0,
          lastUpdated: now,
        })
        .onConflictDoNothing({
          target: [userDomainDifficulties.userId, userDomainDifficulties.canonicalSubcategory],
        });
      continue;
    }

    if (isFrozen(existing.freezeUntil, now)) continue;

    const corrected = computeSupplyCorrection(existing.servedDifficulty as ServedDifficulty, delivered, floor);
    if (!corrected) continue;

    // Topping the ladder (specialist) yet still out-running supply is the
    // "you're crushing this domain but it's tapped out" moment — flag it for the
    // post-daily-Five expansion offer. Only stamp the first time (preserve the
    // original eligibility; once offered, expansionOfferedAt suppresses re-show).
    const reachedCeiling = (existing.servedDifficulty as ServedDifficulty) === 'specialist';
    const markEligible = reachedCeiling && !existing.expansionEligibleSince;

    await db
      .update(userDomainDifficulties)
      .set({
        servedDifficulty: corrected,
        consecutiveCorrect: 0,
        consecutiveIncorrect: 0,
        lastUpdated: now,
        ...(markEligible ? { expansionEligibleSince: now } : {}),
      })
      .where(eq(userDomainDifficulties.id, existing.id));

    if (markEligible) {
      // Audit the expansion-offer funnel (eligible → shown → resolved). This is
      // the canonical "how often is the offer triggered" count — one line per
      // domain the first time a player tops its ladder yet out-runs its content.
      console.info('[expansion-offer] eligible', {
        phase: 'eligible',
        userId,
        domain,
        fromTier: existing.servedDifficulty,
        deliveredTier: delivered,
      });
    }
  }
}

export type PendingExpansionDomain = {
  canonicalSubcategory: string;
  eligibleSince: Date;
};

/**
 * Domains for which a post-daily-Five expansion offer is pending — the player
 * topped a domain's difficulty ladder yet still out-ran its supply
 * (recalibrateDomainDifficultyToSupply set expansionEligibleSince), and the offer
 * has not yet been accepted or dismissed (expansionOfferedAt is still NULL). Most
 * recently eligible first, so the summary can lead with the freshest crush.
 */
export async function getPendingExpansionDomains(
  userId: string,
): Promise<PendingExpansionDomain[]> {
  const rows = await db
    .select({
      canonicalSubcategory: userDomainDifficulties.canonicalSubcategory,
      eligibleSince: userDomainDifficulties.expansionEligibleSince,
    })
    .from(userDomainDifficulties)
    .where(and(
      eq(userDomainDifficulties.userId, userId),
      isNotNull(userDomainDifficulties.expansionEligibleSince),
      isNull(userDomainDifficulties.expansionOfferedAt),
    ))
    .orderBy(desc(userDomainDifficulties.expansionEligibleSince));

  return rows
    .filter((row): row is { canonicalSubcategory: string; eligibleSince: Date } => row.eligibleSince != null)
    .map((row) => ({ canonicalSubcategory: row.canonicalSubcategory, eligibleSince: row.eligibleSince }));
}

/**
 * Resolve a pending expansion offer for a domain — stamped when the player accepts
 * (adds ≥1 adjacent domain) or dismisses it, so the offer surfaces only once.
 *
 * Upserts rather than updates: a thin area touched but never *answered* this game
 * (B-AREA-EXPANSION-01 thinness trigger) may have no userDomainDifficulties row
 * yet, and a plain UPDATE would silently no-op and let the offer re-show. The
 * inserted seed row is minimal (min-level served difficulty); a real answer later
 * recalibrates it normally.
 */
export async function markDomainExpansionOffered(
  userId: string,
  canonicalSubcategory: string,
): Promise<void> {
  if (!canonicalSubcategory) return;
  const now = new Date();
  await db
    .insert(userDomainDifficulties)
    .values({
      userId,
      canonicalSubcategory,
      servedDifficulty: seedDifficultyFromAdaptiveLevel(MIN_ADAPTIVE_LEVEL),
      consecutiveCorrect: 0,
      consecutiveIncorrect: 0,
      lastUpdated: now,
      expansionOfferedAt: now,
    })
    .onConflictDoUpdate({
      target: [userDomainDifficulties.userId, userDomainDifficulties.canonicalSubcategory],
      set: { expansionOfferedAt: now },
    });
}

/**
 * Of the given domains, which already have an expansion offer stamped
 * (expansionOfferedAt set) — i.e. were already offered once. Used by the thinness
 * trigger to honor the once-per-area rule (B-AREA-EXPANSION-01).
 */
export async function getExpansionOfferedDomains(
  userId: string,
  domains: readonly string[],
): Promise<Set<string>> {
  if (domains.length === 0) return new Set();
  const rows = await db
    .select({ domain: userDomainDifficulties.canonicalSubcategory })
    .from(userDomainDifficulties)
    .where(and(
      eq(userDomainDifficulties.userId, userId),
      inArray(userDomainDifficulties.canonicalSubcategory, [...domains]),
      isNotNull(userDomainDifficulties.expansionOfferedAt),
    ));
  return new Set(rows.map((row) => row.domain));
}

/**
 * Pin a domain's served difficulty until `until` (Refine Your Game "Ease off").
 * While frozen, updateDomainDifficultyOnAnswer() leaves the level and streaks
 * untouched. Escalation normally means a row already exists; the insert branch
 * is a guard that seeds a served level the same way a first answer would.
 */
export async function freezeDomainDifficulty(
  userId: string,
  canonicalSubcategory: string,
  until: Date,
): Promise<void> {
  if (!canonicalSubcategory) return;

  const [existing] = await db
    .select({ id: userDomainDifficulties.id })
    .from(userDomainDifficulties)
    .where(and(
      eq(userDomainDifficulties.userId, userId),
      eq(userDomainDifficulties.canonicalSubcategory, canonicalSubcategory),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(userDomainDifficulties)
      .set({ freezeUntil: until })
      .where(eq(userDomainDifficulties.id, existing.id));
    return;
  }

  const [level, focusDomains] = await Promise.all([
    readCurrentAdaptiveLevel(userId),
    getFocusDomainSet(userId, [canonicalSubcategory]),
  ]);
  const seed = applyFocusFloor(
    seedDifficultyFromAdaptiveLevel(level),
    focusDomains.has(canonicalSubcategory),
  );
  await db
    .insert(userDomainDifficulties)
    .values({
      userId,
      canonicalSubcategory,
      servedDifficulty: seed,
      consecutiveCorrect: 0,
      consecutiveIncorrect: 0,
      lastUpdated: new Date(),
      freezeUntil: until,
    })
    .onConflictDoUpdate({
      target: [userDomainDifficulties.userId, userDomainDifficulties.canonicalSubcategory],
      set: { freezeUntil: until },
    });
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
  // user's adaptive level and which of those domains are opted-in focus areas
  // so we can floor the seed to "Familiar" for the latter (declared OR
  // demonstrated — the erosion-floor split is applied later, on answer).
  const domainsNeedingSeed = domains.filter((domain) => !known.has(domain));
  const [seedLevel, focusDomains] = domainsNeedingSeed.length === 0
    ? [MIN_ADAPTIVE_LEVEL, new Set<string>()]
    : await Promise.all([
        readCurrentAdaptiveLevel(userId),
        getFocusDomainSet(userId, domainsNeedingSeed),
      ]);

  for (const domain of domains) {
    const served = known.get(domain)
      ?? applyFocusFloor(seedDifficultyFromAdaptiveLevel(seedLevel), focusDomains.has(domain));
    overrides.set(domain, SERVED_TO_PREFERENCE[served]);
  }

  return overrides;
}
