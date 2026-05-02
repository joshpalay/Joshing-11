import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import {
  db,
  declaredInterests,
  generatedQuestions,
  masteryEvents,
  playerMastery,
  profileDomainVisibility,
  questions,
  skippedDailyQuestions,
} from '@/server/db';
import { ANTHROPIC_MODEL, extractTextContent, getAnthropicClient, parseJsonObject } from '@/lib/llm';
import { effectiveTier, resolveTier } from '@/server/mastery/tiers';
import type { MasteryTier } from '@/types/db';

type DbClient = any;

type MasteryMovementInput = {
  userId: string;
  from?: Date;
  to?: Date;
};

export type MergeResult = {
  mergesApplied: number;
  domainsBefore: number;
  domainsAfter: number;
  details: Array<{ sources: string[]; target: string; rationale: string }>;
};

type SuggestedMerge = {
  sources: string[];
  target: string;
  rationale: string;
};

const TIER_RANK: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 1,
  solid: 2,
  mastery: 3,
};

function normalizeDomain(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function domainKey(value: string): string {
  return normalizeDomain(value).toLowerCase();
}

function maxTier(rows: Array<{ tier: MasteryTier; totalPoints: number }>): MasteryTier {
  return rows.reduce<MasteryTier>((best, row) => {
    if (TIER_RANK[row.tier] > TIER_RANK[best]) return row.tier;
    const pointsTier = resolveTier(Number(row.totalPoints ?? 0));
    return TIER_RANK[pointsTier] > TIER_RANK[best] ? pointsTier : best;
  }, 'establishing');
}

function latestDate(rows: Array<{ updatedAt: Date | null }>): Date | null {
  return rows.reduce<Date | null>((latest, row) => {
    if (!row.updatedAt) return latest;
    return !latest || row.updatedAt > latest ? row.updatedAt : latest;
  }, null);
}

function broadCategoryFor(rows: Array<{ canonicalSubcategory: string; broadCategory: string | null }>, target: string): string | null {
  const targetRow = rows.find((row) => domainKey(row.canonicalSubcategory) === domainKey(target));
  if (targetRow?.broadCategory) return targetRow.broadCategory;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.broadCategory) continue;
    counts.set(row.broadCategory, (counts.get(row.broadCategory) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function parseSuggestedMerges(raw: unknown): SuggestedMerge[] {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!record || !Array.isArray(record.merges)) return [];

  return record.merges.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const merge = item as Record<string, unknown>;
    const sources = Array.isArray(merge.sources)
      ? merge.sources.flatMap((source) => typeof source === 'string' ? [normalizeDomain(source)] : []).filter(Boolean)
      : [];
    const target = typeof merge.target === 'string' ? normalizeDomain(merge.target) : '';
    const rationale = typeof merge.rationale === 'string' ? merge.rationale.trim() : '';
    return sources.length >= 2 && target ? [{ sources, target, rationale }] : [];
  });
}

async function suggestDomainMerges(domainNames: string[]): Promise<SuggestedMerge[]> {
  const client = getAnthropicClient();
  if (!client || domainNames.length < 2) return [];

  const prompt = `These are trivia domain labels for one user's knowledge map. Identify any groups of 2+ that are so closely related they should be merged into a single broader (but still hyper-specific) label. Do NOT suggest merging different things just because they're in the same broad category. Only merge near-duplicates or refinements of the same narrow topic.

Example merges:
'Bach WTC Book 1' + 'Bach WTC Book 2' + 'WTC Fugues' -> 'Bach Well-Tempered Clavier'
'Late Bowie' + 'Bowie 1976-1980' -> 'Berlin-Era Bowie'

Example NON-merges:
'Tchaikovsky Symphonies' + 'Tchaikovsky Ballets' (different things)
'Russian Literature' + 'French Literature' (different things)

Respond in JSON: { "merges": [ { "sources": ["...", "..."], "target": "...", "rationale": "..." } ] } If no merges needed: { "merges": [] }

Domain labels:
${domainNames.map((name) => `- ${name}`).join('\n')}`;

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 900,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseSuggestedMerges(parseJsonObject(extractTextContent(response.content)));
}

