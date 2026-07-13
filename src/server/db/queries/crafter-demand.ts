import { and, countDistinct, desc, eq, gte, inArray, isNotNull, isNull, max, ne, sql } from 'drizzle-orm';

import { db, generatedQuestions, masteryEvents, questions, retrievalDomainHealth } from '@/server/db';
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
  /**
   * Machine futility — how badly the MACHINE does here (Josh, 2026-07-03:
   * "shouldn't it be the ones that are most difficult to generate? The ones
   * that are most costly"). A thin domain the machine generates well will
   * self-heal on refill; a thin domain where its questions keep getting
   * demoted (or generation keeps timing out) only a human can deepen.
   */
  machineVerified: number; // machine questions the verifier has judged
  machineDemoted: number; // …of those, pulled as wrong
  demotionRate: number | null; // demoted/verified; null below the sample floor
  generationStruggling: boolean; // refill has been timing out here (health row)
  /**
   * D-SUPPLY-FINITE-SET-01 curation routing: TRUE when this subject has crossed
   * the "too expensive for the machine" line (futility ≥ threshold) — it should
   * be human-curated, not left to auto-fill. Drives the crafter dashboard badge
   * and the weekly "subjects that got expensive" notification. `expensiveReason`
   * is a short human string ('64% demoted' / 'generation timing out').
   */
  expensiveToMachine: boolean;
  expensiveReason: string | null;
};

// Thresholds are deliberately small-scale (18-user era) and transparent — tune
// by eye, not by dashboard. totalDepth = machine + human.
const THIN_TOTAL_DEPTH = 15; // below this, an active domain is "wanted & thin"
const COVERED_TOTAL_DEPTH = 40; // at/above this a domain reads as covered
const COVERED_HUMAN_DEPTH = 12; // enough human-authored depth is coverage on its own

const HEAT_RANK: Record<CrafterWorklistHeat, number> = { high: 0, mid: 1, low: 2, covered: 3 };

// Futility needs a minimum verified sample — 1 demoted of 1 verified is noise,
// not a 100% failure rate.
const FUTILITY_MIN_VERIFIED = 4;
// A health row at/above this many consecutive refill timeouts reads as "the
// machine can't even generate here" (mirrors the refill cooldown's own signal).
const STRUGGLING_TIMEOUTS = 2;

/**
 * Sort key for machine futility, pure and exported for tests: demotion rate
 * (when the sample supports one) plus a flat bump when generation itself is
 * timing out. Higher = the machine is worse here = a human matters more.
 */
export function futilityScore(row: {
  demotionRate: number | null;
  generationStruggling: boolean;
}): number {
  return (row.demotionRate ?? 0) + (row.generationStruggling ? 0.5 : 0);
}

// The "too expensive for the machine → curate it" line (D-SUPPLY-FINITE-SET-01
// cost-routed curation). Crossed by EITHER a high demotion rate (a third+ of the
// machine's verified questions here are wrong — re-generating just re-mints
// junk) OR generation timing out at all (the 0.5 struggling bump alone clears
// it — the machine can't even produce here). Small-scale, tune by eye.
export const CURATION_FUTILITY_THRESHOLD = 0.34;

/**
 * Whether a subject has crossed the curation line, with a short human reason.
 * Pure and exported for tests + the weekly notification. Only speaks when there
 * is a real signal: a demotion rate needs the sample floor (FUTILITY_MIN_VERIFIED),
 * so a domain flagged solely on `generationStruggling` reads as a timeout, not a
 * fabricated failure rate.
 */
export function curationVerdict(row: {
  demotionRate: number | null;
  generationStruggling: boolean;
}): { expensive: boolean; reason: string | null } {
  if (futilityScore(row) < CURATION_FUTILITY_THRESHOLD) return { expensive: false, reason: null };
  const parts: string[] = [];
  if (row.demotionRate != null && row.demotionRate >= CURATION_FUTILITY_THRESHOLD) {
    parts.push(`${Math.round(row.demotionRate * 100)}% demoted`);
  }
  if (row.generationStruggling) parts.push('generation timing out');
  return { expensive: true, reason: parts.join('; ') || 'costly to generate' };
}

export type ExpensiveDomain = {
  domain: string;
  reason: string;
  demotionRate: number | null;
  generationStruggling: boolean;
};

/**
 * GLOBAL curation-worthiness scan (D-SUPPLY-FINITE-SET-01) — every subject that
 * has crossed the "too expensive for the machine" line, corpus-wide (not scoped
 * to one crafter's active domains like getCrafterWorklist). Powers the weekly
 * "subjects that got expensive" notification in the LLM cost report. Read-only,
 * pure threshold over the same two signals the worklist uses:
 *   - per-domain machine demotion rate (needs the FUTILITY_MIN_VERIFIED sample),
 *   - refill generation timing out (RetrievalDomainHealth).
 * Sorted by futility, worst first.
 */
