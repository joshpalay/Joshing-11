import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  db,
  dailyQueues,
  generatedQuestions,
  joshingGameResponses,
  masteryEvents,
  playerMastery,
  profileDomainVisibility,
  questions,
} from '@/server/db';
import type { QueueSlot } from '@/server/daily/types';
import {
  getActiveDeclaredInterests,
  getActiveDeclaredInterestsBulk,
} from '@/server/db/queries/declared-interests';
import { getDailyPreferences, updateDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { TIER_THRESHOLD_POINTS } from '@/server/mastery/tiers';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
import { domainKey } from '@/lib/knowledge/domain-key';
import { titleCaseDomain } from '@/lib/knowledge/domain-casing';
import { pgErrorCode } from '@/server/db/pg-error';
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
  broadCategory: string | null;
  iconKey: string;
  isDeclared: boolean;
  isDeclaredInterest: boolean;
  isDemonstrated: boolean;
  territoryType: 'declared' | 'demonstrated';
  isHidden: boolean;
};

export type ExpandingDomain = {
  domain: string;
  momentumScore: number;
  reason:
    | 'new-discovery'
    | 'mastery-shift'
    | 'social-overlap'
    | 'saved-questions'
    | 'active-play';
  supportingText?: string;
};

export type KnowledgePageData = {
  allDomains: DomainMastery[];
  declaredInterests: string[];
  expandingDomains: ExpandingDomain[];
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

export type DomainVisibility = 'public' | 'friends' | 'private';

export type MasteryEvent = {
  id: string;
  points: number;
  source: string;
  questionText: string | null;
  createdAt: string;
};

export type QuestionAnswer = {
  id: string;
  questionId: string | null;
  questionText: string;
  correctAnswer: string | null;
  submittedAnswer: string | null;
  isCorrect: boolean;
  answeredAt: string;
  source: 'daily' | 'joshing_game';
  isInBank?: boolean;
};

export type DomainDetail = {
  domain: string;
  displayName: string;
  isDeclaredInterest: boolean;
  points: number;
  tier: string;
  tierProgress: number;
  nextTier: string | null;
  pointsToNextTier: number | null;
  questionsAnswered: number;
  questionsCorrect: number;
  correctRate: number;
  firstAnsweredAt: string | null;
  lastAnsweredAt: string | null;
  visibility: DomainVisibility;
  recentEvents: MasteryEvent[];
  questionHistory: QuestionAnswer[];
};

type AnswerStats = {
  answered: number;
  correct: number;
  lastActivityAt: Date | null;
  firstActivityAt?: Date | null;
};

type PlayerMasteryRow = typeof playerMastery.$inferSelect;

async function getPlayerMasteryRows(userId: string, orderByPoints = false): Promise<PlayerMasteryRow[]> {
  try {
    if (orderByPoints) {
      return await db
        .select()
        .from(playerMastery)
        .where(eq(playerMastery.userId, userId))
        .orderBy(desc(playerMastery.totalPoints));
    }

    return await db
      .select()
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId));
  } catch (error) {
    if (pgErrorCode(error) !== '42703') throw error;

    const selectWithoutTerritoryType = {
      id: playerMastery.id,
      userId: playerMastery.userId,
      canonicalSubcategory: playerMastery.canonicalSubcategory,
      broadCategory: playerMastery.broadCategory,
      totalPoints: playerMastery.totalPoints,
      tier: playerMastery.tier,
      tierReachedAt: playerMastery.tierReachedAt,
      lifetimePointsBaseline: playerMastery.lifetimePointsBaseline,
      updatedAt: playerMastery.updatedAt,
    };

    const rows = orderByPoints
      ? await db
        .select(selectWithoutTerritoryType)
        .from(playerMastery)
        .where(eq(playerMastery.userId, userId))
        .orderBy(desc(playerMastery.totalPoints))
      : await db
        .select(selectWithoutTerritoryType)
        .from(playerMastery)
        .where(eq(playerMastery.userId, userId));

    return rows.map((row) => ({ ...row, territoryType: 'demonstrated' as const }));
  }
}

// Batch variant of getPlayerMasteryRows for a SET of users in one `inArray`
// query, grouped by userId. Rows are globally ordered totalPoints-descending,
// so each user's slice stays points-descending — the order buildMasteryByDomain
// relies on. Carries the same 42703 (missing territory_type column) fallback as
// the single-user path. Users with no mastery rows are absent (callers default []).
async function getPlayerMasteryRowsBulk(
  userIds: readonly string[],
): Promise<Map<string, PlayerMasteryRow[]>> {
  const result = new Map<string, PlayerMasteryRow[]>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return result;

  let rows: PlayerMasteryRow[];
  try {
    rows = await db
      .select()
      .from(playerMastery)
      .where(inArray(playerMastery.userId, ids))
      .orderBy(desc(playerMastery.totalPoints));
  } catch (error) {
    if (pgErrorCode(error) !== '42703') throw error;

    const selectWithoutTerritoryType = {
      id: playerMastery.id,
      userId: playerMastery.userId,
      canonicalSubcategory: playerMastery.canonicalSubcategory,
      broadCategory: playerMastery.broadCategory,
      totalPoints: playerMastery.totalPoints,
      tier: playerMastery.tier,
      tierReachedAt: playerMastery.tierReachedAt,
      lifetimePointsBaseline: playerMastery.lifetimePointsBaseline,
      updatedAt: playerMastery.updatedAt,
    };
    const raw = await db
      .select(selectWithoutTerritoryType)
      .from(playerMastery)
      .where(inArray(playerMastery.userId, ids))
      .orderBy(desc(playerMastery.totalPoints));
    rows = raw.map((row) => ({ ...row, territoryType: 'demonstrated' as const }));
  }

  for (const row of rows) {
    const list = result.get(row.userId);
    if (list) list.push(row);
    else result.set(row.userId, [row]);
  }
  return result;
}

const TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

