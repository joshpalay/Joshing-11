import { resolveTier } from '@/server/mastery/tiers';
import { progressWithinCurrentTier } from '@/server/mastery/tier-progress';
import { prisma } from '@/lib/prisma';
import { getPortraitData } from '@/server/profile/portrait';
import { KNOWLEDGE_GRAPH_DOMAIN_LIMIT } from '@/server/profile/knowledge-graph';
import { getKnowledgeTierInterpretation } from '@/server/profile/knowledge-tier-copy';
import type { MasteryTier } from '@prisma/client';
import type { DomainDetail, KnowledgeDomain, KnowledgeOverview } from '@/server/profile/knowledge-types';

const STRONG_TERRITORY_TIERS = new Set<KnowledgeDomain['tier']>(['mastery', 'solid']);

function toNaturalList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items[0]}, ${items[1]}, and ${items[2]}`;
}

function buildYourMindSentence(domains: KnowledgeDomain[]): string {
  const strongestDomains = domains
    .filter((domain) => STRONG_TERRITORY_TIERS.has(domain.tier))
    .slice(0, 3)
    .map((domain) => domain.name);
  const visibleTop = domains.slice(0, 3).map((domain) => domain.name);

  if (strongestDomains.length >= 3) {
    return `A mind shaped by ${toNaturalList(strongestDomains)}.`;
  }

  if (strongestDomains.length === 2) {
    const emerging = visibleTop.find((name) => !strongestDomains.includes(name));
    if (emerging) {
      return `A mind anchored in ${toNaturalList(strongestDomains)}, with ${emerging} starting to take shape.`;
    }
    return `A mind drawn to ${toNaturalList(strongestDomains)}.`;
  }

  if (strongestDomains.length === 1) {
    const surroundingSignals = visibleTop.filter((name) => name !== strongestDomains[0]).slice(0, 2);
    if (surroundingSignals.length === 2) {
      return `A mind anchored in ${strongestDomains[0]}, with ${toNaturalList(surroundingSignals)} coming into focus.`;
    }
    if (surroundingSignals.length === 1) {
      return `A mind anchored in ${strongestDomains[0]}, with ${surroundingSignals[0]} coming into focus.`;
    }
    return `A mind anchored in ${strongestDomains[0]}.`;
  }

  if (visibleTop.length >= 3) {
    return `A mind taking shape through ${toNaturalList(visibleTop)}.`;
  }
  if (visibleTop.length === 2) {
    return `A mind taking shape through ${toNaturalList(visibleTop)}.`;
  }
  if (visibleTop.length === 1) {
    return `A mind beginning to form around ${visibleTop[0]}.`;
  }
  return 'A mind still taking shape through each new question.';
}

export function buildSpiderGraphInterpretation(domains: KnowledgeDomain[]): string | null {
  const topDomains = domains.slice(0, KNOWLEDGE_GRAPH_DOMAIN_LIMIT);
  if (topDomains.length === 0) return null;

  const strongest = topDomains[0];
  const developing =
    [...topDomains].reverse().find((domain) => domain.tier === 'establishing' || domain.tier === 'familiar') ??
    topDomains.find((domain) => domain.name !== strongest.name);

  const firstSentence = `Your strongest territory is ${strongest.name}.`;
  const secondSentence = developing
    ? `You're still building in ${developing.name}.`
    : `${strongest.name} is setting the direction of your map right now.`;

  return [firstSentence, secondSentence].join(' ');
}

