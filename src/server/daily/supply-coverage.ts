import {
  getDomainSupplyCoverage,
  type DomainSupplyCoverageRow,
} from '@/server/db/queries/domain-depth-estimate';
import { classifySupplyState, type SupplyState } from '@/server/daily/supply-state';
import { SIZE_CEIL } from '@/server/daily/domain-size-estimate';

/**
 * Shared coverage summary for the supply-state machine's two surfaces
 * (D-SUPPLY-FINITENESS-01 #5): the weekly cost digest email and the
 * /admin/supply dashboard. One classification pass so both surfaces always
 * agree on what is alarming.
 */

export interface SupplyCoverageEntry {
  domainKey: string;
  label: string;
  state: SupplyState;
  realized: number;
  /** EFFECTIVE estimate: the admin override when set, else the corpus estimate. */
  estimatedQuestions: number | null;
  /** Corpus-resolved estimate, kept visible alongside an override. */
  corpusEstimatedQuestions: number | null;
  /** Admin override (0119); non-null means it is what estimatedQuestions shows. */
  manualEstimatedQuestions: number | null;
  /** realized / effective estimate; null when unsized. */
  ratio: number | null;
  confidence: string | null;
  shape: string | null;
  basis: string | null;
  consecutiveDryRounds: number;
  lastYieldAt: Date | null;
  /** Admin generation cap (0121): true = excluded from generation, never alarms. */
  generationCapped: boolean;
  /** Dedicated Fandom wiki host, when the sizer found one — a richness signal
   * (a fandom-backed leaf that ran dry is a generator failure, not a granular topic). */
  fandomHost: string | null;
  /** Worst-case servable bank stock — the backfill's own "already stocked" number.
   * Feeds classification (a stocked domain is never dry) and the dashboards. */
  servable: number;
  /**
   * The corpus estimate hit SIZE_CEIL, i.e. it means "at least this big", not a
   * measured size (Star Trek's 65k wiki articles clamp to 1,200). Surfaces
   * render the estimate as "≥N" and suppress the coverage percentage — a % of a
   * clamp reads as near-zero coverage forever and is meaningless. A manual
   * override is a human-set target, never clamped.
   */
  estimateClamped: boolean;
}

export interface SupplyCoverageSummary {
  entries: SupplyCoverageEntry[];
  /** Dry far short of a HIGH-confidence estimate — the alarm list, worst first. */
  discrepancies: SupplyCoverageEntry[];
  /** Still yielding past the estimate — co-calibration should raise these. */
  raiseEstimates: SupplyCoverageEntry[];
  counts: Record<SupplyState, number>;
  /** How many domains an admin has capped (stopped generating). */
  cappedCount: number;
}

export function summarizeSupplyCoverage(
  rows: DomainSupplyCoverageRow[],
): SupplyCoverageSummary {
  const entries: SupplyCoverageEntry[] = rows.map((row) => {
    // The admin override (0119) wins over the corpus estimate, and an
    // overridden row classifies at 'high' confidence — a human set the anchor,
    // so it MAY fire the discrepancy alarm even if the original resolution
    // was low-confidence.
    const overridden = row.manualEstimatedQuestions != null;
    const effectiveEstimate = row.manualEstimatedQuestions ?? row.estimatedQuestions;
    const effectiveConfidence = overridden ? 'high' : row.confidence;
    const state = classifySupplyState({
      realized: row.realized,
      estimatedQuestions: effectiveEstimate,
      confidence: effectiveConfidence,
      consecutiveDryRounds: row.consecutiveDryRounds,
      servableStock: row.servable,
    });
    return {
      domainKey: row.domainKey,
      label: row.sampleLabel ?? row.domainKey,
      state,
      realized: row.realized,
      estimatedQuestions: effectiveEstimate,
      corpusEstimatedQuestions: row.estimatedQuestions,
      manualEstimatedQuestions: row.manualEstimatedQuestions,
      ratio:
        effectiveEstimate && effectiveEstimate > 0 ? row.realized / effectiveEstimate : null,
      confidence: effectiveConfidence,
      shape: row.shape,
      basis: row.basis,
      consecutiveDryRounds: row.consecutiveDryRounds,
      lastYieldAt: row.lastYieldAt,
      generationCapped: row.generationCappedAt != null,
      fandomHost: row.fandomHost,
      servable: row.servable,
      estimateClamped: !overridden && row.estimatedQuestions != null && row.estimatedQuestions >= SIZE_CEIL,
    };
  });

  const counts: Record<SupplyState, number> = {
    unsized: 0,
    filling: 0,
    raise_estimate: 0,
    soft_finite: 0,
    discrepancy: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;

  const bySeverity = (a: SupplyCoverageEntry, b: SupplyCoverageEntry) =>
    (a.ratio ?? 1) - (b.ratio ?? 1);
  // A capped domain is a deliberate stop — it must never fire the discrepancy
  // alarm (email + dashboard) or invite a co-calibration raise, even if it went
  // dry far short of its estimate. Exclude it from both action lists.
  return {
    entries,
    discrepancies: entries
      .filter((entry) => entry.state === 'discrepancy' && !entry.generationCapped)
      .sort(bySeverity),
    raiseEstimates: entries
      .filter((entry) => entry.state === 'raise_estimate' && !entry.generationCapped)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)),
    counts,
    cappedCount: entries.filter((entry) => entry.generationCapped).length,
  };
}

/** Fetch + classify. Fail-open: callers treat null as "no section this week". */
export async function buildSupplyCoverageSummary(): Promise<SupplyCoverageSummary | null> {
  try {
    return summarizeSupplyCoverage(await getDomainSupplyCoverage());
  } catch (error) {
    console.warn('[supply-coverage] failed to build summary (fail-open)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