function displayNameForDomain(domain: string): string {
  // Standardize capitalization at render time so legacy rows stored with messy
  // casing ("russian literature", "90's HIP HOP") display consistently, the same
  // way newly-written labels are normalized in normalizeDeclaredInterest.
  return titleCaseDomain(domain);
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nextTierFor(tier: MasteryTier): MasteryTier | null {
  const index = TIER_ORDER.indexOf(tier);
  if (index < 0 || index === TIER_ORDER.length - 1) return null;
  return TIER_ORDER[index + 1];
}

type SourceLabelRow = Pick<typeof masteryEvents.$inferSelect, 'sourceType' | 'sessionContext'>;

function sourceLabel(row: SourceLabelRow): string {
  if (row.sessionContext === 'daily' || row.sessionContext === 'joshing_game') {
    return row.sessionContext;
  }
  if (row.sourceType === 'author_credit') return 'author_credit';
  return row.sourceType === 'live_correct' ? 'daily' : row.sourceType;
}



// Per-domain aggregate row: one GROUP BY canonical_subcategory query over a
// user's MASTERY_EVENTS computes every stat the knowledge surfaces need, so row
// transfer stops scaling with lifetime event count. Grouping is by the raw
// canonical_subcategory spelling (SQL can't replicate domainKey() folding); rows
// that share a domainKey are merged in JS (mergeDomainStats /
// deriveExpandingDomains), of which there are far fewer than raw events.
export type DomainAggregateRow = {
  canonicalSubcategory: string;
  answered: number;
  correct: number;
  lastAnsweredAt: Date | string | null;
  demonstrated: boolean;
  firstAt: Date | string | null;
  latestAt: Date | string | null;
  recentAnswered: number;
  recentPoints: number;
  wrongAnswers: number;
  socialEvents: number;
  savedEvents: number;
};

// Recency window (days) for the "Recently Expanding" momentum heuristic.
const EXPANSION_WINDOW_DAYS = 21;

function expansionWindowStart(now: number = Date.now()): Date {
  return new Date(now - EXPANSION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function supportingTextFor(reason: ExpandingDomain['reason']): string {
  switch (reason) {
    case 'new-discovery':
      return 'New territory opened this week.';
    case 'mastery-shift':
      return 'This territory moved recently.';
    case 'social-overlap':
      return 'Shared overlap grew here.';
    case 'saved-questions':
      return 'You saved questions here.';
    case 'active-play':
    default:
      return 'You’ve been spending more time here lately.';
  }
}

// Merge per-domain aggregate rows (grouped by raw canonical_subcategory in SQL)
// into the momentum heuristic, folding rows that share a domainKey. The windowed
// counts (recent*/wrong/social/saved within EXPANSION_WINDOW_DAYS) are computed in
// SQL; recency/novelty derive from the first/last activity timestamps here.
export function deriveExpandingDomains(rows: DomainAggregateRow[]): ExpandingDomain[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const byDomain = new Map<string, {
    domain: string;
    firstAt: Date | null;
    latestAt: Date | null;
    recentAnswered: number;
    recentPoints: number;
    wrongAnswers: number;
    socialEvents: number;
    savedEvents: number;
  }>();

  for (const row of rows) {
    const domain = row.canonicalSubcategory.trim().replace(/\s+/g, ' ');
    if (!domain) continue;
    const key = domainKey(domain);
    const firstAt = toDate(row.firstAt);
    const latestAt = toDate(row.latestAt);
    const existing = byDomain.get(key) ?? {
      domain,
      firstAt,
      latestAt,
      recentAnswered: 0,
      recentPoints: 0,
      wrongAnswers: 0,
      socialEvents: 0,
      savedEvents: 0,
    };

    if (firstAt && (!existing.firstAt || firstAt < existing.firstAt)) existing.firstAt = firstAt;
    if (latestAt && (!existing.latestAt || latestAt > existing.latestAt)) existing.latestAt = latestAt;
    existing.recentAnswered += Number(row.recentAnswered ?? 0);
    existing.recentPoints += Number(row.recentPoints ?? 0);
    existing.wrongAnswers += Number(row.wrongAnswers ?? 0);
    existing.socialEvents += Number(row.socialEvents ?? 0);
    existing.savedEvents += Number(row.savedEvents ?? 0);
    byDomain.set(key, existing);
  }

  return [...byDomain.values()]
    .map((domain) => {
      const latestAgeDays = domain.latestAt ? Math.max(0, (now - domain.latestAt.getTime()) / dayMs) : Infinity;
      const firstAgeDays = domain.firstAt ? Math.max(0, (now - domain.firstAt.getTime()) / dayMs) : Infinity;
      const recency = Math.max(0, (30 - latestAgeDays) / 30);
      const novelty = firstAgeDays <= 14 ? 1 : 0;
      const reason: ExpandingDomain['reason'] = novelty
        ? 'new-discovery'
        : domain.socialEvents > 0
          ? 'social-overlap'
          : domain.savedEvents > 0
            ? 'saved-questions'
            : domain.recentPoints > 0
              ? 'mastery-shift'
              : 'active-play';
      const momentumScore = Math.round(
        (recency * 60)
        + (novelty * 35)
        + (Math.min(domain.recentAnswered, 6) * 10)
        + (Math.min(domain.wrongAnswers, 4) * 8)
        + (Math.min(domain.recentPoints, 120) * 0.18)
        + (Math.min(domain.socialEvents, 3) * 14)
        + (Math.min(domain.savedEvents, 3) * 10),
      );

      return {
        domain: displayNameForDomain(domain.domain),
        momentumScore,
        reason,
        supportingText: supportingTextFor(reason),
      };
    })
    .filter((domain) => domain.momentumScore > 0)
    .sort((a, b) => b.momentumScore - a.momentumScore || a.domain.localeCompare(b.domain))
    .slice(0, 5);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isQueueSlotArray(value: unknown): value is QueueSlot[] {
  return Array.isArray(value);
}

function isDomainVisibility(value: string | null | undefined): value is DomainVisibility {
  return value === 'public' || value === 'friends' || value === 'private';
}

function toDomainMasteryRow(
  knowledgeDomain: {
    domain: string;
    broadCategory: string | null;
    isDeclared: boolean;
    isDemonstrated: boolean;
    territoryType?: 'declared' | 'demonstrated';
  },
  masteryByDomain: Map<string, typeof playerMastery.$inferSelect>,
  statsByDomain: Map<string, AnswerStats>,
  hiddenDomainKeys: Set<string>,
): DomainMastery {
  const domain = knowledgeDomain.domain;
  const row = masteryByDomain.get(domainKey(domain));
  const points = Number(row?.totalPoints ?? 0);
  const tierDisplay = getMasteryTierDisplay(points);
  const stats = statsByDomain.get(domainKey(domain));
  const questionsAnswered = stats?.answered ?? 0;
  const questionsCorrect = stats?.correct ?? 0;
  const territoryType: 'declared' | 'demonstrated' =
    knowledgeDomain.territoryType ?? (knowledgeDomain.isDemonstrated ? 'demonstrated' : 'declared');

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
    broadCategory: normalizeBroadCategory(knowledgeDomain.broadCategory ?? row?.broadCategory),
    iconKey: toCanonicalDomainSlug(domain),
    isDeclared: knowledgeDomain.isDeclared,
    isDeclaredInterest: knowledgeDomain.isDeclared,
    isDemonstrated: knowledgeDomain.isDemonstrated,
    territoryType,
    isHidden: hiddenDomainKeys.has(domainKey(domain)),
  };
}

// Collapse player-mastery rows whose canonical subcategories differ only by
// typographic spelling (e.g. a curly-apostrophe declared-interest seed row and
// the straight-apostrophe row earned by answering questions) into one entry per
// domain key, summing their points. Building the lookup with `new Map(...)`
// instead would keep only the last colliding row and silently drop the other
// row's points. Rows arrive points-descending, so the first row seen wins for
// non-additive fields (broadCategory, tier) while points accumulate.
function buildMasteryByDomain(
  masteryRows: Array<typeof playerMastery.$inferSelect>,
): Map<string, typeof playerMastery.$inferSelect> {
  const byKey = new Map<string, typeof playerMastery.$inferSelect>();
  for (const row of masteryRows) {
    const key = domainKey(row.canonicalSubcategory);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
    } else {
      byKey.set(key, {
        ...existing,
        totalPoints: Number(existing.totalPoints ?? 0) + Number(row.totalPoints ?? 0),
      });
    }
  }
  return byKey;
}

// Single GROUP BY canonical_subcategory pass that computes every per-domain stat
// the knowledge surfaces need — answered/correct counts, last-answered timestamp,
// the friend-mediated "demonstrated" flag, and the windowed momentum inputs — so
// only one row per domain crosses the wire instead of every lifetime event. The
// 'feed'/'joshing_game' session contexts and the 'authored'/'author_credit' source
// types are the friend-mediated and saved-question signals respectively. Filtered
// by user_id (MASTERY_EVENTS_user_id_idx); the aggregation is the row-transfer win.
async function loadDomainAggregates(userId: string, since: Date): Promise<DomainAggregateRow[]> {
  return db
    .select({
      canonicalSubcategory: masteryEvents.canonicalSubcategory,
      answered: sql<number>`count(*) filter (where ${masteryEvents.answerState} is not null)`,
      correct: sql<number>`count(*) filter (where ${masteryEvents.answerState} is not null and ${masteryEvents.answerState} <> 'incorrect')`,
      lastAnsweredAt: sql<Date | null>`max(${masteryEvents.createdAt}) filter (where ${masteryEvents.answerState} is not null)`,
      demonstrated: sql<boolean>`coalesce(bool_or(${masteryEvents.answerState} is not null and ${masteryEvents.answerState} <> 'incorrect' and ${masteryEvents.questionId} is not null and ${masteryEvents.sessionContext} in ('feed', 'joshing_game')), false)`,
      firstAt: sql<Date | null>`min(${masteryEvents.createdAt})`,
      latestAt: sql<Date | null>`max(${masteryEvents.createdAt})`,
      recentAnswered: sql<number>`count(*) filter (where ${masteryEvents.answerState} is not null and ${masteryEvents.createdAt} >= ${since})`,
      recentPoints: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}) filter (where ${masteryEvents.createdAt} >= ${since}), 0)`,
      wrongAnswers: sql<number>`count(*) filter (where ${masteryEvents.answerState} = 'incorrect' and ${masteryEvents.createdAt} >= ${since})`,
      socialEvents: sql<number>`count(*) filter (where ${masteryEvents.sessionContext} in ('feed', 'joshing_game') and ${masteryEvents.createdAt} >= ${since})`,
      savedEvents: sql<number>`count(*) filter (where ${masteryEvents.sourceType} in ('authored', 'author_credit') and ${masteryEvents.createdAt} >= ${since})`,
    })
    .from(masteryEvents)
    .where(eq(masteryEvents.userId, userId))
    .groupBy(masteryEvents.canonicalSubcategory);
}

// Batch variant of loadDomainAggregates for a SET of users — identical per-domain
// aggregation, but GROUP BY (user_id, canonical_subcategory) so one round-trip
// covers every user. Rows are split back out by userId into the same
// DomainAggregateRow shape the single-user path produces. Users with no events
// are absent from the map (callers default to []).
async function loadDomainAggregatesBulk(
  userIds: readonly string[],
  since: Date,
): Promise<Map<string, DomainAggregateRow[]>> {
  const result = new Map<string, DomainAggregateRow[]>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const rows = await db
    .select({
      userId: masteryEvents.userId,
      canonicalSubcategory: masteryEvents.canonicalSubcategory,
      answered: sql<number>`count(*) filter (where ${masteryEvents.answerState} is not null)`,
      correct: sql<number>`count(*) filter (where ${masteryEvents.answerState} is not null and ${masteryEvents.answerState} <> 'incorrect')`,
      lastAnsweredAt: sql<Date | null>`max(${masteryEvents.createdAt}) filter (where ${masteryEvents.answerState} is not null)`,
      demonstrated: sql<boolean>`coalesce(bool_or(${masteryEvents.answerState} is not null and ${masteryEvents.answerState} <> 'incorrect' and ${masteryEvents.questionId} is not null and ${masteryEvents.sessionContext} in ('feed', 'joshing_game')), false)`,
      firstAt: sql<Date | null>`min(${masteryEvents.createdAt})`,
      latestAt: sql<Date | null>`max(${masteryEvents.createdAt})`,
      recentAnswered: sql<number>`count(*) filter (where ${masteryEvents.answerState} is not null and ${masteryEvents.createdAt} >= ${since})`,
      recentPoints: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}) filter (where ${masteryEvents.createdAt} >= ${since}), 0)`,
      wrongAnswers: sql<number>`count(*) filter (where ${masteryEvents.answerState} = 'incorrect' and ${masteryEvents.createdAt} >= ${since})`,
      socialEvents: sql<number>`count(*) filter (where ${masteryEvents.sessionContext} in ('feed', 'joshing_game') and ${masteryEvents.createdAt} >= ${since})`,
      savedEvents: sql<number>`count(*) filter (where ${masteryEvents.sourceType} in ('authored', 'author_credit') and ${masteryEvents.createdAt} >= ${since})`,
    })
    .from(masteryEvents)
    .where(inArray(masteryEvents.userId, ids))
    .groupBy(masteryEvents.userId, masteryEvents.canonicalSubcategory);

  for (const row of rows) {
    const { userId, ...rest } = row;
    const list = result.get(userId);
    if (list) list.push(rest);
    else result.set(userId, [rest]);
  }
  return result;
}

