import { and, countDistinct, desc, eq, gte, inArray, isNotNull, isNull, max, ne, sql } from 'drizzle-orm';

import { db, generatedQuestions, masteryEvents, questions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { labelSimilarity } from '@/lib/knowledge/label-similarity';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';
import { getConvergeTrgmThreshold } from '@/server/knowledge/converge-domain';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';

// B-CRAFTER-LIFECYCLE-01 Phase 2 — Panel B's "where your craft is wanted"
// worklist: domains ranked by player demand × content shallowness. HYBRID by
// decision (2026-07-01): machine-pool depth reuses the same distinct-factKey
// metric as the supply/guard sides (getDurablePoolDepthForDomains), and the
// demand layer is real play — distinct players with graded answers in the
// domain over the lookback window (MASTERY_EVENTS, the per-answer event log).
// Human-authored depth is counted separately from machine depth because they
// answer different questions for a crafter ("is anyone home" vs "has a human
// been here"). Framing is INVITATION, not obligation: rows also carry whether
// the domain is among the crafter's own declared loves.
//
// Heat is CLUSTER-aware (B-CATEGORY-BANK-RECONCILE-01 companion): a domain's
// depth includes lexical sibling labels (buildLabelClusters) so a territory
// fragmented by spelling/word-order variants doesn't falsely read "wanted &
// thin". The row keeps its own-label depth AND the cluster totals so the UI
// can show both.

export type CrafterWorklistHeat = 'high' | 'mid' | 'low' | 'covered';

export type ClusterLabel = {
  label: string;
  machineDepth: number;
  humanAuthored: number;
};

export type CrafterWorklistRow = {
  domain: string; // canonicalSubcategory
  activePlayers: number;
  lastActivity: Date | null;
  machineDepth: number; // distinct fact keys in the durable machine pool
  humanAuthored: number; // live human-authored canonical questions
  declaredByCrafter: boolean; // overlaps the crafter's declared loves
  /**
   * Corpus labels that are LEXICAL siblings of this domain (domainKey-equal or
   * trigram-similar spelling/word-order variants — see label-similarity.ts).
   * Their depth counts toward heat so a fragmented territory stops reading
   * "wanted & thin" when its questions merely live under a variant label.
   */
  clusterLabels: ClusterLabel[];
  clusterMachineDepth: number; // own + clusterLabels
  clusterHumanAuthored: number; // own + clusterLabels
  heat: CrafterWorklistHeat;
};

// Thresholds are deliberately small-scale (18-user era) and transparent — tune
// by eye, not by dashboard. totalDepth = machine + human.
const THIN_TOTAL_DEPTH = 15; // below this, an active domain is "wanted & thin"
const COVERED_TOTAL_DEPTH = 40; // at/above this a domain reads as covered
const COVERED_HUMAN_DEPTH = 12; // enough human-authored depth is coverage on its own

const HEAT_RANK: Record<CrafterWorklistHeat, number> = { high: 0, mid: 1, low: 2, covered: 3 };

function heatFor(activePlayers: number, machineDepth: number, humanAuthored: number): CrafterWorklistHeat {
  const totalDepth = machineDepth + humanAuthored;
  if (totalDepth >= COVERED_TOTAL_DEPTH || humanAuthored >= COVERED_HUMAN_DEPTH) return 'covered';
  if (activePlayers >= 2 && totalDepth < THIN_TOTAL_DEPTH) return 'high';
  if (activePlayers >= 2) return 'mid';
  return 'low';
}

// Every corpus label with its depth, both halves of the worklist's own metric:
// machine = distinct durable fact keys (same as getDurablePoolDepthForDomains),
// human = live creator-authored canonical questions. One scan each — the corpus
// is ~250 labels at current scale, so clustering happens in memory.
// Exported for the knowledge-structure suggester (propose-structure.ts), which
// drafts taxonomy groups over the same corpus this worklist reads.
export async function getCorpusLabelDepths(): Promise<ClusterLabel[]> {
  const [machineRows, humanRows] = await Promise.all([
    db
      .select({
        label: generatedQuestions.canonicalSubcategory,
        depth: sql<number>`count(distinct ${generatedQuestions.factKey})`,
      })
      .from(generatedQuestions)
      .where(and(eq(generatedQuestions.isDuplicate, false), isNotNull(generatedQuestions.factKey)))
      .groupBy(generatedQuestions.canonicalSubcategory),
    db
      .select({
        label: questions.canonicalSubcategory,
        depth: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(
        and(
          isNotNull(questions.creatorId),
          isNull(questions.deletedAt),
          // Hard-blocked (upheld-inappropriate / safety vet) questions aren't
          // servable coverage — they must not pad a domain's human depth.
          ne(questions.visibility, 'blocked'),
        ),
      )
      .groupBy(questions.canonicalSubcategory),
  ]);

  const byLabel = new Map<string, ClusterLabel>();
  for (const row of machineRows) {
    const label = row.label?.trim();
    if (!label) continue;
    byLabel.set(label, { label, machineDepth: Number(row.depth), humanAuthored: 0 });
  }
  for (const row of humanRows) {
    const label = row.label?.trim();
    if (!label) continue;
    const existing = byLabel.get(label);
    if (existing) existing.humanAuthored = Number(row.depth);
    else byLabel.set(label, { label, machineDepth: 0, humanAuthored: Number(row.depth) });
  }
  return [...byLabel.values()];
}

/**
 * For each worklist domain, the corpus labels that are lexical siblings —
 * domainKey-equal (typographic variants) or trigram-similar at the converge
 * threshold (word-order/connector variants like the "Renaissance & Medieval
 * Polyphony" trio). Pure; exported for unit tests. Semantic-only siblings
 * (disjoint vocabulary) intentionally do NOT cluster here — that roll-up is
 * the near-ness tree's job and waits on D-SUPPLY-FINITE-SET-01.
 */
export function buildLabelClusters(
  domains: readonly string[],
  corpus: readonly ClusterLabel[],
  threshold: number,
): Map<string, ClusterLabel[]> {
  const clusters = new Map<string, ClusterLabel[]>();
  for (const domain of domains) {
    const key = domainKey(domain);
    clusters.set(
      domain,
      corpus.filter(
        (c) =>
          c.label !== domain &&
          !isGenericSubcategory(c.label) &&
          (domainKey(c.label) === key || labelSimilarity(domain, c.label) >= threshold),
      ),
    );
  }
  return clusters;
}

export async function getCrafterWorklist(
  crafterUserId: string,
  opts: { activeLookbackDays?: number; limit?: number } = {},
): Promise<CrafterWorklistRow[]> {
  const lookbackDays = opts.activeLookbackDays ?? 14;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Demand layer: who actually played here recently. answeredByUserId is the
  // person who answered (userId is the territory-holder credited) — demand
  // means answerers, so authored/credit-only events (null answerer) don't count.
  const activityRaw = await db
    .select({
      domain: masteryEvents.canonicalSubcategory,
      activePlayers: countDistinct(masteryEvents.answeredByUserId),
      lastActivity: max(masteryEvents.createdAt),
    })
    .from(masteryEvents)
    .where(and(gte(masteryEvents.createdAt, since), isNotNull(masteryEvents.answeredByUserId)))
    .groupBy(masteryEvents.canonicalSubcategory);

  const activity = activityRaw.filter((row) => !isGenericSubcategory(row.domain));
  const domains = activity.map((row) => row.domain);
  if (domains.length === 0) return [];

  const [machineDepthByDomain, authoredRows, declared, corpusLabels] = await Promise.all([
    getDurablePoolDepthForDomains(domains),
    db
      .select({
        domain: questions.canonicalSubcategory,
        humanAuthored: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(
        and(
          inArray(questions.canonicalSubcategory, domains),
          isNotNull(questions.creatorId),
          isNull(questions.deletedAt),
          // Blocked questions aren't servable coverage (see getCorpusLabelDepths).
          ne(questions.visibility, 'blocked'),
        ),
      )
      .groupBy(questions.canonicalSubcategory),
    getActiveDeclaredInterests(crafterUserId),
    // Best-effort: a corpus scan fault costs the cluster columns, not the page.
    getCorpusLabelDepths().catch((err) => {
      console.warn('[crafter-worklist] corpus label scan failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as ClusterLabel[];
    }),
  ]);

  const clusters = buildLabelClusters(domains, corpusLabels, getConvergeTrgmThreshold());

  const authoredByDomain = new Map<string, number>();
  for (const row of authoredRows) {
    if (row.domain) authoredByDomain.set(row.domain, row.humanAuthored);
  }
  const declaredSet = new Set(declared.map((d) => d.domain.trim().toLowerCase()));

  const rows: CrafterWorklistRow[] = activity.map((row) => {
    const machineDepth = machineDepthByDomain.get(row.domain) ?? 0;
    const humanAuthored = authoredByDomain.get(row.domain) ?? 0;
    const clusterLabels = clusters.get(row.domain) ?? [];
    // Heat reads the CLUSTER totals: a territory whose questions live under
    // lexical variant labels is not "wanted & thin", it's mislabeled — and the
    // row surfaces those variants so the crafter sees why.
    const clusterMachineDepth =
      machineDepth + clusterLabels.reduce((sum, c) => sum + c.machineDepth, 0);
    const clusterHumanAuthored =
      humanAuthored + clusterLabels.reduce((sum, c) => sum + c.humanAuthored, 0);
    return {
      domain: row.domain,
      activePlayers: row.activePlayers,
      lastActivity: row.lastActivity,
      machineDepth,
      humanAuthored,
      declaredByCrafter: declaredSet.has(row.domain.trim().toLowerCase()),
      clusterLabels,
      clusterMachineDepth,
      clusterHumanAuthored,
      heat: heatFor(row.activePlayers, clusterMachineDepth, clusterHumanAuthored),
    };
  });

  rows.sort((a, b) => {
    const heat = HEAT_RANK[a.heat] - HEAT_RANK[b.heat];
    if (heat !== 0) return heat;
    if (a.activePlayers !== b.activePlayers) return b.activePlayers - a.activePlayers;
    return a.clusterMachineDepth + a.clusterHumanAuthored - (b.clusterMachineDepth + b.clusterHumanAuthored);
  });

  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

// Human-authored question texts in a domain, in the { domain, text } avoid-entry
// shape buildUserPrompt takes. The draft path passes these alongside the machine
// pool's avoid lists — authored canonical questions carry no fact_key, so text
// is the only channel that keeps drafts from re-asking what a human already
// asked (same gap the +2 bonus path patched, see daily.ts isBankRowServable).
export async function getAuthoredQuestionEntriesForDomain(
  domain: string,
  limit: number,
): Promise<Array<{ domain: string; text: string }>> {
  const rows = await db
    .select({ text: questions.questionText })
    .from(questions)
    .where(
      and(
        eq(questions.canonicalSubcategory, domain),
        isNotNull(questions.creatorId),
        isNull(questions.deletedAt),
      ),
    )
    .orderBy(desc(questions.createdAt))
    .limit(limit);

  return rows.map((row) => ({ domain, text: row.text }));
}
