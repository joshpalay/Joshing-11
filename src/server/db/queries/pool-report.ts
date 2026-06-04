// Trust-tier pool reporting (B4 Phase 2 checkpoint + Phase 3 flag-off logging,
// PRD-D-5 §6).
//
// Counts the eligible pool per serving surface under the §6 tier rules WITHOUT
// enforcing anything — so we can confirm pools are healthy before flipping the
// enforcement flag (Drift Risk 1, step 3). Read-only.
//
//   self-practice (Daily Five)   → machine bank rows tier ≥ machine_verified
//   friend-facing / Convergence  → human_validated OR author_confirmed
//   author_confirmed (D9)        → author-asserted, friend-graph + public
//
// "tier ≥ machine_verified" excludes only `unverified`; higher tiers always
// remain eligible for a lower-bar surface.

import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '@/server/db';
import { generatedQuestions, questions } from '@/server/db/schema';

export interface TrustTierBreakdown {
  unverified: number;
  machine_verified: number;
  human_validated: number;
  author_confirmed: number;
}

export interface PoolReport {
  /** Non-duplicate machine bank rows by tier. */
  machineBank: TrustTierBreakdown;
  /** Non-duplicate, non-deleted human-authored rows by tier. */
  humanAuthored: TrustTierBreakdown;
  /** Eligible counts under §6 tier rules. */
  eligible: {
    /** Machine rows eligible for self-practice (tier ≥ machine_verified). */
    selfPractice: number;
    /** Human rows eligible for friend-facing (human_validated|author_confirmed). */
    friendFacing: number;
  };
  /** Questions flagged "nobody got it" for review. */
  nobodyCorrectFlagged: number;
}

const EMPTY: TrustTierBreakdown = {
  unverified: 0,
  machine_verified: 0,
  human_validated: 0,
  author_confirmed: 0,
};

async function machineBankBreakdown(): Promise<TrustTierBreakdown> {
  const rows = await db
    .select({ tier: generatedQuestions.trustTier, n: count() })
    .from(generatedQuestions)
    .where(eq(generatedQuestions.isDuplicate, false))
    .groupBy(generatedQuestions.trustTier);
  const out = { ...EMPTY };
  for (const r of rows) out[r.tier as keyof TrustTierBreakdown] = Number(r.n);
  return out;
}

async function humanAuthoredBreakdown(): Promise<TrustTierBreakdown> {
  const rows = await db
    .select({ tier: questions.trustTier, n: count() })
    .from(questions)
    .where(and(eq(questions.isDuplicate, false), isNull(questions.deletedAt)))
    .groupBy(questions.trustTier);
  const out = { ...EMPTY };
  for (const r of rows) out[r.tier as keyof TrustTierBreakdown] = Number(r.n);
  return out;
}

export async function getPoolReport(): Promise<PoolReport> {
  const [machineBank, humanAuthored, flaggedRows] = await Promise.all([
    machineBankBreakdown(),
    humanAuthoredBreakdown(),
    db
      .select({ n: count() })
      .from(questions)
      .where(and(eq(questions.nobodyCorrectFlag, true), isNull(questions.deletedAt))),
  ]);

  const selfPractice =
    machineBank.machine_verified + machineBank.human_validated + machineBank.author_confirmed;
  const friendFacing = humanAuthored.human_validated + humanAuthored.author_confirmed;

  return {
    machineBank,
    humanAuthored,
    eligible: { selfPractice, friendFacing },
    nobodyCorrectFlagged: Number(flaggedRows[0]?.n ?? 0),
  };
}

/** Convenience: log the pool report (used by the Phase 3 flag-off path). */
export async function logPoolReport(context: string): Promise<PoolReport> {
  const report = await getPoolReport();
  console.info(`[pool-report] ${context}`, {
    machineBank: report.machineBank,
    humanAuthored: report.humanAuthored,
    eligibleSelfPractice: report.eligible.selfPractice,
    eligibleFriendFacing: report.eligible.friendFacing,
    nobodyCorrectFlagged: report.nobodyCorrectFlagged,
  });
  return report;
}
