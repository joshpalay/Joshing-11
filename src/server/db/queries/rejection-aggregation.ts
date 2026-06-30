/**
 * Rejection aggregation for the weekly prompt-improvement report
 * (D-QUESTION-QUALITY-AGENTS-01, Decision C).
 *
 * Rolls up publicStatus='rejected' questions and verificationVerdict='demoted'
 * questions by broadCategory × canonicalSubcategory over a trailing window,
 * extracting a rejection-kind label from publicEligibilityReason for vet-question
 * rejections and using 'batch_demoted' for batch-verify demotions.
 *
 * A minimum sample size floor (Decision C) prevents a single odd question from
 * driving a prompt-diff proposal.
 */
import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { db, questions } from '@/server/db';

export type RejectionKindLabel =
  | 'factual'
  | 'quality'
  | 'answer_leaked'
  | 'safety'
  | 'batch_demoted'
  | 'other';

export type RejectionCluster = {
  broadCategory: string | null;
  canonicalSubcategory: string | null;
  kind: RejectionKindLabel;
  count: number;
  /** Sample reasons (up to 3), for the prompt-diff proposer's evidence section. */
  sampleReasons: string[];
};

export type RejectionAggregationReport = {
  windowDays: number;
  minSampleSize: number;
  totalRejected: number;
  totalDemoted: number;
  clusters: RejectionCluster[];
  generatedAt: Date;
};

function parseRejectionKind(publicEligibilityReason: string | null): RejectionKindLabel {
  if (!publicEligibilityReason) return 'other';
  const r = publicEligibilityReason.toLowerCase();
  if (r.startsWith('factual:')) return 'factual';
  if (r.startsWith('quality')) return 'quality';
  if (r.startsWith('answer in question:')) return 'answer_leaked';
  if (r.startsWith('safety:')) return 'safety';
  return 'other';
}

/**
 * Build the rejection aggregation over the trailing `windowDays`, dropping
 * clusters with fewer than `minSampleSize` rejections (Decision C default: 5).
 */
export async function buildRejectionAggregation(
  windowDays = 30,
  minSampleSize = 5,
): Promise<RejectionAggregationReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Fetch vet-question rejections
  const vetRejected = await db
    .select({
      broadCategory: questions.broadCategory,
      canonicalSubcategory: questions.canonicalSubcategory,
      reason: questions.publicEligibilityReason,
    })
    .from(questions)
    .where(and(
      eq(questions.publicStatus, 'rejected'),
      gte(questions.updatedAt, since),
      isNull(questions.deletedAt),
    ));

  // Fetch batch-verify demotions
  const batchDemoted = await db
    .select({
      broadCategory: questions.broadCategory,
      canonicalSubcategory: questions.canonicalSubcategory,
      reason: sql<string | null>`null::text`,
    })
    .from(questions)
    .where(and(
      eq(questions.verificationVerdict, 'demoted'),
      gte(questions.updatedAt, since),
      isNull(questions.deletedAt),
    ));

  // Group into clusters keyed by broadCategory × canonicalSubcategory × kind
  type ClusterKey = string;
  const clusterMap = new Map<ClusterKey, {
    broadCategory: string | null;
    canonicalSubcategory: string | null;
    kind: RejectionKindLabel;
    count: number;
    reasons: string[];
  }>();

  const addToCluster = (
    broadCategory: string | null,
    canonicalSubcategory: string | null,
    kind: RejectionKindLabel,
    reason: string | null,
  ) => {
    const key: ClusterKey = `${broadCategory ?? ''}|${canonicalSubcategory ?? ''}|${kind}`;
    const existing = clusterMap.get(key);
    if (existing) {
      existing.count += 1;
      if (reason && existing.reasons.length < 3) existing.reasons.push(reason);
    } else {
      clusterMap.set(key, {
        broadCategory,
        canonicalSubcategory,
        kind,
        count: 1,
        reasons: reason ? [reason] : [],
      });
    }
  };

  for (const row of vetRejected) {
    addToCluster(
      row.broadCategory,
      row.canonicalSubcategory,
      parseRejectionKind(row.reason),
      row.reason,
    );
  }

  for (const row of batchDemoted) {
    addToCluster(row.broadCategory, row.canonicalSubcategory, 'batch_demoted', null);
  }

  const clusters: RejectionCluster[] = Array.from(clusterMap.values())
    .filter((c) => c.count >= minSampleSize)
    .sort((a, b) => b.count - a.count)
    .map((c) => ({
      broadCategory: c.broadCategory,
      canonicalSubcategory: c.canonicalSubcategory,
      kind: c.kind,
      count: c.count,
      sampleReasons: c.reasons,
    }));

  return {
    windowDays,
    minSampleSize,
    totalRejected: vetRejected.length,
    totalDemoted: batchDemoted.length,
    clusters,
    generatedAt: new Date(),
  };
}

/**
 * Render the aggregation as a human-readable markdown section (used by the
 * prompt-improvement report and as standalone evidence for the proposer).
 */
export function renderRejectionAggregationMarkdown(report: RejectionAggregationReport): string {
  const lines: string[] = [
    `## Rejection aggregation — trailing ${report.windowDays} days`,
    ``,
    `- Total vet-question rejections: **${report.totalRejected}**`,
    `- Total batch-verify demotions: **${report.totalDemoted}**`,
    `- Minimum sample size for a cluster: **${report.minSampleSize}**`,
    `- Qualifying clusters: **${report.clusters.length}**`,
    ``,
  ];

  if (report.clusters.length === 0) {
    lines.push(`_No clusters met the minimum sample-size floor of ${report.minSampleSize}._`);
  } else {
    lines.push(`### Clusters (sorted by count, desc)`);
    lines.push(``);
    lines.push(`| Category | Subcategory | Kind | Count | Sample reason |`);
    lines.push(`|---|---|---|---|---|`);
    for (const c of report.clusters) {
      const cat = c.broadCategory ?? '—';
      const sub = c.canonicalSubcategory ?? '—';
      const sample = c.sampleReasons[0] ? c.sampleReasons[0].slice(0, 80) : '—';
      lines.push(`| ${cat} | ${sub} | ${c.kind} | ${c.count} | ${sample} |`);
    }
  }

  return lines.join('\n');
}
