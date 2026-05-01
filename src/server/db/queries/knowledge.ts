import { and, desc, eq, isNotNull } from 'drizzle-orm';

import {
  db,
  joshingGameResponses,
  masteryEvents,
  playerMastery,
} from '@/server/db';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';
import { TIER_THRESHOLD_POINTS } from '@/server/mastery/tiers';
import type { MasteryTier } from '@/types/db';

export type DomainMastery = {
  domain: string;
  displayName: string;
  points: number;
  tier: string;
  tierProgress: number;
  questionsAnswered: number;
  questionsCorrect: number;
  correctRate: number;
  lastActivityAt: string | null;
};

export type RecentActivity = {
  domain: string;
  displayName: string;
  points: number;
  source: string;
  createdAt: string;
};

export type MasteryOverview = {
  totalPoints: number;
  currentTier: string;
  tierProgress: number;
  nextTier: string | null;
  pointsToNextTier: number | null;
  domains: DomainMastery[];
  recentActivity: RecentActivity[];
};

export type StreakData = {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
};

type AnswerStats = {
  answered: number;
  correct: number;
  lastActivityAt: Date | null;
};

const TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];
const STREAK_TIME_ZONE = 'America/New_York';

function displayNameForDomain(domain: string): string {
  return domain
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nextTierFor(tier: MasteryTier): MasteryTier | null {
  const index = TIER_ORDER.indexOf(tier);
  if (index < 0 || index === TIER_ORDER.length - 1) return null;
  return TIER_ORDER[index + 1];
}

function sourceLabel(row: typeof masteryEvents.$inferSelect): string {
  if (row.sessionContext === 'daily' || row.sessionContext === 'joshing_game') {
    return row.sessionContext;
  }
  if (row.sourceType === 'author_credit') return 'author_credit';
  return row.sourceType === 'live_correct' ? 'daily' : row.sourceType;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function getUserMasteryOverview(userId: string): Promise<MasteryOverview> {
  const [masteryRows, eventRows, recentRows] = await Promise.all([
    db
      .select()
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId))
      .orderBy(desc(playerMastery.totalPoints)),
    db
      .select()
      .from(masteryEvents)
      .where(eq(masteryEvents.userId, userId)),
    db
      .select()
      .from(masteryEvents)
      .where(eq(masteryEvents.userId, userId))
      .orderBy(desc(masteryEvents.createdAt))
      .limit(10),
  ]);

  const totalPoints = masteryRows.reduce((sum, row) => sum + Number(row.totalPoints ?? 0), 0);
  const overall = getMasteryTierDisplay(totalPoints);
  const nextOverallTier = nextTierFor(overall.tier);
  const nextThreshold = nextOverallTier ? TIER_THRESHOLD_POINTS[nextOverallTier] : null;
  const statsByDomain = new Map<string, AnswerStats>();

  for (const event of eventRows) {
    if (!event.answerState) continue;
    const existing = statsByDomain.get(event.canonicalSubcategory) ?? {
      answered: 0,
      correct: 0,
      lastActivityAt: null,
    };
    existing.answered += 1;
    if (event.answerState !== 'incorrect') existing.correct += 1;
    if (!existing.lastActivityAt || event.createdAt > existing.lastActivityAt) {
      existing.lastActivityAt = event.createdAt;
    }
    statsByDomain.set(event.canonicalSubcategory, existing);
  }

  const domains = masteryRows.map((row) => {
    const domain = row.canonicalSubcategory;
    const points = Number(row.totalPoints ?? 0);
    const tierDisplay = getMasteryTierDisplay(points);
    const stats = statsByDomain.get(domain);
    const questionsAnswered = stats?.answered ?? 0;
    const questionsCorrect = stats?.correct ?? 0;

    return {
      domain,
      displayName: displayNameForDomain(domain),
      points,
      tier: tierDisplay.tier,
      tierProgress: percent(tierDisplay.progressWithinTier * 100),
      questionsAnswered,
      questionsCorrect,
      correctRate: questionsAnswered > 0 ? percent((questionsCorrect / questionsAnswered) * 100) : 0,
      lastActivityAt: toIso(stats?.lastActivityAt),
    };
  });

  return {
    totalPoints,
    currentTier: overall.tier,
    tierProgress: percent(overall.progressWithinTier * 100),
    nextTier: nextOverallTier,
    pointsToNextTier: nextThreshold === null ? null : Math.max(0, Math.ceil(nextThreshold - totalPoints)),
    domains,
    recentActivity: recentRows.map((row) => ({
      domain: row.canonicalSubcategory,
      displayName: displayNameForDomain(row.canonicalSubcategory),
      points: Number(row.awardedPoints ?? 0),
      source: sourceLabel(row),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function calendarDay(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: STREAK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, date));
  current.setUTCDate(current.getUTCDate() + amount);
  return current.toISOString().slice(0, 10);
}

export async function getUserAnswerStreak(userId: string): Promise<StreakData> {
  const [dailyRows, gameRows] = await Promise.all([
    db
      .select({ answeredAt: masteryEvents.createdAt })
      .from(masteryEvents)
      .where(and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.sessionContext, 'daily'),
        isNotNull(masteryEvents.answerState),
      )),
    db
      .select({ answeredAt: joshingGameResponses.answeredAt })
      .from(joshingGameResponses)
      .where(and(
        eq(joshingGameResponses.userId, userId),
        isNotNull(joshingGameResponses.answeredAt),
      )),
  ]);

  const days = new Set<string>();
  for (const row of [...dailyRows, ...gameRows]) {
    if (!row.answeredAt) continue;
    days.add(calendarDay(row.answeredAt));
  }

  const sortedDays = [...days].sort();
  if (sortedDays.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastActivityDate: null };
  }

  let currentStreak = 0;
  let cursor = calendarDay(new Date());
  while (days.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  let longestStreak = 1;
  let run = 1;
  for (let index = 1; index < sortedDays.length; index += 1) {
    run = addDays(sortedDays[index - 1], 1) === sortedDays[index] ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  return {
    currentStreak,
    longestStreak,
    lastActivityDate: sortedDays.at(-1) ?? null,
  };
}