export type MergedDomainStats = {
  statsByDomain: Map<string, AnswerStats>;
  demonstratedDomains: Set<string>;
  demonstratedLabels: Map<string, string>;
};

// Fold the SQL aggregate rows (keyed by raw canonical_subcategory) into the
// domainKey()-normalized stats the page consumes. statsByDomain only carries
// domains with at least one answered event (mirrors the old `if (!answerState)
// continue` guard); a domain is demonstrated if any of its rows set the flag.
export function mergeDomainStats(rows: DomainAggregateRow[]): MergedDomainStats {
  const statsByDomain = new Map<string, AnswerStats>();
  const demonstratedDomains = new Set<string>();
  const demonstratedLabels = new Map<string, string>();

  for (const row of rows) {
    const key = domainKey(row.canonicalSubcategory);
    const answered = Number(row.answered ?? 0);
    if (answered > 0) {
      const existing = statsByDomain.get(key) ?? { answered: 0, correct: 0, lastActivityAt: null };
      existing.answered += answered;
      existing.correct += Number(row.correct ?? 0);
      const last = toDate(row.lastAnsweredAt);
      if (last && (!existing.lastActivityAt || last > existing.lastActivityAt)) {
        existing.lastActivityAt = last;
      }
      statsByDomain.set(key, existing);
    }
    if (row.demonstrated) {
      demonstratedDomains.add(key);
      if (!demonstratedLabels.has(key)) demonstratedLabels.set(key, row.canonicalSubcategory);
    }
  }

  return { statsByDomain, demonstratedDomains, demonstratedLabels };
}

