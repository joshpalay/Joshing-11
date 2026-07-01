import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import {
  dailyPreferences,
  db,
  declaredInterests,
  domainRelations,
  feedDismissedDomains,
  generatedQuestions,
  masteryEvents,
  playerMastery,
  userDomainDifficulties,
  userDomainExclusions,
  profileDomainVisibility,
  questions,
  skippedDailyQuestions,
} from '@/server/db';
import { ANTHROPIC_MODEL, extractTextContent, getAnthropicClient, loggedMessagesCreate, parseJsonObject } from '@/lib/llm';
import { pgErrorCode, pgErrorMessage } from '@/server/db/pg-error';
import { domainKey } from '@/lib/knowledge/domain-key';
import { effectiveTier, resolveTier } from '@/server/mastery/tiers';
import type { MasteryTier } from '@/types/db';

type DbClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

export type AggressiveBackfillResult = {
  mergesProposed: number;
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

type PlayerMasteryMergeRow = Pick<
  typeof playerMastery.$inferSelect,
  | 'id'
  | 'userId'
  | 'canonicalSubcategory'
  | 'broadCategory'
  | 'totalPoints'
  | 'tier'
  | 'tierReachedAt'
  | 'lifetimePointsBaseline'
  | 'updatedAt'
>;

const playerMasteryMergeColumns = {
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

const TIER_RANK: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 1,
  solid: 2,
  mastery: 3,
};

function normalizeDomain(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
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

async function upsertMergedPlayerMastery(
  tx: DbClient,
  values: {
    userId: string;
    canonicalSubcategory: string;
    broadCategory: string | null;
    totalPoints: number;
    tier: MasteryTier;
    lifetimePointsBaseline: number;
    updatedAt: Date;
  },
): Promise<void> {
  try {
    await tx
      .insert(playerMastery)
      .values({
        id: randomUUID(),
        userId: values.userId,
        canonicalSubcategory: values.canonicalSubcategory,
        broadCategory: values.broadCategory,
        totalPoints: values.totalPoints,
        tier: values.tier,
        tierReachedAt: null,
        lifetimePointsBaseline: values.lifetimePointsBaseline,
        updatedAt: values.updatedAt,
      })
      .onConflictDoUpdate({
        target: [playerMastery.userId, playerMastery.canonicalSubcategory],
        set: {
          broadCategory: values.broadCategory,
          totalPoints: values.totalPoints,
          tier: values.tier,
          updatedAt: values.updatedAt,
        },
      });
    return;
  } catch (error) {
    if (pgErrorCode(error) !== '42703' || !pgErrorMessage(error)?.includes('territory_type')) {
      throw error;
    }
  }

  await tx.execute(sql`
    insert into "PLAYER_MASTERY" (
      "id",
      "user_id",
      "canonical_subcategory",
      "broad_category",
      "total_points",
      "tier",
      "tier_reached_at",
      "lifetime_points_baseline",
      "updated_at"
    ) values (
      ${randomUUID()},
      ${values.userId},
      ${values.canonicalSubcategory},
      ${values.broadCategory},
      ${values.totalPoints},
      ${values.tier}::"public"."MasteryTier",
      null,
      ${values.lifetimePointsBaseline},
      ${values.updatedAt}
    ) on conflict ("user_id", "canonical_subcategory") do update set
      "broad_category" = ${values.broadCategory},
      "total_points" = ${values.totalPoints},
      "tier" = ${values.tier}::"public"."MasteryTier",
      "updated_at" = ${values.updatedAt}
  `);
}

type DomainVisibility = 'public' | 'friends' | 'private';

const DOMAIN_VISIBILITY_RANK: Record<DomainVisibility, number> = {
  public: 0,
  friends: 1,
  private: 2,
};

function mostRestrictiveVisibility(rows: Array<{ visibility: DomainVisibility }>): DomainVisibility {
  return rows.reduce<DomainVisibility>((mostRestrictive, row) => (
    DOMAIN_VISIBILITY_RANK[row.visibility] > DOMAIN_VISIBILITY_RANK[mostRestrictive]
      ? row.visibility
      : mostRestrictive
  ), 'public');
}

function isProfileDomainVisible(visibility: DomainVisibility): boolean {
  return visibility !== 'private';
}

export async function consolidateProfileDomainVisibility(
  tx: DbClient,
  values: {
    userId: string;
    sourceDomains: string[];
    target: string;
    updatedAt?: Date;
  },
): Promise<void> {
  const target = normalizeDomain(values.target);
  const domainsToConsolidate = [...new Set([...values.sourceDomains, target].map(normalizeDomain).filter(Boolean))];
  const existingRows = await tx
    .select({ visibility: profileDomainVisibility.visibility })
    .from(profileDomainVisibility)
    .where(and(
      eq(profileDomainVisibility.userId, values.userId),
      or(
        inArray(profileDomainVisibility.domain, domainsToConsolidate),
        inArray(profileDomainVisibility.canonicalSubcategory, domainsToConsolidate),
      ),
    ));
  const visibility = mostRestrictiveVisibility(existingRows);

  await tx
    .delete(profileDomainVisibility)
    .where(and(
      eq(profileDomainVisibility.userId, values.userId),
      or(
        inArray(profileDomainVisibility.domain, domainsToConsolidate),
        inArray(profileDomainVisibility.canonicalSubcategory, domainsToConsolidate),
      ),
    ));

  await tx
    .insert(profileDomainVisibility)
    .values({
      userId: values.userId,
      canonicalSubcategory: target,
      domain: target,
      visibility,
      isVisible: isProfileDomainVisible(visibility),
      updatedAt: values.updatedAt ?? new Date(),
    });
}

function mergeDomainList(domains: string[], sourceDomains: string[], target: string): string[] {
  const sourceKeys = new Set(sourceDomains.map(domainKey));
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawDomain of domains) {
    if (typeof rawDomain !== 'string') continue;
    const normalized = normalizeDomain(rawDomain);
    if (!normalized) continue;
    const nextDomain = sourceKeys.has(domainKey(normalized)) ? target : normalized;
    const nextKey = domainKey(nextDomain);
    if (seen.has(nextKey)) continue;
    seen.add(nextKey);
    merged.push(nextDomain);
  }

  return merged;
}

async function consolidateDailyPreferenceDomains(
  tx: DbClient,
  values: { userId: string; sourceDomains: string[]; target: string },
): Promise<void> {
  const [preference] = await tx
    .select({ id: dailyPreferences.id, selectedDomains: dailyPreferences.selectedDomains })
    .from(dailyPreferences)
    .where(eq(dailyPreferences.userId, values.userId));

  if (!preference) return;

  const selectedDomains = mergeDomainList(preference.selectedDomains ?? [], values.sourceDomains, values.target);
  const before = (preference.selectedDomains ?? []).filter((domain): domain is string => typeof domain === 'string');
  const changed = selectedDomains.length !== before.length
    || selectedDomains.some((domain, index) => domain !== before[index]);

  if (!changed) return;

  await tx
    .update(dailyPreferences)
    .set({ selectedDomains, updatedAt: new Date() })
    .where(eq(dailyPreferences.id, preference.id));
}

type DomainDifficultyRow = Pick<
  typeof userDomainDifficulties.$inferSelect,
  'canonicalSubcategory' | 'servedDifficulty' | 'consecutiveCorrect' | 'consecutiveIncorrect' | 'lastUpdated'
>;

function mostRecentDomainDifficulty(rows: DomainDifficultyRow[]): DomainDifficultyRow {
  return [...rows].sort((a, b) => {
    const bTime = b.lastUpdated?.getTime?.() ?? 0;
    const aTime = a.lastUpdated?.getTime?.() ?? 0;
    return bTime - aTime;
  })[0];
}

async function consolidateUserDomainDifficulties(
  tx: DbClient,
  values: { userId: string; sourceDomains: string[]; sourceDomainsToDelete: string[]; target: string },
): Promise<void> {
  const domainsToConsolidate = [...new Set([...values.sourceDomains, values.target].map(normalizeDomain).filter(Boolean))];
  const rows = await tx
    .select({
      canonicalSubcategory: userDomainDifficulties.canonicalSubcategory,
      servedDifficulty: userDomainDifficulties.servedDifficulty,
      consecutiveCorrect: userDomainDifficulties.consecutiveCorrect,
      consecutiveIncorrect: userDomainDifficulties.consecutiveIncorrect,
      lastUpdated: userDomainDifficulties.lastUpdated,
    })
    .from(userDomainDifficulties)
    .where(and(
      eq(userDomainDifficulties.userId, values.userId),
      inArray(userDomainDifficulties.canonicalSubcategory, domainsToConsolidate),
    ));

  if (rows.length > 0) {
    // Treat the most recently updated row as the user's current adaptive preference.
    // Streak counters are kept from that same row so we do not fabricate a cross-domain
    // consecutive streak while still carrying forward the latest calibration.
    const selected = mostRecentDomainDifficulty(rows);
    await tx
      .insert(userDomainDifficulties)
      .values({
        userId: values.userId,
        canonicalSubcategory: values.target,
        servedDifficulty: selected.servedDifficulty,
        consecutiveCorrect: selected.consecutiveCorrect,
        consecutiveIncorrect: selected.consecutiveIncorrect,
        lastUpdated: selected.lastUpdated ?? new Date(),
      })
      .onConflictDoUpdate({
        target: [userDomainDifficulties.userId, userDomainDifficulties.canonicalSubcategory],
        set: {
          servedDifficulty: selected.servedDifficulty,
          consecutiveCorrect: selected.consecutiveCorrect,
          consecutiveIncorrect: selected.consecutiveIncorrect,
          lastUpdated: selected.lastUpdated ?? new Date(),
        },
      });
  }

  if (values.sourceDomainsToDelete.length > 0) {
    await tx
      .delete(userDomainDifficulties)
      .where(and(
        eq(userDomainDifficulties.userId, values.userId),
        inArray(userDomainDifficulties.canonicalSubcategory, values.sourceDomainsToDelete),
      ));
  }
}

async function consolidateUserDomainExclusions(
  tx: DbClient,
  values: { userId: string; sourceDomains: string[]; sourceDomainsToDelete: string[]; target: string },
): Promise<void> {
  const rows = await tx
    .select({ excludedAt: userDomainExclusions.excludedAt })
    .from(userDomainExclusions)
    .where(and(
      eq(userDomainExclusions.userId, values.userId),
      inArray(userDomainExclusions.canonicalSubcategory, values.sourceDomains),
    ));

  if (rows.length > 0) {
    const earliestExcludedAt = rows.reduce<Date | null>((earliest, row) => {
      if (!row.excludedAt) return earliest;
      return !earliest || row.excludedAt < earliest ? row.excludedAt : earliest;
    }, null) ?? new Date();

    await tx
      .insert(userDomainExclusions)
      .values({
        userId: values.userId,
        canonicalSubcategory: values.target,
        excludedAt: earliestExcludedAt,
      })
      .onConflictDoNothing({
        target: [userDomainExclusions.userId, userDomainExclusions.canonicalSubcategory],
      });
  }

  if (values.sourceDomainsToDelete.length > 0) {
    await tx
      .delete(userDomainExclusions)
      .where(and(
        eq(userDomainExclusions.userId, values.userId),
        inArray(userDomainExclusions.canonicalSubcategory, values.sourceDomainsToDelete),
      ));
  }
}

async function consolidateFeedDismissedDomains(
  tx: DbClient,
  values: { userId: string; sourceDomainsToDelete: string[]; target: string },
): Promise<void> {
  if (values.sourceDomainsToDelete.length === 0) return;

  await tx.execute(sql`
    insert into "FeedDismissedDomain" ("id", "userId", "canonicalSubcategory", "dismissedAt", "reinstatedAt")
    select ${randomUUID()}, ${values.userId}, ${values.target}, min("dismissedAt"), null
    from "FeedDismissedDomain"
    where "userId" = ${values.userId}
      and "canonicalSubcategory" in (${sql.join(values.sourceDomainsToDelete.map((domain) => sql`${domain}`), sql`, `)})
      and "reinstatedAt" is null
    having count(*) > 0
    on conflict do nothing
  `);

  await tx
    .delete(feedDismissedDomains)
    .where(and(
      eq(feedDismissedDomains.userId, values.userId),
      inArray(feedDismissedDomains.canonicalSubcategory, values.sourceDomainsToDelete),
    ));
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
    return sources.length >= 1 && target ? [{ sources, target, rationale }] : [];
  });
}

