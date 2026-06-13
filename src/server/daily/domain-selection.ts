/**
 * Pure domain-selection helpers (Change 1+2). No DB / LLM imports, so this is
 * directly unit-testable and safe to load anywhere. generate-questions.ts wires
 * these into the per-round palette; the orchestrator owns the intra-day cap.
 */
import { domainKey } from '@/lib/knowledge/domain-key';

// Historic flat weekly cap — still the default for UNTAGGED domains so this
// doesn't silently tighten behavior for players who never set frequency tags.
export const DOMAIN_PER_WEEK_CAP = 5;

// Per-domain frequency knobs (Game settings: often / sometimes / blue_moon /
// resting). 'resting' is filtered out upstream — it never reaches selection.
//
// Base sampling weight: how strongly a domain competes to be in a given day's
// palette. 'often' draws ~2x a 'sometimes' domain, ~4x a 'blue_moon' one. Unset
// is treated as 'sometimes' (the neutral middle).
const DOMAIN_FREQUENCY_WEIGHT: Record<string, number> = {
  often: 4,
  sometimes: 2,
  blue_moon: 1,
};
const DEFAULT_DOMAIN_WEIGHT = DOMAIN_FREQUENCY_WEIGHT.sometimes;

// Frequency-scaled weekly cap: hard backstop on how many questions a single
// domain may yield in the trailing 7 days, so a fact-rich domain can't dominate
// the rotation regardless of sampling luck.
const DOMAIN_WEEKLY_CAP_BY_FREQUENCY: Record<string, number> = {
  often: 7,
  sometimes: 3,
  blue_moon: 1,
};

export function domainFrequencyWeight(frequency: string | undefined): number {
  return (frequency && DOMAIN_FREQUENCY_WEIGHT[frequency]) || DEFAULT_DOMAIN_WEIGHT;
}

export function domainWeeklyCap(frequency: string | undefined): number {
  return (frequency && DOMAIN_WEEKLY_CAP_BY_FREQUENCY[frequency]) || DOMAIN_PER_WEEK_CAP;
}

// Kill switch for the custom-mode weighted daily pick (Change 1+2). Defaults ON;
// set CUSTOM_DOMAIN_WEIGHTING=0 (or false) to fall back to the prior
// order-the-whole-list behavior without a redeploy. Mirrors isEmbeddingEnabled's
// env-only gate.
export function isCustomDomainWeightingEnabled(): boolean {
  const raw = process.env.CUSTOM_DOMAIN_WEIGHTING?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

/**
 * Weighted sample WITHOUT replacement: draw up to `count` distinct items, each
 * item's chance of being drawn proportional to its weight. Non-positive weights
 * are skipped. Deterministic only under a seeded `rng` (tests pass one); defaults
 * to Math.random in production where per-day variety is the goal.
 */
export function weightedSampleWithoutReplacement<T>(
  items: ReadonlyArray<{ item: T; weight: number }>,
  count: number,
  rng: () => number = Math.random,
): T[] {
  const pool = items.filter((entry) => entry.weight > 0).map((entry) => ({ ...entry }));
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = rng() * total;
    let index = 0;
    for (; index < pool.length; index += 1) {
      threshold -= pool[index].weight;
      if (threshold <= 0) break;
    }
    const [chosen] = pool.splice(Math.min(index, pool.length - 1), 1);
    picked.push(chosen.item);
  }
  return picked;
}

/**
 * Custom-mode daily domain palette (Change 1+2). Replaces "order all 30 selected
 * domains and let the LLM pick" — which gravitated to fact-rich domains and
 * ignored the player's frequency tags — with a deterministic, frequency-weighted,
 * recency-aware sample of just the day's domains. Handing generation a SHORT list
 * (≈ the round's count) is what stops the model from over-mining the meaty few.
 *
 * Per domain: drop it if it already hit its frequency-scaled weekly cap, then
 * weight it by `frequencyWeight / (1 + recentCount7d)` so a domain mined hard this
 * week sinks and fresh ones rise (cross-day rotation). If the cap empties the set,
 * fall back to the uncapped list rather than starve the queue.
 */
export function selectCustomDomainsForRound(
  selectedDomains: string[],
  frequencyByDomain: Record<string, string>,
  recentCounts: ReadonlyMap<string, number>,
  count: number,
  rng: () => number = Math.random,
): string[] {
  if (selectedDomains.length === 0) return [];

  const recentFor = (domain: string) => recentCounts.get(domainKey(domain)) ?? 0;
  const underCap = (domain: string) =>
    recentFor(domain) < domainWeeklyCap(frequencyByDomain[domain]);

  // Apply the weekly cap, but never let it empty the palette (starvation guard).
  const eligible = selectedDomains.some(underCap)
    ? selectedDomains.filter(underCap)
    : selectedDomains;

  const weighted = eligible.map((domain) => ({
    item: domain,
    weight: domainFrequencyWeight(frequencyByDomain[domain]) / (1 + recentFor(domain)),
  }));

  return weightedSampleWithoutReplacement(weighted, count, rng);
}