// Shared per-request fetch for the knowledge route, which renders both the
// mastery overview and the knowledge page data. Both derivations read the same
// declared interests, player-mastery rows, per-domain mastery aggregates, and
// hidden-domain keys, so we fetch them once and hand the same inputs to both
// builders instead of each re-fetching independently (which doubled the query
// count against the max-5 pool). The mastery events themselves are no longer
// pulled in full — aggregated per-domain in SQL — except the 10 most recent rows
// the overview needs for its recent-activity feed.
export async function loadKnowledgeInputs(userId: string) {
  const since = expansionWindowStart();
  const [declaredRows, masteryRows, domainAggregates, recentEvents, hiddenDomainKeys] = await Promise.all([
    getActiveDeclaredInterests(userId),
    getPlayerMasteryRows(userId, true),
    loadDomainAggregates(userId, since),
    db
      .select({
        canonicalSubcategory: masteryEvents.canonicalSubcategory,
        sourceType: masteryEvents.sourceType,
        awardedPoints: masteryEvents.awardedPoints,
        sessionContext: masteryEvents.sessionContext,
        createdAt: masteryEvents.createdAt,
      })
      .from(masteryEvents)
      .where(eq(masteryEvents.userId, userId))
      .orderBy(desc(masteryEvents.createdAt))
      .limit(10),
    getHiddenDomainKeys(userId),
  ]);
  return { declaredRows, masteryRows, domainAggregates, recentEvents, hiddenDomainKeys };
}

export type KnowledgeInputs = Awaited<ReturnType<typeof loadKnowledgeInputs>>;

export async function getUserMasteryOverview(
  userId: string,
  inputs?: KnowledgeInputs,
): Promise<MasteryOverview> {
  const { declaredRows, masteryRows, domainAggregates, recentEvents, hiddenDomainKeys } =
    inputs ?? (await loadKnowledgeInputs(userId));
  const recentRows = recentEvents;

  const totalPoints = masteryRows.reduce((sum, row) => sum + Number(row.totalPoints ?? 0), 0);
  const overall = getMasteryTierDisplay(totalPoints);
  const nextOverallTier = nextTierFor(overall.tier);
  const nextThreshold = nextOverallTier ? TIER_THRESHOLD_POINTS[nextOverallTier] : null;
  const { statsByDomain, demonstratedDomains, demonstratedLabels: demonstratedDomainLabels } =
    mergeDomainStats(domainAggregates);

  const masteryByDomain = buildMasteryByDomain(masteryRows);
  const knowledgeDomainNames = new Map<string, {
    domain: string;
    broadCategory: string | null;
    isDeclared: boolean;
    isDemonstrated: boolean;
    territoryType?: 'declared' | 'demonstrated';
  }>();

  for (const row of declaredRows) {
    const domain = row.domain.trim().replace(/\s+/g, ' ');
    if (!domain) continue;
    const key = domainKey(domain);
    knowledgeDomainNames.set(key, {
      domain,
      broadCategory: row.broadCategory,
      isDeclared: true,
      isDemonstrated: demonstratedDomains.has(key),
    });
  }

  for (const key of demonstratedDomains) {
    const existing = knowledgeDomainNames.get(key);
    const mastery = masteryByDomain.get(key);
    knowledgeDomainNames.set(key, {
      domain: existing?.domain ?? demonstratedDomainLabels.get(key) ?? mastery?.canonicalSubcategory ?? key,
      broadCategory: existing?.broadCategory ?? mastery?.broadCategory ?? null,
      isDeclared: existing?.isDeclared ?? false,
      isDemonstrated: true,
    });
  }

  const domains = [...knowledgeDomainNames.values()]
    .map((knowledgeDomain) => toDomainMasteryRow(knowledgeDomain, masteryByDomain, statsByDomain, hiddenDomainKeys))
    .sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));

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