export async function getExpensiveDomains(): Promise<ExpensiveDomain[]> {
  const [verdictRows, healthRows] = await Promise.all([
    db
      .select({
        domain: generatedQuestions.canonicalSubcategory,
        verified: sql<number>`count(*)::int`,
        demoted: sql<number>`count(*) filter (where ${generatedQuestions.verificationVerdict} = 'demoted')::int`,
      })
      .from(generatedQuestions)
      // Substantive verdicts only. Self-containment ("names-the-source") demotions
      // are EXCLUDED from both numerator and denominator: they're a uniform
      // formatting rule, not subject difficulty — already prevented at generation
      // (Rule 2b) and one-click salvageable (prepend the title), so counting them
      // as machine futility falsely routes fine domains (Breaking Bad, Avatar, …)
      // to "curate by hand". A one-time healing sweep dumping same-day demotions
      // must not masquerade as "the machine struggles here". Excluding from the
      // denominator too keeps a domain's REAL error rate undiluted (4 factual
      // misses among 4 substantive verdicts reads 100%, not 33% padded by 8
      // formatting demotions).
      .where(
        and(
          isNotNull(generatedQuestions.verificationVerdict),
          sql`(${generatedQuestions.verificationReason} is null or ${generatedQuestions.verificationReason} not ilike 'self-containment%')`,
        ),
      )
      .groupBy(generatedQuestions.canonicalSubcategory),
    db
      .select({
        domain: retrievalDomainHealth.domain,
        consecutiveTimeouts: retrievalDomainHealth.consecutiveTimeouts,
      })
      .from(retrievalDomainHealth)
      .where(gte(retrievalDomainHealth.consecutiveTimeouts, STRUGGLING_TIMEOUTS)),
  ]);

  const struggling = new Set(healthRows.map((r) => r.domain).filter(Boolean) as string[]);
  const out: ExpensiveDomain[] = [];
  const seen = new Set<string>();

  for (const r of verdictRows) {
    if (!r.domain) continue;
    const verified = Number(r.verified);
    const demoted = Number(r.demoted);
    const demotionRate = verified >= FUTILITY_MIN_VERIFIED ? demoted / verified : null;
    const generationStruggling = struggling.has(r.domain);
    const v = curationVerdict({ demotionRate, generationStruggling });
    if (v.expensive) {
      out.push({ domain: r.domain, reason: v.reason ?? 'costly to generate', demotionRate, generationStruggling });
      seen.add(r.domain);
    }
  }
  // Domains that time out so hard they have no verdict rows at all (the machine
  // can't even produce here) — the clearest curate case; include them too.
  for (const domain of struggling) {
    if (seen.has(domain)) continue;
    const v = curationVerdict({ demotionRate: null, generationStruggling: true });
    out.push({ domain, reason: v.reason ?? 'generation timing out', demotionRate: null, generationStruggling: true });
  }

  return out.sort(
    (a, b) =>
      futilityScore({ demotionRate: b.demotionRate, generationStruggling: b.generationStruggling }) -
      futilityScore({ demotionRate: a.demotionRate, generationStruggling: a.generationStruggling }),
  );
}

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

// Difficulty-weighted POINTS a domain's current questions can award — the
// "reachable points" a curator eyeballs against a node's mastery threshold (is
// this area even earnable yet?). First-correct points by tier (accessible 10 /
// moderate 50 / specialist 100; unknown tier → moderate). The MACHINE side is
// deduped by fact_key (a player answers each fact once), matching the distinct-
// factKey depth metric; the HUMAN side is every servable authored question.
// Keyed by raw label — the caller folds/rolls up through the tree, same as depth.
export async function getCorpusLabelPoints(): Promise<Array<{ label: string; points: number }>> {
  const tierPts = sql`CASE "difficulty_estimate" WHEN 'specialist' THEN 100 WHEN 'moderate' THEN 50 WHEN 'accessible' THEN 10 ELSE 50 END`;
  const [machine, human] = await Promise.all([
    db.execute(sql`
      SELECT canonical_subcategory AS label, SUM(pts)::int AS points FROM (
        SELECT DISTINCT ON (fact_key) canonical_subcategory, (${tierPts}) AS pts
        FROM "GeneratedQuestion"
        WHERE is_duplicate = false AND fact_key IS NOT NULL AND canonical_subcategory IS NOT NULL
        ORDER BY fact_key
      ) t
      GROUP BY canonical_subcategory
    `),
    db.execute(sql`
      SELECT canonical_subcategory AS label, SUM(${tierPts})::int AS points
      FROM "Question"
      WHERE creator_id IS NOT NULL AND deleted_at IS NULL AND visibility <> 'blocked'
        AND canonical_subcategory IS NOT NULL
      GROUP BY canonical_subcategory
    `),
  ]);

  const byLabel = new Map<string, number>();
  for (const r of [...machine.rows, ...human.rows] as Array<{ label: string; points: number | string }>) {
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + Number(r.points ?? 0));
  }
  return [...byLabel.entries()].map(([label, points]) => ({ label, points }));
}

