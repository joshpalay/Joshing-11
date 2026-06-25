import { desc, isNotNull, sql } from 'drizzle-orm';

import { db, userDomainDifficulties } from '@/server/db';

// Read-only diagnostic over the expansion-offer funnel, sourced straight from
// USER_DOMAIN_DIFFICULTY (the columns migration 0089 added). The funnel:
//   eligible  — a player topped a domain's ladder yet still out-ran its content
//               (expansion_eligible_since set by recalibrateDomainDifficultyToSupply).
//   resolved  — they later accepted or dismissed the offer (expansion_offered_at set).
//   pending   — eligible but not yet resolved (offer still surfacing).
// The accept-vs-dismiss split is NOT stored here (offered_at is set for both); that
// lives in the [expansion-offer] resolved logs / Axiom. This answers "how often is
// the offer triggered" from durable state.

export type ExpansionOfferTotals = {
  eligible: number;
  resolved: number;
  pending: number;
};

export type ExpansionOfferDomainRow = {
  domain: string;
  eligible: number;
  resolved: number;
  pending: number;
};

export type ExpansionOfferRecentRow = {
  userId: string;
  domain: string;
  servedDifficulty: string;
  eligibleSince: Date;
  offeredAt: Date | null;
};

export type ExpansionOfferDiagnostic = {
  totals: ExpansionOfferTotals;
  byDomain: ExpansionOfferDomainRow[];
  recent: ExpansionOfferRecentRow[];
};

export const RECENT_LIMIT = 200;

const resolvedFilter = sql<number>`count(*) filter (where ${userDomainDifficulties.expansionOfferedAt} is not null)`;

export async function loadExpansionOfferDiagnostic(
  recentLimit = RECENT_LIMIT,
): Promise<ExpansionOfferDiagnostic> {
  const eligibleSet = isNotNull(userDomainDifficulties.expansionEligibleSince);

  const [totalsRow, domainRows, recentRows] = await Promise.all([
    db
      .select({ eligible: sql<number>`count(*)`, resolved: resolvedFilter })
      .from(userDomainDifficulties)
      .where(eligibleSet),
    db
      .select({
        domain: userDomainDifficulties.canonicalSubcategory,
        eligible: sql<number>`count(*)`,
        resolved: resolvedFilter,
      })
      .from(userDomainDifficulties)
      .where(eligibleSet)
      .groupBy(userDomainDifficulties.canonicalSubcategory)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        userId: userDomainDifficulties.userId,
        domain: userDomainDifficulties.canonicalSubcategory,
        servedDifficulty: userDomainDifficulties.servedDifficulty,
        eligibleSince: userDomainDifficulties.expansionEligibleSince,
        offeredAt: userDomainDifficulties.expansionOfferedAt,
      })
      .from(userDomainDifficulties)
      .where(eligibleSet)
      .orderBy(desc(userDomainDifficulties.expansionEligibleSince))
      .limit(recentLimit),
  ]);

  const eligible = Number(totalsRow[0]?.eligible ?? 0);
  const resolved = Number(totalsRow[0]?.resolved ?? 0);

  const byDomain: ExpansionOfferDomainRow[] = domainRows.map((row) => {
    const dEligible = Number(row.eligible);
    const dResolved = Number(row.resolved);
    return {
      domain: row.domain,
      eligible: dEligible,
      resolved: dResolved,
      pending: dEligible - dResolved,
    };
  });

  const recent: ExpansionOfferRecentRow[] = recentRows
    .filter((row): row is typeof row & { eligibleSince: Date } => row.eligibleSince != null)
    .map((row) => ({
      userId: row.userId,
      domain: row.domain,
      servedDifficulty: row.servedDifficulty,
      eligibleSince: row.eligibleSince,
      offeredAt: row.offeredAt ?? null,
    }));

  return {
    totals: { eligible, resolved, pending: eligible - resolved },
    byDomain,
    recent,
  };
}