export async function getKnowledgePageData(
  userId: string,
  inputs?: KnowledgeInputs,
): Promise<KnowledgePageData> {
  const { declaredRows, masteryRows, domainAggregates, hiddenDomainKeys } =
    inputs ?? (await loadKnowledgeInputs(userId));

  const { statsByDomain } = mergeDomainStats(domainAggregates);

  const masteryByDomain = buildMasteryByDomain(masteryRows);
  const knowledgeDomainNames = new Map<string, {
    domain: string;
    broadCategory: string | null;
    isDeclared: boolean;
    isDemonstrated: boolean;
    territoryType?: 'declared' | 'demonstrated';
  }>();

  for (const row of masteryRows) {
    const domain = row.canonicalSubcategory.trim().replace(/\s+/g, ' ');
    if (!domain) continue;
    knowledgeDomainNames.set(domainKey(domain), {
      domain,
      broadCategory: row.broadCategory,
      isDeclared: false,
      isDemonstrated: statsByDomain.has(domainKey(domain)),
    });
  }

  for (const row of domainAggregates) {
    const domain = row.canonicalSubcategory.trim().replace(/\s+/g, ' ');
    if (!domain) continue;
    const key = domainKey(domain);
    const existing = knowledgeDomainNames.get(key);
    knowledgeDomainNames.set(key, {
      domain: existing?.domain ?? domain,
      broadCategory: existing?.broadCategory ?? null,
      isDeclared: existing?.isDeclared ?? false,
      // A domain present only in events is "demonstrated" when it has any answered
      // event (statsByDomain carries exactly those).
      isDemonstrated: existing?.isDemonstrated ?? statsByDomain.has(key),
    });
  }

  for (const row of declaredRows) {
    const domain = row.domain.trim().replace(/\s+/g, ' ');
    if (!domain) continue;
    const key = domainKey(domain);
    const existing = knowledgeDomainNames.get(key);
    const isDemonstrated = existing?.isDemonstrated ?? false;
    knowledgeDomainNames.set(key, {
      domain: existing?.domain ?? domain,
      broadCategory: existing?.broadCategory ?? row.broadCategory,
      isDeclared: true,
      isDemonstrated,
      territoryType: isDemonstrated ? 'demonstrated' : (row.territoryType ?? 'declared'),
    });
  }

  const allDomains = [...knowledgeDomainNames.values()]
    .map((knowledgeDomain) => toDomainMasteryRow(knowledgeDomain, masteryByDomain, statsByDomain, hiddenDomainKeys))
    .sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));

  return {
    allDomains,
    expandingDomains: deriveExpandingDomains(domainAggregates),
    declaredInterests: declaredRows
      .map((row) => row.domain.trim().replace(/\s+/g, ' '))
      .filter(Boolean),
  };
}

// Batch the `allDomains` slice of getKnowledgePageData across a SET of users.
// Four `inArray` queries (declared interests, player mastery, domain aggregates,
// hidden keys — NOT the recent-events query, which only feeds the overview's
// activity feed, never `allDomains`) replace the per-user fan-out, then each
// user's rows run through the SAME pure getKnowledgePageData derivation (passing
// pre-fetched inputs makes that call do zero DB work), so the resulting domain
// set is identical to calling getKnowledgePageData(userId) one user at a time.
// Query count is constant in the number of users. Returns a Map keyed by userId;
// users with no knowledge data map to an empty array.
export async function getKnowledgePageDataForUsers(
  userIds: readonly string[],
): Promise<Map<string, DomainMastery[]>> {
  const result = new Map<string, DomainMastery[]>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const since = expansionWindowStart();
  const [declaredByUser, masteryByUser, aggregatesByUser, hiddenByUser] = await Promise.all([
    getActiveDeclaredInterestsBulk(ids),
    getPlayerMasteryRowsBulk(ids),
    loadDomainAggregatesBulk(ids, since),
    getHiddenDomainKeysBulk(ids),
  ]);

  for (const userId of ids) {
    const inputs: KnowledgeInputs = {
      declaredRows: declaredByUser.get(userId) ?? [],
      masteryRows: masteryByUser.get(userId) ?? [],
      domainAggregates: aggregatesByUser.get(userId) ?? [],
      // Unused by getKnowledgePageData's allDomains derivation; only the overview
      // reads recentEvents, so the bonus path never fetches it.
      recentEvents: [],
      hiddenDomainKeys: hiddenByUser.get(userId) ?? new Set<string>(),
    };
    const { allDomains } = await getKnowledgePageData(userId, inputs);
    result.set(userId, allDomains);
  }
  return result;
}

// The "Recently Expanding" territories in isolation — the same derivation the
// knowledge page uses, but without the mastery / declared / hidden joins, so the
// home-feed promo (getRecentlyExpandingPromo) can read it cheaply.
export async function getExpandingDomains(userId: string): Promise<ExpandingDomain[]> {
  const aggregates = await loadDomainAggregates(userId, expansionWindowStart());
  return deriveExpandingDomains(aggregates);
}

