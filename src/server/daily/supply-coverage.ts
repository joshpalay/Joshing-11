import {
  getDomainSupplyCoverage,
  type DomainSupplyCoverageRow,
} from '@/server/db/queries/domain-depth-estimate';
import { classifySupplyState, type SupplyState } from '@/server/daily/supply-state';

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
  estimatedQuestions: number | null;
  /** realized / estimate; null when unsized. */
  ratio: number | null;
  confidence: string | null;
  shape: string | null;
  basis: string | null;
  consecutiveDryRounds: number;
  lastYieldAt: Date | null;
}

export interface SupplyCoverageSummary {
  entries: SupplyCoverageEntry[];
  /** Dry far short of a HIGH-confidence estimate — the alarm list, worst first. */
  discrepancies: SupplyCoverageEntry[];
  /** Still yielding past the estimate — co-calibration should raise these. */
  raiseEstimates: SupplyCoverageEntry[];
  counts: Record<SupplyState, number>;
}

export function summarizeSupplyCoverage(
  rows: DomainSupplyCoverageRow[],
): SupplyCoverageSummary {
  const entries: SupplyCoverageEntry[] = rows.map((row) => {
    const state = classifySupplyState({
      realized: row.realized,
      estimatedQuestions: row.estimatedQuestions,
      confidence: row.confidence,
      consecutiveDryRounds: row.consecutiveDryRounds,
    });
    return {
      domainKey: row.domainKey,
      label: row.sampleLabel ?? row.domainKey,
      state,
      realized: row.realized,
      estimatedQuestions: row.estimatedQuestions,
      ratio:
        row.estimatedQuestions && row.estimatedQuestions > 0
          ? row.realized / row.estimatedQuestions
          : null,
      confidence: row.confidence,
      shape: row.shape,
      basis: row.basis,
      consecutiveDryRounds: row.consecutiveDryRounds,
      lastYieldAt: row.lastYieldAt,
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
  return {
    entries,
    discrepancies: entries.filter((entry) => entry.state === 'discrepancy').sort(bySeverity),
    raiseEstimates: entries
      .filter((entry) => entry.state === 'raise_estimate')
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)),
    counts,
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