export async function getKnowledgeOverview(userId: string): Promise<KnowledgeOverview> {
  const [user, masteryRows, portrait, visibilityRows, exclusionRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, display_name: true } }),
    prisma.playerMastery.findMany({
      where: { user_id: userId },
      select: { canonical_subcategory: true, tier: true, total_points: true, broad_category: true },
      orderBy: [{ total_points: 'desc' }, { canonical_subcategory: 'asc' }],
    }),
    getPortraitData(userId),
    prisma.profileDomainVisibility.findMany({
      where: { user_id: userId },
      select: { canonical_subcategory: true, is_visible: true },
    }),
    prisma.userDomainExclusion.findMany({
      where: { user_id: userId },
      select: { canonical_subcategory: true },
    }),
  ]);

  const excludedSet = new Set(exclusionRows.map((row) => row.canonical_subcategory));
  const visibilityByDomain = new Map(visibilityRows.map((row) => [row.canonical_subcategory, row.is_visible]));
  const portraitByDomain = new Map(portrait.categories.map((row) => [row.canonical_subcategory, row]));

  const allDomainNames = new Set<string>();
  for (const row of masteryRows) allDomainNames.add(row.canonical_subcategory);
  for (const row of portrait.categories) allDomainNames.add(row.canonical_subcategory);

  const domains: KnowledgeDomain[] = [...allDomainNames].map((name) => {
    const mastery = masteryRows.find((row) => row.canonical_subcategory === name);
    const portraitRow = portraitByDomain.get(name);
    const masteryPoints = mastery ? Number(mastery.total_points) : 0;
    const tier = mastery?.tier ?? resolveTier(masteryPoints);

    return {
      name,
      tier,
      progressWithinTier: progressWithinCurrentTier(masteryPoints),
      masteryPoints,
      declaredQuestionCount: portraitRow?.question_count ?? 0,
      provenCorrectCount: portraitRow?.answer_count ?? 0,
      isVisibleOnProfile: visibilityByDomain.get(name) ?? true,
      broadCategory: mastery?.broad_category ?? null,
    };
  });

  domains.sort((a, b) => {
    if (b.masteryPoints !== a.masteryPoints) return b.masteryPoints - a.masteryPoints;
    const aWeight = a.declaredQuestionCount + a.provenCorrectCount;
    const bWeight = b.declaredQuestionCount + b.provenCorrectCount;
    if (bWeight !== aWeight) return bWeight - aWeight;
    return a.name.localeCompare(b.name);
  });

  const activeDomains = domains.filter((d) => !excludedSet.has(d.name));
  const excludedDomains = domains.filter((d) => excludedSet.has(d.name));

  return {
    userId,
    displayName: user?.display_name?.trim() || 'Player',
    yourMind: buildYourMindSentence(activeDomains),
    topDomains: activeDomains.slice(0, KNOWLEDGE_GRAPH_DOMAIN_LIMIT),
    allDomains: activeDomains,
    excludedDomains,
  };
}

export async function getDomainDetail(userId: string, domainName: string): Promise<DomainDetail | null> {
  const overview = await getKnowledgeOverview(userId);
  const domain = overview.allDomains.find((item) => item.name === domainName);
  if (!domain) return null;

  const [correctAnswers, authoredQuestions] = await Promise.all([
    prisma.answer.findMany({
      where: {
        user_id: userId,
        result: 'correct',
        question: { canonical_subcategory: domainName },
      },
      select: {
        question_id: true,
        question: {
          select: {
            question_text: true,
            factual_explanation: true,
            explainer_full_correct: true,
            creator: { select: { display_name: true } },
          },
        },
      },
      orderBy: { answered_at: 'desc' },
      distinct: ['question_id'],
    }),
    prisma.question.findMany({
      where: {
        creator_id: userId,
        canonical_subcategory: domainName,
        deleted_at: null,
      },
      select: {
        id: true,
        question_text: true,
      },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  const correctRows = correctAnswers.map((row) => ({
    questionId: row.question_id,
    questionText: row.question.question_text,
    authorName: row.question.creator.display_name?.trim() || 'Unknown author',
    explanation: row.question.explainer_full_correct ?? row.question.factual_explanation ?? null,
  }));

  const authoredRows = authoredQuestions.map((row) => {
    return {
      questionId: row.id,
      questionText: row.question_text,
      // TODO v11.0: question.game_questions/game/group relations - needs new data source
      groupNames: [],
    };
  });

  const explanation = domain.tier === 'mastery' || domain.tier === 'solid'
    ? "You've consistently answered questions in this area and contributed your own — this is part of your core territory."
    : "This domain reflects both what you've recognized and what you've brought into the game.";

  return {
    domain,
    explanation,
    correctAnswers: correctRows,
    authoredQuestions: authoredRows,
  };
}

export async function setDomainVisibility(params: { userId: string; domainName: string; isVisible: boolean }): Promise<void> {
  await prisma.profileDomainVisibility.upsert({
    where: {
      user_id_canonical_subcategory: {
        user_id: params.userId,
        canonical_subcategory: params.domainName,
      },
    },
    create: {
      user_id: params.userId,
      canonical_subcategory: params.domainName,
      is_visible: params.isVisible,
    },
    update: {
      is_visible: params.isVisible,
    },
  });
}

export async function getShareableKnowledgeOverview(userId: string): Promise<KnowledgeOverview | null> {
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { portrait_visibility: true } });
  if (!owner || owner.portrait_visibility === 'private') return null;

  const overview = await getKnowledgeOverview(userId);
  const visibleDomains = overview.allDomains.filter((domain) => domain.isVisibleOnProfile);

  return {
    ...overview,
    allDomains: visibleDomains,
    topDomains: visibleDomains.slice(0, KNOWLEDGE_GRAPH_DOMAIN_LIMIT),
    yourMind: buildYourMindSentence(visibleDomains),
  };
}

export function getDomainStatusCopy(tier: MasteryTier): string {
  return getKnowledgeTierInterpretation(tier);
}