export async function getDomainDetail(userId: string, domain: string): Promise<DomainDetail | null> {
  const normalizedDomain = domain.trim().replace(/\s+/g, ' ');
  if (!normalizedDomain) return null;
  const normalizedKey = domainKey(normalizedDomain);

  const [declaredRows, masteryRows, eventRows, visibilityRows, responseRows, queueRows] = await Promise.all([
    getActiveDeclaredInterests(userId),
    getPlayerMasteryRows(userId),
    db
      .select({
        event: {
          id: masteryEvents.id,
          awardedPoints: masteryEvents.awardedPoints,
          answerState: masteryEvents.answerState,
          createdAt: masteryEvents.createdAt,
          sessionContext: masteryEvents.sessionContext,
          sourceType: masteryEvents.sourceType,
        },
        questionText: questions.questionText,
      })
      .from(masteryEvents)
      .leftJoin(questions, eq(masteryEvents.questionId, questions.id))
      .where(and(
        eq(masteryEvents.userId, userId),
        sql`lower(${masteryEvents.canonicalSubcategory}) = ${normalizedKey}`,
      ))
      .orderBy(desc(masteryEvents.createdAt)),
    db
      .select()
      .from(profileDomainVisibility)
      .where(and(
        eq(profileDomainVisibility.userId, userId),
        sql`lower(${profileDomainVisibility.domain}) = ${normalizedKey}`,
      ))
      .limit(1),
    db
      .select({
        response: joshingGameResponses,
        question: questions,
      })
      .from(joshingGameResponses)
      .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
      .where(and(
        eq(joshingGameResponses.userId, userId),
        isNotNull(joshingGameResponses.answeredAt),
        sql`lower(coalesce(${questions.canonicalSubcategory}, ${questions.subcategory}, ${questions.broadCategory}, ${questions.category}::text)) = ${normalizedKey}`,
      ))
      .orderBy(desc(joshingGameResponses.answeredAt))
      .limit(50),
    db
      .select({ id: dailyQueues.id, slots: dailyQueues.slots, createdAt: dailyQueues.createdAt })
      .from(dailyQueues)
      .where(eq(dailyQueues.userId, userId))
      .orderBy(desc(dailyQueues.createdAt))
      .limit(100),
  ]);

  const declared = declaredRows.find((row) => domainKey(row.domain) === normalizedKey);
  const mastery = masteryRows.find((row) => domainKey(row.canonicalSubcategory) === normalizedKey);

  if (!declared && !mastery && eventRows.length === 0 && responseRows.length === 0) return null;

  const stats: AnswerStats = { answered: 0, correct: 0, firstActivityAt: null, lastActivityAt: null };
  for (const { event } of eventRows) {
    if (!event.answerState) continue;
    stats.answered += 1;
    if (event.answerState !== 'incorrect') stats.correct += 1;
    if (!stats.firstActivityAt || event.createdAt < stats.firstActivityAt) stats.firstActivityAt = event.createdAt;
    if (!stats.lastActivityAt || event.createdAt > stats.lastActivityAt) stats.lastActivityAt = event.createdAt;
  }

  const generatedQuestionIds = new Set<string>();
  const dailyAnswers: QuestionAnswer[] = [];
  for (const queue of queueRows) {
    if (!isQueueSlotArray(queue.slots)) continue;
    for (const slot of queue.slots) {
      if (!slot.answered || domainKey(slot.domain) !== normalizedKey) continue;
      if (slot.generated_question_id) generatedQuestionIds.add(slot.generated_question_id);
      dailyAnswers.push({
        id: `${queue.id}:${slot.slot_index}`,
        questionId: slot.generated_question_id ?? slot.question_id ?? null,
        questionText: slot.question_text,
        correctAnswer: slot.reveal_canonical_answer ?? null,
        submittedAnswer: slot.submitted_answer ?? null,
        isCorrect: slot.answer_state === 'correct',
        answeredAt: queue.createdAt.toISOString(),
        source: 'daily',
      });
    }
  }

  if (generatedQuestionIds.size > 0) {
    const generatedRows = await db
      .select()
      .from(generatedQuestions)
      .where(inArray(generatedQuestions.id, [...generatedQuestionIds]));
    const generatedById = new Map(generatedRows.map((row) => [row.id, row]));
    for (const answer of dailyAnswers) {
      if (!answer.questionId) continue;
      const generated = generatedById.get(answer.questionId);
      if (!generated) continue;
      answer.questionText = generated.questionText;
      answer.correctAnswer = answer.correctAnswer ?? generated.answer;
    }
  }

  const gameAnswers: QuestionAnswer[] = responseRows.map(({ response, question }) => ({
    id: response.id,
    questionId: response.questionId,
    questionText: question.questionText,
    correctAnswer: question.answerText,
    submittedAnswer: response.submittedAnswer,
    isCorrect: Boolean(response.isCorrect),
    answeredAt: (response.answeredAt ?? response.createdAt).toISOString(),
    source: 'joshing_game',
  }));

  const points = Number(mastery?.totalPoints ?? eventRows.reduce((sum, row) => sum + Number(row.event.awardedPoints ?? 0), 0));
  const tierDisplay = getMasteryTierDisplay(points);
  const nextTier = nextTierFor(tierDisplay.tier);
  const nextThreshold = nextTier ? TIER_THRESHOLD_POINTS[nextTier] : null;
  const visibilityRow = visibilityRows[0];
  const visibility = isDomainVisibility(visibilityRow?.visibility)
    ? visibilityRow.visibility
    : visibilityRow?.isVisible === false
      ? 'private'
      : 'public';

  const questionHistoryIds = [...gameAnswers, ...dailyAnswers]
    .map((answer) => answer.source === 'joshing_game' ? answer.questionId : null)
    .filter((id): id is string => Boolean(id));
  const bankedById = await checkBankedQuestions(userId, questionHistoryIds);

  const questionHistory = [...gameAnswers, ...dailyAnswers]
    .map((answer) => ({
      ...answer,
      isInBank: answer.questionId ? Boolean(bankedById[answer.questionId]) : false,
    }))
    .sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime())
    .slice(0, 50);

  return {
    domain: mastery?.canonicalSubcategory ?? declared?.domain ?? normalizedDomain,
    displayName: displayNameForDomain(mastery?.canonicalSubcategory ?? declared?.domain ?? normalizedDomain),
    isDeclaredInterest: Boolean(declared),
    points,
    tier: tierDisplay.tier,
    tierProgress: percent(tierDisplay.progressWithinTier * 100),
    nextTier,
    pointsToNextTier: nextThreshold === null ? null : Math.max(0, Math.ceil(nextThreshold - points)),
    questionsAnswered: stats.answered,
    questionsCorrect: stats.correct,
    correctRate: stats.answered > 0 ? percent((stats.correct / stats.answered) * 100) : 0,
    firstAnsweredAt: toIso(stats.firstActivityAt),
    lastAnsweredAt: toIso(stats.lastActivityAt),
    visibility,
    recentEvents: eventRows.slice(0, 20).map(({ event, questionText }) => ({
      id: event.id,
      points: Number(event.awardedPoints ?? 0),
      source: sourceLabel(event),
      questionText,
      createdAt: event.createdAt.toISOString(),
    })),
    questionHistory,
  };
}