export async function runDomainMergesForUser(userId: string): Promise<MergeResult> {
  const masteryRows = await db
    .select()
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId))
    .orderBy(desc(playerMastery.totalPoints));

  const domainsBefore = masteryRows.length;
  if (masteryRows.length < 2) {
    return { mergesApplied: 0, domainsBefore, domainsAfter: domainsBefore, details: [] };
  }

  const byKey = new Map(masteryRows.map((row) => [domainKey(row.canonicalSubcategory), row]));
  const suggestions = await suggestDomainMerges(masteryRows.map((row) => row.canonicalSubcategory));
  if (suggestions.length === 0) {
    return { mergesApplied: 0, domainsBefore, domainsAfter: domainsBefore, details: [] };
  }

  const applied: MergeResult['details'] = [];
  const consumedSourceKeys = new Set<string>();

  await db.transaction(async (tx) => {
    for (const suggestion of suggestions) {
      const target = normalizeDomain(suggestion.target);
      const targetKey = domainKey(target);
      const sourceRows = suggestion.sources
        .map((source) => byKey.get(domainKey(source)))
        .filter((row): row is typeof playerMastery.$inferSelect => Boolean(row))
        .filter((row) => !consumedSourceKeys.has(domainKey(row.canonicalSubcategory)));

      const uniqueSourceRows = [...new Map(sourceRows.map((row) => [domainKey(row.canonicalSubcategory), row])).values()];
      if (uniqueSourceRows.length < 2) continue;

      const existingTarget = byKey.get(targetKey);
      const rowsToTotal = existingTarget && !uniqueSourceRows.some((row) => row.id === existingTarget.id)
        ? [existingTarget, ...uniqueSourceRows]
        : uniqueSourceRows;
      const sourceDomains = uniqueSourceRows.map((row) => row.canonicalSubcategory);
      const sourceDomainsToDelete = sourceDomains.filter((source) => domainKey(source) !== targetKey);
      const sourceKeysToDelete = sourceDomainsToDelete.map(domainKey);
      const sourceRowsToDelete = uniqueSourceRows.filter((row) => sourceKeysToDelete.includes(domainKey(row.canonicalSubcategory)));
      const totalPoints = rowsToTotal.reduce((sum, row) => sum + Number(row.totalPoints ?? 0), 0);
      const authorCreditRows = await tx
        .select({
          points: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}), 0)`,
          distinctQuestions: sql<number>`count(distinct ${masteryEvents.questionId})`,
        })
        .from(masteryEvents)
        .where(and(
          eq(masteryEvents.userId, userId),
          inArray(masteryEvents.canonicalSubcategory, sourceDomains),
          eq(masteryEvents.sourceType, 'author_credit'),
        ));
      const tierByPoints = effectiveTier(
        totalPoints,
        Number(authorCreditRows[0]?.points ?? 0),
        Number(authorCreditRows[0]?.distinctQuestions ?? 0),
      );
      const strongestExistingTier = maxTier(rowsToTotal);
      const tier = TIER_RANK[strongestExistingTier] > TIER_RANK[tierByPoints] ? strongestExistingTier : tierByPoints;
      const updatedAt = latestDate(rowsToTotal.map((row) => ({ updatedAt: row.updatedAt }))) ?? new Date();
      const broadCategory = broadCategoryFor(rowsToTotal, target);

      await tx
        .insert(playerMastery)
        .values({
          userId,
          canonicalSubcategory: target,
          broadCategory,
          totalPoints,
          tier,
          tierReachedAt: null,
          seasonPointsStart: rowsToTotal.reduce((sum, row) => sum + Number(row.seasonPointsStart ?? 0), 0),
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [playerMastery.userId, playerMastery.canonicalSubcategory],
          set: {
            broadCategory,
            totalPoints,
            tier,
            updatedAt,
          },
        });

      if (sourceDomainsToDelete.length > 0) {
        await tx
          .delete(playerMastery)
          .where(and(
            eq(playerMastery.userId, userId),
            inArray(playerMastery.canonicalSubcategory, sourceDomainsToDelete),
          ));
      }

      await tx
        .update(masteryEvents)
        .set({ canonicalSubcategory: target })
        .where(and(eq(masteryEvents.userId, userId), inArray(masteryEvents.canonicalSubcategory, sourceDomains)));

      await tx
        .update(questions)
        .set({ canonicalSubcategory: target, broadCategory })
        .where(and(eq(questions.creatorId, userId), inArray(questions.canonicalSubcategory, sourceDomains)));

      await tx
        .update(generatedQuestions)
        .set({ canonicalSubcategory: target, broadCategory: broadCategory ?? 'Other' })
        .where(and(eq(generatedQuestions.userId, userId), inArray(generatedQuestions.canonicalSubcategory, sourceDomains)));

      await tx
        .update(skippedDailyQuestions)
        .set({ canonicalSubcategory: target })
        .where(and(eq(skippedDailyQuestions.userId, userId), inArray(skippedDailyQuestions.canonicalSubcategory, sourceDomains)));

      const declaredSourceRows = await tx
        .select()
        .from(declaredInterests)
        .where(and(
          eq(declaredInterests.userId, userId),
          inArray(declaredInterests.domain, sourceDomains),
        ));

      if (declaredSourceRows.length > 0) {
        await tx
          .insert(declaredInterests)
          .values({
            userId,
            domain: target,
            broadCategory,
            declaredAt: new Date(),
            isActive: declaredSourceRows.some((row) => row.isActive),
          })
          .onConflictDoUpdate({
            target: [declaredInterests.userId, declaredInterests.domain],
            set: {
              broadCategory,
              isActive: sql`${declaredInterests.isActive} OR ${declaredSourceRows.some((row) => row.isActive)}`,
            },
          });

        if (sourceDomainsToDelete.length > 0) {
          await tx
            .delete(declaredInterests)
            .where(and(eq(declaredInterests.userId, userId), inArray(declaredInterests.domain, sourceDomainsToDelete)));
        }
      }

      await tx
        .insert(profileDomainVisibility)
        .values({
          userId,
          canonicalSubcategory: target,
          domain: target,
          visibility: 'public',
          isVisible: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [profileDomainVisibility.userId, profileDomainVisibility.domain],
          set: {
            canonicalSubcategory: target,
            updatedAt: new Date(),
          },
        });

      if (sourceDomainsToDelete.length > 0) {
        await tx
          .delete(profileDomainVisibility)
          .where(and(eq(profileDomainVisibility.userId, userId), inArray(profileDomainVisibility.domain, sourceDomainsToDelete)));
      }

      await tx.insert(masteryEvents).values({
        userId,
        canonicalSubcategory: target,
        sourceType: 'domain_merged',
        questionId: null,
        answeredByUserId: userId,
        answerId: `domain_merged:${userId}:${Date.now()}:${applied.length}`,
        basePoints: 0,
        weight: 0,
        awardedPoints: 0,
        answerState: null,
        sessionContext: 'domain_merge',
        metadata: {
          sources: sourceDomains,
          target,
          rationale: suggestion.rationale,
        },
      });

      for (const row of sourceRowsToDelete) {
        consumedSourceKeys.add(domainKey(row.canonicalSubcategory));
        byKey.delete(domainKey(row.canonicalSubcategory));
      }
      byKey.set(targetKey, {
        ...(existingTarget ?? uniqueSourceRows[0]),
        canonicalSubcategory: target,
        broadCategory,
        totalPoints,
        tier,
        updatedAt,
      });
      applied.push({ sources: sourceDomains, target, rationale: suggestion.rationale });
    }
  });

  const domainsAfter = await db
    .select({ id: playerMastery.id })
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId));

  return {
    mergesApplied: applied.length,
    domainsBefore,
    domainsAfter: domainsAfter.length,
    details: applied,
  };
}

export async function getCategoryTotals(db: DbClient, userId: string) {
  return db
    .select({
      canonical_subcategory: playerMastery.canonicalSubcategory,
      total_points: playerMastery.totalPoints,
      tier: playerMastery.tier,
      updated_at: playerMastery.updatedAt,
    })
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId))
    .orderBy(desc(playerMastery.totalPoints), asc(playerMastery.canonicalSubcategory));
}

export async function getTopCategoriesPerPlayer(db: DbClient, userId: string, limit = 3) {
  const totals = await getCategoryTotals(db, userId);
  return totals.slice(0, Math.max(0, limit));
}

export async function getStrongestCategory(db: DbClient, userId: string) {
  const [strongest] = await db
    .select({
      canonical_subcategory: playerMastery.canonicalSubcategory,
      total_points: playerMastery.totalPoints,
      tier: playerMastery.tier,
      updated_at: playerMastery.updatedAt,
    })
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId))
    .orderBy(desc(playerMastery.totalPoints), desc(playerMastery.updatedAt), asc(playerMastery.canonicalSubcategory))
    .limit(1);

  return strongest ?? null;
}

export async function getMasteryMovement(db: DbClient, input: MasteryMovementInput) {
  const filters = [
    eq(masteryEvents.userId, input.userId),
    input.from ? gte(masteryEvents.createdAt, input.from) : undefined,
    input.to ? lte(masteryEvents.createdAt, input.to) : undefined,
  ].filter(Boolean);

  const events = await db
    .select({
      canonical_subcategory: masteryEvents.canonicalSubcategory,
      awarded_points: masteryEvents.awardedPoints,
    })
    .from(masteryEvents)
    .where(and(...filters));

  const deltaBySubcategory = new Map<string, number>();
  for (const event of events) {
    const next = (deltaBySubcategory.get(event.canonical_subcategory) ?? 0) + event.awarded_points;
    deltaBySubcategory.set(event.canonical_subcategory, next);
  }

  const subcategories = [...deltaBySubcategory.keys()];
  if (subcategories.length === 0) {
    return [];
  }

  const afterRows: Array<{
    canonical_subcategory: string;
    total_points: number;
    tier: ReturnType<typeof resolveTier>;
  }> = await db
    .select({
      canonical_subcategory: playerMastery.canonicalSubcategory,
      total_points: playerMastery.totalPoints,
      tier: playerMastery.tier,
    })
    .from(playerMastery)
    .where(and(
      eq(playerMastery.userId, input.userId),
      inArray(playerMastery.canonicalSubcategory, subcategories),
    ));

  const afterBySubcategory = new Map(
    afterRows.map((row) => [row.canonical_subcategory, row])
  );

  return subcategories
    .map((subcategory) => {
      const pointsDelta = deltaBySubcategory.get(subcategory) ?? 0;
      const after = afterBySubcategory.get(subcategory);
      const afterPoints = after?.total_points ?? pointsDelta;
      const beforePoints = Math.max(0, afterPoints - pointsDelta);

      return {
        canonical_subcategory: subcategory,
        points_before: beforePoints,
        points_after: afterPoints,
        points_delta: pointsDelta,
        tier_before: resolveTier(beforePoints),
        tier_after: after?.tier ?? resolveTier(afterPoints),
      };
    })
    .sort((a, b) => b.points_delta - a.points_delta || a.canonical_subcategory.localeCompare(b.canonical_subcategory));
}
