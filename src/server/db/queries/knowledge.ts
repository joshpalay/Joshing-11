import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

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
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { TIER_THRESHOLD_POINTS } from '@/server/mastery/tiers';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';
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

export type ProgressionView = {
  canonicalSubcategory: string;
  canonicalSubcategorySlug: string;
  broadCategory: string | null;
  currentTier: MasteryTier | null;
  correctAnswerCount: number;
  authoredCount: number;
  iconKey: string;
  territoryType: 'declared' | 'demonstrated';
};

export type StreakData = {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
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

const TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];
const STREAK_TIME_ZONE = 'America/New_York';
const FRIEND_MEDIATED_CONTEXTS = ['feed', 'joshing_game'];

function displayNameForDomain(domain: string): string {
  return domain
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function domainKey(domain: string): string {
  return domain.trim().toLowerCase();
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



type ExpansionEvent = {
  canonicalSubcategory: string;
  sourceType?: string | null;
  answerState?: string | null;
  sessionContext?: string | null;
  awardedPoints?: number | string | null;
  createdAt: Date;
};

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

function deriveExpandingDomains(events: ExpansionEvent[]): ExpandingDomain[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const byDomain = new Map<string, {
    domain: string;
    firstAt: Date;
    latestAt: Date;
    answered: number;
    recentAnswered: number;
    recentPoints: number;
    wrongAnswers: number;
    socialEvents: number;
    savedEvents: number;
  }>();

  for (const event of events) {
    const domain = event.canonicalSubcategory.trim().replace(/\s+/g, ' ');
    if (!domain || !event.createdAt) continue;
    const key = domainKey(domain);
    const ageDays = Math.max(0, (now - event.createdAt.getTime()) / dayMs);
    const existing = byDomain.get(key) ?? {
      domain,
      firstAt: event.createdAt,
      latestAt: event.createdAt,
      answered: 0,
      recentAnswered: 0,
      recentPoints: 0,
      wrongAnswers: 0,
      socialEvents: 0,
      savedEvents: 0,
    };

    if (event.createdAt < existing.firstAt) existing.firstAt = event.createdAt;
    if (event.createdAt > existing.latestAt) existing.latestAt = event.createdAt;
    if (event.answerState) existing.answered += 1;
    if (event.answerState && ageDays <= 21) existing.recentAnswered += 1;
    if (ageDays <= 21) existing.recentPoints += Number(event.awardedPoints ?? 0);
    if (event.answerState === 'incorrect' && ageDays <= 21) existing.wrongAnswers += 1;
    if (event.sessionContext && FRIEND_MEDIATED_CONTEXTS.includes(event.sessionContext) && ageDays <= 21) {
      existing.socialEvents += 1;
    }
    if ((event.sourceType === 'authored' || event.sourceType === 'author_credit') && ageDays <= 21) {
      existing.savedEvents += 1;
    }
    byDomain.set(key, existing);
  }

  return [...byDomain.values()]
    .map((domain) => {
      const latestAgeDays = Math.max(0, (now - domain.latestAt.getTime()) / dayMs);
      const firstAgeDays = Math.max(0, (now - domain.firstAt.getTime()) / dayMs);
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

export async function getUserMasteryOverview(userId: string): Promise<MasteryOverview> {
  const [declaredRows, masteryRows, eventRows, recentRows, hiddenDomainKeys] = await Promise.all([
    getActiveDeclaredInterests(userId),
    getPlayerMasteryRows(userId, true),
    db
      .select({
        canonicalSubcategory: masteryEvents.canonicalSubcategory,
        sourceType: masteryEvents.sourceType,
        questionId: masteryEvents.questionId,
        awardedPoints: masteryEvents.awardedPoints,
        answerState: masteryEvents.answerState,
        sessionContext: masteryEvents.sessionContext,
        createdAt: masteryEvents.createdAt,
      })
      .from(masteryEvents)
      .where(eq(masteryEvents.userId, userId)),
    db
      .select({
        canonicalSubcategory: masteryEvents.canonicalSubcategory,
        sourceType: masteryEvents.sourceType,
        questionId: masteryEvents.questionId,
        awardedPoints: masteryEvents.awardedPoints,
        answerState: masteryEvents.answerState,
        sessionContext: masteryEvents.sessionContext,
        createdAt: masteryEvents.createdAt,
      })
      .from(masteryEvents)
      .where(eq(masteryEvents.userId, userId))
      .orderBy(desc(masteryEvents.createdAt))
      .limit(10),
    getHiddenDomainKeys(userId),
  ]);

  const totalPoints = masteryRows.reduce((sum, row) => sum + Number(row.totalPoints ?? 0), 0);
  const overall = getMasteryTierDisplay(totalPoints);
  const nextOverallTier = nextTierFor(overall.tier);
  const nextThreshold = nextOverallTier ? TIER_THRESHOLD_POINTS[nextOverallTier] : null;
  const statsByDomain = new Map<string, AnswerStats>();
  const demonstratedDomains = new Set<string>();
  const demonstratedDomainLabels = new Map<string, string>();

  for (const event of eventRows) {
    if (!event.answerState) continue;
    if (
      event.answerState !== 'incorrect'
      && event.questionId
      && FRIEND_MEDIATED_CONTEXTS.includes(event.sessionContext ?? '')
    ) {
      const key = domainKey(event.canonicalSubcategory);
      demonstratedDomains.add(key);
      demonstratedDomainLabels.set(key, event.canonicalSubcategory);
    }
    const key = domainKey(event.canonicalSubcategory);
    const existing = statsByDomain.get(key) ?? {
      answered: 0,
      correct: 0,
      lastActivityAt: null,
    };
    existing.answered += 1;
    if (event.answerState !== 'incorrect') existing.correct += 1;
    if (!existing.lastActivityAt || event.createdAt > existing.lastActivityAt) {
      existing.lastActivityAt = event.createdAt;
    }
    statsByDomain.set(key, existing);
  }

  const masteryByDomain = new Map(masteryRows.map((row) => [domainKey(row.canonicalSubcategory), row]));
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

export async function getKnowledgePageData(userId: string): Promise<KnowledgePageData> {
  const [declaredRows, masteryRows, eventRows, hiddenDomainKeys] = await Promise.all([
    getActiveDeclaredInterests(userId),
    getPlayerMasteryRows(userId, true),
    db
      .select({
        canonicalSubcategory: masteryEvents.canonicalSubcategory,
        sourceType: masteryEvents.sourceType,
        answerState: masteryEvents.answerState,
        sessionContext: masteryEvents.sessionContext,
        awardedPoints: masteryEvents.awardedPoints,
        createdAt: masteryEvents.createdAt,
      })
      .from(masteryEvents)
      .where(eq(masteryEvents.userId, userId)),
    getHiddenDomainKeys(userId),
  ]);

  const statsByDomain = new Map<string, AnswerStats>();
  for (const event of eventRows) {
    if (!event.answerState) continue;
    const key = domainKey(event.canonicalSubcategory);
    const existing = statsByDomain.get(key) ?? {
      answered: 0,
      correct: 0,
      lastActivityAt: null,
    };
    existing.answered += 1;
    if (event.answerState !== 'incorrect') existing.correct += 1;
    if (!existing.lastActivityAt || event.createdAt > existing.lastActivityAt) {
      existing.lastActivityAt = event.createdAt;
    }
    statsByDomain.set(key, existing);
  }

  const masteryByDomain = new Map(masteryRows.map((row) => [domainKey(row.canonicalSubcategory), row]));
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

  for (const row of eventRows) {
    const domain = row.canonicalSubcategory.trim().replace(/\s+/g, ' ');
    if (!domain) continue;
    const key = domainKey(domain);
    const existing = knowledgeDomainNames.get(key);
    knowledgeDomainNames.set(key, {
      domain: existing?.domain ?? domain,
      broadCategory: existing?.broadCategory ?? null,
      isDeclared: existing?.isDeclared ?? false,
      isDemonstrated: existing?.isDemonstrated ?? Boolean(row.answerState),
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
    expandingDomains: deriveExpandingDomains(eventRows),
    declaredInterests: declaredRows
      .map((row) => row.domain.trim().replace(/\s+/g, ' '))
      .filter(Boolean),
  };
}

export async function getProgressionLandscape(userId: string): Promise<ProgressionView[]> {
  const pageData = await getKnowledgePageData(userId);

  return pageData.allDomains
    .map((domain) => ({
      canonicalSubcategory: domain.displayName,
      canonicalSubcategorySlug: toCanonicalDomainSlug(domain.domain),
      broadCategory: domain.broadCategory,
      currentTier: domain.tier as MasteryTier,
      correctAnswerCount: domain.questionsCorrect,
      authoredCount: domain.questionsAnswered,
      iconKey: domain.iconKey,
      territoryType: domain.territoryType,
    }))
    .sort((a, b) => {
      const tierDiff = TIER_ORDER.indexOf(b.currentTier ?? 'establishing') - TIER_ORDER.indexOf(a.currentTier ?? 'establishing');
      if (tierDiff !== 0) return tierDiff;
      return b.correctAnswerCount - a.correctAnswerCount || a.canonicalSubcategory.localeCompare(b.canonicalSubcategory);
    });
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