// ─── Domain convergence (deterministic dedup) ───────────────────────────────
//
// Powers convergeDomain() (src/server/knowledge/converge-domain.ts): align a
// freshly-suggested category onto an existing canonical subcategory that already
// exists ACROSS THE GAME, so the same hyper-specific domain isn't re-created per
// user. The corpus is every player's PLAYER_MASTERY.canonical_subcategory — the
// table the declared-interest write path already seeds — so converging onto it
// directly merges mastery (PLAYER_MASTERY is keyed on canonical_subcategory).

export type CanonicalCorpusMatch = {
  /** The existing canonical-subcategory spelling to persist when chosen. */
  label: string;
  broadCategory: string | null;
  /** How many PLAYER_MASTERY rows share this spelling (ranking + privacy floor). */
  prevalence: number;
  /** 1 for an exact-key match; the pg_trgm score for a fuzzy match. */
  similarity: number;
};

// SQL mirror of domainKey() (src/lib/knowledge/domain-key.ts): fold curly
// apostrophes to ASCII, collapse internal whitespace, trim, lowercase. Kept as a
// single fragment so the JS and SQL key definitions can't drift — the
// converge-domain test asserts parity. The fold-set chars and the regex pattern
// are bound params (not inlined literals) so the apostrophe escaping stays sane.
const CONVERGE_CURLY_APOSTROPHES = '‘’ʼ';
const CONVERGE_ASCII_APOSTROPHES = "'''";
const CONVERGE_WHITESPACE_PATTERN = '\\s+';
function foldedCanonicalSubcategoryExpr() {
  return sql`lower(btrim(regexp_replace(translate(${playerMastery.canonicalSubcategory}, ${CONVERGE_CURLY_APOSTROPHES}, ${CONVERGE_ASCII_APOSTROPHES}), ${CONVERGE_WHITESPACE_PATTERN}, ' ', 'g')))`;
}

const BROAD_CATEGORY_MODE = sql<string | null>`mode() within group (order by ${playerMastery.broadCategory})`;

// Exact-key convergence: the most-prevalent corpus spelling whose domainKey()
// equals the input's. Does NOT depend on pg_trgm, so it always works (the fuzzy
// pass below degrades when the extension is absent). A folded-expression scan is
// fine at the current distinct-canonical-subcategory corpus scale.
export async function findExactCanonicalMatch(rawLabel: string): Promise<CanonicalCorpusMatch | null> {
  const key = domainKey(rawLabel);
  if (!key) return null;
  const rows = await db
    .select({
      label: playerMastery.canonicalSubcategory,
      broadCategory: BROAD_CATEGORY_MODE,
      prevalence: sql<number>`count(*)::int`,
    })
    .from(playerMastery)
    .where(sql`${foldedCanonicalSubcategoryExpr()} = ${key}`)
    .groupBy(playerMastery.canonicalSubcategory)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    label: row.label,
    broadCategory: row.broadCategory ?? null,
    prevalence: Number(row.prevalence),
    similarity: 1,
  };
}

// Fuzzy convergence via pg_trgm similarity(). Throws if pg_trgm is unavailable
// (function does not exist) — convergeDomain() swallows that and degrades to
// exact + "create new". The WHERE similarity() >= threshold filter is a
// deliberate per-row scan: the index-using `%` operator depends on the
// session-global set_limit GUC, which is unreliable under PgBouncer pooling. The
// corpus (distinct canonical subcategories) is small enough that this is fine; a
// later migration can add an index + switch the predicate if scale demands.
export async function findFuzzyCanonicalMatches(
  rawLabel: string,
  threshold: number,
  limit: number,
): Promise<CanonicalCorpusMatch[]> {
  const clean = rawLabel.trim().replace(/\s+/g, ' ');
  if (!clean || limit <= 0) return [];
  const score = sql<number>`max(similarity(${playerMastery.canonicalSubcategory}, ${clean}))`;
  const rows = await db
    .select({
      label: playerMastery.canonicalSubcategory,
      broadCategory: BROAD_CATEGORY_MODE,
      prevalence: sql<number>`count(*)::int`,
      similarity: score,
    })
    .from(playerMastery)
    .where(sql`similarity(${playerMastery.canonicalSubcategory}, ${clean}) >= ${threshold}`)
    .groupBy(playerMastery.canonicalSubcategory)
    .orderBy(sql`max(similarity(${playerMastery.canonicalSubcategory}, ${clean})) desc`, sql`count(*) desc`)
    .limit(limit);
  return rows.map((row) => ({
    label: row.label,
    broadCategory: row.broadCategory ?? null,
    prevalence: Number(row.prevalence),
    similarity: Number(row.similarity),
  }));
}

export type GlobalDomainDepth = { domain: string; depth: number };