// Generation EXHAUSTION per domain: how many questions the generator has produced
// (total) and how many came back DUPLICATES. A high duplicate share means the
// generator keeps repeating itself — the topic's fresh facts are drying up, so
// NEW questions are hard to find (the opposite of a domain where they come
// easily). Raw counts, keyed by raw label — the caller folds/rolls up and derives
// the rate, so a parent reflects its whole subtree.
export async function getCorpusLabelGenStats(): Promise<
  Array<{ label: string; total: number; dupes: number }>
> {
  const rows = await db
    .select({
      label: generatedQuestions.canonicalSubcategory,
      total: sql<number>`count(*)::int`,
      dupes: sql<number>`count(*) filter (where ${generatedQuestions.isDuplicate})::int`,
    })
    .from(generatedQuestions)
    .where(isNotNull(generatedQuestions.canonicalSubcategory))
    .groupBy(generatedQuestions.canonicalSubcategory);

  const out: Array<{ label: string; total: number; dupes: number }> = [];
  for (const r of rows) {
    const label = r.label?.trim();
    if (!label) continue;
    out.push({ label, total: Number(r.total), dupes: Number(r.dupes) });
  }
  return out;
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

  const [machineDepthByDomain, authoredRows, declared, corpusLabels, verdictRows, healthRows] =
    await Promise.all([
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
    // Futility, quality half: per-domain verifier outcomes on machine questions.
    db
      .select({
        domain: generatedQuestions.canonicalSubcategory,
        verified: sql<number>`count(*)::int`,
        demoted: sql<number>`count(*) filter (where ${generatedQuestions.verificationVerdict} = 'demoted')::int`,
      })
      .from(generatedQuestions)
      .where(
        and(
          inArray(generatedQuestions.canonicalSubcategory, domains),
          isNotNull(generatedQuestions.verificationVerdict),
        ),
      )
      .groupBy(generatedQuestions.canonicalSubcategory),
    // Futility, generation half: domains where refill keeps timing out.
    db
      .select({
        domain: retrievalDomainHealth.domain,
        consecutiveTimeouts: retrievalDomainHealth.consecutiveTimeouts,
      })
      .from(retrievalDomainHealth)
      .where(inArray(retrievalDomainHealth.domain, domains)),
  ]);

  const clusters = buildLabelClusters(domains, corpusLabels, getConvergeTrgmThreshold());

  const authoredByDomain = new Map<string, number>();
  for (const row of authoredRows) {
    if (row.domain) authoredByDomain.set(row.domain, row.humanAuthored);
  }
  const declaredSet = new Set(declared.map((d) => d.domain.trim().toLowerCase()));
  const verdictsByDomain = new Map(
    verdictRows.filter((r) => r.domain).map((r) => [r.domain!, r]),
  );
  const strugglingDomains = new Set(
    healthRows
      .filter((r) => r.consecutiveTimeouts >= STRUGGLING_TIMEOUTS)
      .map((r) => r.domain),
  );

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
    const verdicts = verdictsByDomain.get(row.domain);
    const machineVerified = verdicts ? Number(verdicts.verified) : 0;
    const machineDemoted = verdicts ? Number(verdicts.demoted) : 0;
    const demotionRate =
      machineVerified >= FUTILITY_MIN_VERIFIED ? machineDemoted / machineVerified : null;
    const generationStruggling = strugglingDomains.has(row.domain);
    const verdict = curationVerdict({ demotionRate, generationStruggling });
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
      machineVerified,
      machineDemoted,
      demotionRate,
      generationStruggling,
      expensiveToMachine: verdict.expensive,
      expensiveReason: verdict.reason,
    };
  });

  // Demand stays the GATE (heat first — no point authoring where nobody
  // plays); within a heat band the MACHINE-FUTILE domains rank first, because
  // a thin domain the machine handles fine self-heals on refill, while one it
  // keeps fumbling only a human can deepen. Depth is the final tiebreak.
  rows.sort((a, b) => {
    const heat = HEAT_RANK[a.heat] - HEAT_RANK[b.heat];
    if (heat !== 0) return heat;
    const futility = futilityScore(b) - futilityScore(a);
    if (futility !== 0) return futility;
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