async function suggestAggressiveDomainMerges(
  domains: Array<{ name: string; questionCount: number; tier: MasteryTier }>,
): Promise<SuggestedMerge[]> {
  const client = getAnthropicClient();
  if (!client || domains.length < 2) return [];

  const domainList = domains
    .map((d) => `- ${d.name} (${d.questionCount} questions, tier: ${d.tier})`)
    .join('\n');

  const prompt = `You are consolidating a user's trivia domain list. The user has accumulated domains over time. Some are at the wrong granularity — facets of a work or artist that should be merged into the parent domain.

Domain labels should identify a body of knowledge: a work, an artist, a period, a discipline. They should never identify a facet (themes, characters, structure, symbolism, technique, style, form).

RULES FOR MERGING:

1. AGGRESSIVE on facet-to-parent merges. Any domain that names a facet of an existing work or artist MUST be merged into the parent domain.
Examples:
"Mrs. Dalloway – Characters & Themes" → merge into "Mrs. Dalloway"
"Mrs. Dalloway – Themes & Characters" → merge into "Mrs. Dalloway"
"Mrs. Dalloway – Narrative Technique" → merge into "Mrs. Dalloway"
"Ulysses – Structure & Symbolism" → merge into "Ulysses"
"Ulysses – Structure & Technique" → merge into "Ulysses"

If the parent does not yet exist, CREATE it from the merge.

2. AGGRESSIVE on near-duplicate merges. Any two labels that refer to the same body of knowledge with different wording must be merged. This includes acronyms and abbreviations vs. their spelled-out forms.
Examples:
"Late Tchaikovsky" + "Tchaikovsky's Late Period" → one domain
"Joyce's Ulysses" + "James Joyce's Ulysses" + "Ulysses" → one domain (prefer the most concise canonical name)
"UX Design" + "User Experience Design" → one domain (prefer the most common form, e.g. "UX Design")
"AI" + "Artificial Intelligence" → one domain
"NYC History" + "New York City History" → one domain

3. CONSERVATIVE on splits and on cross-work merges.
Do NOT merge:
"Mrs. Dalloway" + "To the Lighthouse" (different works)
"Late Tchaikovsky" + "Early Tchaikovsky" (different periods)
"Bach's Well-Tempered Clavier" + "Bach's Cello Suites" (different works)

Here are the user's current domains:
${domainList}

Propose merges. Respond in JSON only:
{ "merges": [ { "sources": ["...", "..."], "target": "...", "rationale": "brief explanation" } ] }

If no merges are needed: { "merges": [] }`;

  let response;
  try {
    response = await loggedMessagesCreate(client, 'ceremony-narrative', {
      model: ANTHROPIC_MODEL,
      max_tokens: 1200,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tidy] Anthropic merge suggestion failed', { model: ANTHROPIC_MODEL, status, message });
    throw new Error(`LLM merge suggestion failed: ${message}`);
  }

  return parseSuggestedMerges(parseJsonObject(extractTextContent(response.content)));
}

// Shared transaction logic used by both runDomainMergesForUser and runAggressiveDomainBackfillForUser.
export async function applyMergesForUser(
  userId: string,
  masteryRows: PlayerMasteryMergeRow[],
  suggestions: SuggestedMerge[],
  verbose = false,
): Promise<MergeResult['details']> {
  const byKey = new Map(masteryRows.map((row) => [domainKey(row.canonicalSubcategory), row]));
  const applied: MergeResult['details'] = [];
  const consumedSourceKeys = new Set<string>();

  await db.transaction(async (tx) => {
    for (const suggestion of suggestions) {
      const target = normalizeDomain(suggestion.target);
      const targetKey = domainKey(target);
      const sourceRows = suggestion.sources
        .map((source) => byKey.get(domainKey(source)))
        .filter((row): row is PlayerMasteryMergeRow => Boolean(row))
        .filter((row) => !consumedSourceKeys.has(domainKey(row.canonicalSubcategory)));

      const uniqueSourceRows = [...new Map(sourceRows.map((row) => [domainKey(row.canonicalSubcategory), row])).values()];
      const onlySourceKey = uniqueSourceRows.length === 1
        ? domainKey(uniqueSourceRows[0].canonicalSubcategory)
        : null;
      const isApplicableMerge = uniqueSourceRows.length >= 2 || (onlySourceKey !== null && onlySourceKey !== targetKey);
      if (!isApplicableMerge) continue;

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

      await upsertMergedPlayerMastery(tx, {
        userId,
        canonicalSubcategory: target,
        broadCategory,
        totalPoints,
        tier,
        lifetimePointsBaseline: rowsToTotal.reduce((sum, row) => sum + Number(row.lifetimePointsBaseline ?? 0), 0),
        updatedAt,
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
        .set({ canonicalSubcategory: target, broadCategory: broadCategory ?? 'General Knowledge' })
        .where(and(eq(generatedQuestions.userId, userId), inArray(generatedQuestions.canonicalSubcategory, sourceDomains)));

      await tx
        .update(skippedDailyQuestions)
        .set({ canonicalSubcategory: target })
        .where(and(eq(skippedDailyQuestions.userId, userId), inArray(skippedDailyQuestions.canonicalSubcategory, sourceDomains)));

      // D-NEARNESS-LADDER-HYBRID-01 (B2): the merged-away domains' cached near-ness
      // rungs are now stale — drop any DomainRelation referencing them (as child OR
      // related). The survivor's tree rebuilds lazily on its next thin-crossing.
      // DomainRelation is a GLOBAL cache (not user-scoped); deleting here is
      // idempotent — a later user's merge of the same pair simply finds none.
      if (sourceDomains.length > 0) {
        await tx
          .delete(domainRelations)
          .where(or(
            inArray(domainRelations.childDomain, sourceDomains),
            inArray(domainRelations.relatedDomain, sourceDomains),
          ));
      }

      const declaredSourceRows = await tx
        .select({ isActive: declaredInterests.isActive })
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

      await consolidateProfileDomainVisibility(tx, {
        userId,
        sourceDomains,
        target,
      });

      await consolidateDailyPreferenceDomains(tx, {
        userId,
        sourceDomains,
        target,
      });

      await consolidateUserDomainDifficulties(tx, {
        userId,
        sourceDomains,
        sourceDomainsToDelete,
        target,
      });

      await consolidateUserDomainExclusions(tx, {
        userId,
        sourceDomains,
        sourceDomainsToDelete,
        target,
      });

      await consolidateFeedDismissedDomains(tx, {
        userId,
        sourceDomainsToDelete,
        target,
      });

      await tx.insert(masteryEvents).values({
        userId,
        canonicalSubcategory: target,
        sourceType: 'domain_merged',
        questionId: null,
        answeredByUserId: userId,
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

      if (verbose) {
        console.log(`  [backfill-domains] APPLIED: [${sourceDomains.join(', ')}] → "${target}" (${totalPoints} pts, tier: ${tier}) — ${suggestion.rationale}`);
      }

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

  return applied;
}

export async function runDomainMergesForUser(userId: string): Promise<MergeResult> {
  const masteryRows = await db
    .select(playerMasteryMergeColumns)
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId))
    .orderBy(desc(playerMastery.totalPoints));

  const domainsBefore = masteryRows.length;
  if (masteryRows.length < 2) {
    return { mergesApplied: 0, domainsBefore, domainsAfter: domainsBefore, details: [] };
  }

  const questionCountRows = await db
    .select({
      canonicalSubcategory: masteryEvents.canonicalSubcategory,
      questionCount: sql<number>`count(distinct ${masteryEvents.questionId})`,
    })
    .from(masteryEvents)
    .where(eq(masteryEvents.userId, userId))
    .groupBy(masteryEvents.canonicalSubcategory);

  const countByDomain = new Map(
    questionCountRows.map((row) => [domainKey(row.canonicalSubcategory), Number(row.questionCount)]),
  );

  const domainsWithContext = masteryRows.map((row) => ({
    name: row.canonicalSubcategory,
    questionCount: countByDomain.get(domainKey(row.canonicalSubcategory)) ?? 0,
    tier: row.tier,
  }));

  const suggestions = await suggestAggressiveDomainMerges(domainsWithContext);
  if (suggestions.length === 0) {
    return { mergesApplied: 0, domainsBefore, domainsAfter: domainsBefore, details: [] };
  }

  const applied = await applyMergesForUser(userId, masteryRows, suggestions);

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

export async function runAggressiveDomainBackfillForUser(
  userId: string,
  options: { dryRun?: boolean } = {},
): Promise<AggressiveBackfillResult> {
  const { dryRun = false } = options;

  const masteryRows = await db
    .select(playerMasteryMergeColumns)
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId))
    .orderBy(desc(playerMastery.totalPoints));

  const domainsBefore = masteryRows.length;
  if (masteryRows.length < 2) {
    return { mergesProposed: 0, mergesApplied: 0, domainsBefore, domainsAfter: domainsBefore, details: [] };
  }

  const questionCountRows = await db
    .select({
      canonicalSubcategory: masteryEvents.canonicalSubcategory,
      questionCount: sql<number>`count(distinct ${masteryEvents.questionId})`,
    })
    .from(masteryEvents)
    .where(eq(masteryEvents.userId, userId))
    .groupBy(masteryEvents.canonicalSubcategory);

  const countByDomain = new Map(
    questionCountRows.map((row) => [domainKey(row.canonicalSubcategory), Number(row.questionCount)]),
  );

  const domainsWithContext = masteryRows.map((row) => ({
    name: row.canonicalSubcategory,
    questionCount: countByDomain.get(domainKey(row.canonicalSubcategory)) ?? 0,
    tier: row.tier,
  }));

  const suggestions = await suggestAggressiveDomainMerges(domainsWithContext);
  const mergesProposed = suggestions.length;

  if (mergesProposed > 0) {
    console.log(`[backfill-domains] user=${userId} proposed=${mergesProposed} dryRun=${dryRun}`);
    for (const s of suggestions) {
      console.log(`  PROPOSE: [${s.sources.join(', ')}] → "${s.target}" — ${s.rationale}`);
    }
  } else {
    console.log(`[backfill-domains] user=${userId} no merges proposed`);
  }

  if (dryRun || mergesProposed === 0) {
    return {
      mergesProposed,
      mergesApplied: 0,
      domainsBefore,
      domainsAfter: domainsBefore,
      details: suggestions.map((s) => ({ sources: s.sources, target: s.target, rationale: s.rationale })),
    };
  }

  const applied = await applyMergesForUser(userId, masteryRows, suggestions, true);

  const domainsAfterRows = await db
    .select({ id: playerMastery.id })
    .from(playerMastery)
    .where(eq(playerMastery.userId, userId));

  return {
    mergesProposed,
    mergesApplied: applied.length,
    domainsBefore,
    domainsAfter: domainsAfterRows.length,
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