// Tier-1 global candidate set (D-NARROW-KB-FABRICATION-01 follow-up): the deepest
// distinct canonical_subcategory labels across the whole question corpus
// (generated + authored), so a semantic reconcile can fold a freshly-authored
// label onto an established domain even when that domain lives only on ANOTHER
// account (e.g. the house "Joshing Library") and not in the author's own KB.
// Merged across both tables by domainKey, depth-gated, and capped so the
// downstream Haiku prompt stays focused on real, well-populated domains.
export async function getDeepGlobalDomains(
  minDepth = 8,
  limit = 60,
): Promise<GlobalDomainDepth[]> {
  const [genRows, authoredRows] = await Promise.all([
    db
      .select({ domain: generatedQuestions.canonicalSubcategory, count: sql<number>`count(*)::int` })
      .from(generatedQuestions)
      .groupBy(generatedQuestions.canonicalSubcategory),
    db
      .select({ domain: questions.canonicalSubcategory, count: sql<number>`count(*)::int` })
      .from(questions)
      .where(isNull(questions.deletedAt))
      .groupBy(questions.canonicalSubcategory),
  ]);

  const byKey = new Map<string, GlobalDomainDepth>();
  for (const row of [...genRows, ...authoredRows]) {
    const domain = row.domain?.trim();
    if (!domain) continue;
    const key = domainKey(domain);
    const existing = byKey.get(key);
    if (existing) existing.depth += Number(row.count);
    else byKey.set(key, { domain, depth: Number(row.count) });
  }

  return [...byKey.values()]
    .filter((d) => d.depth >= minDepth)
    .sort((a, b) => b.depth - a.depth)
    .slice(0, limit);
}

export async function getHiddenDomainKeys(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      domain: profileDomainVisibility.domain,
      canonicalSubcategory: profileDomainVisibility.canonicalSubcategory,
      visibility: profileDomainVisibility.visibility,
      isVisible: profileDomainVisibility.isVisible,
    })
    .from(profileDomainVisibility)
    .where(eq(profileDomainVisibility.userId, userId));

  const hidden = new Set<string>();
  for (const row of rows) {
    const isHidden = row.visibility === 'private' || row.isVisible === false;
    if (!isHidden) continue;
    const label = row.domain ?? row.canonicalSubcategory;
    if (label) hidden.add(domainKey(label));
  }
  return hidden;
}

// Batch variant of getHiddenDomainKeys for a SET of users in one `inArray`
// query, grouped by userId. Same hidden derivation (private OR not visible) as
// the single-user path. Users with no hidden domains are absent from the map
// (callers default to an empty set).
async function getHiddenDomainKeysBulk(
  userIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const rows = await db
    .select({
      userId: profileDomainVisibility.userId,
      domain: profileDomainVisibility.domain,
      canonicalSubcategory: profileDomainVisibility.canonicalSubcategory,
      visibility: profileDomainVisibility.visibility,
      isVisible: profileDomainVisibility.isVisible,
    })
    .from(profileDomainVisibility)
    .where(inArray(profileDomainVisibility.userId, ids));

  for (const row of rows) {
    const isHidden = row.visibility === 'private' || row.isVisible === false;
    if (!isHidden) continue;
    const label = row.domain ?? row.canonicalSubcategory;
    if (!label) continue;
    const set = result.get(row.userId);
    if (set) set.add(domainKey(label));
    else result.set(row.userId, new Set([domainKey(label)]));
  }
  return result;
}

export async function setDomainVisibility(
  userId: string,
  domain: string,
  visibility: DomainVisibility,
): Promise<void> {
  const normalizedDomain = domain.trim().replace(/\s+/g, ' ');
  if (!normalizedDomain) throw new Error('domain is required');
  await db
    .insert(profileDomainVisibility)
    .values({
      userId,
      canonicalSubcategory: normalizedDomain,
      domain: normalizedDomain,
      visibility,
      isVisible: visibility !== 'private',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [profileDomainVisibility.userId, profileDomainVisibility.domain],
      set: {
        canonicalSubcategory: normalizedDomain,
        visibility,
        isVisible: visibility !== 'private',
        updatedAt: new Date(),
      },
    });
}

/**
 * Removes a freshly-opened Knowledge base domain — the "undo" for the
 * default-add that fires when a player answers correctly in unfamiliar
 * territory (B-1). This is a true delete, not a hide: it drops the
 * PLAYER_MASTERY row and the player's MASTERY_EVENTS for that domain
 * (since the domain was just opened, those are this answer's events), and
 * pulls the domain out of any custom Daily-Five selection so the single
 * "remove" fully reverses the open across the KB and the Daily Five.
 *
 * Scoped to the reveal-time undo affordance; not general KB editing. Match
 * is case-insensitive so the client can pass the domain label as shown.
 * Returns whether a PLAYER_MASTERY row was actually removed.
 */
export async function removeKnowledgeDomain(userId: string, domain: string): Promise<{ removed: boolean }> {
  const normalizedDomain = domain.trim().replace(/\s+/g, ' ');
  if (!normalizedDomain) throw new Error('domain is required');
  const domainKey = normalizedDomain.toLowerCase();

  const removed = await db.transaction(async (tx) => {
    const deletedRows = await tx
      .delete(playerMastery)
      .where(and(
        eq(playerMastery.userId, userId),
        sql`lower(${playerMastery.canonicalSubcategory}) = ${domainKey}`,
      ))
      .returning({ id: playerMastery.id });

    await tx
      .delete(masteryEvents)
      .where(and(
        eq(masteryEvents.userId, userId),
        sql`lower(${masteryEvents.canonicalSubcategory}) = ${domainKey}`,
      ));

    return deletedRows.length > 0;
  });

  // Custom-mode cleanup: if the player has hand-picked Daily Five domains,
  // drop the removed one so it stops surfacing. Best-effort and outside the
  // delete transaction — a stale selection is inert (random mode reads the
  // live KB; custom mode just won't find questions for a domain that's gone).
  try {
    const preferences = await getDailyPreferences(userId);
    if (preferences.domainMode === 'custom') {
      const next = preferences.selectedDomains.filter((d) => d.toLowerCase() !== domainKey);
      if (next.length !== preferences.selectedDomains.length) {
        await updateDailyPreferences(userId, { selectedDomains: next });
      }
    }
  } catch (error) {
    console.warn('[removeKnowledgeDomain] failed to prune Daily Five selection', {
      userId,
      domain: normalizedDomain,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { removed };
}

