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
// resting).
//
// Base sampling weight: how strongly a domain competes to be in a given day's
// palette. 'often' draws ~2x a 'sometimes' domain, ~4x a 'blue_moon' one. Unset
// is treated as 'sometimes' (the neutral middle). 'resting' is weight 0, NOT the
// default: the setup save keeps rested domains out of selectedDomains, but the
// single-domain frequency endpoint didn't always sync the list, and prod rows
// written through it carried rested strays that competed at 'sometimes' weight
// (observed 2026-07-12: two rested domains took ~6 core slots in a week).
const DOMAIN_FREQUENCY_WEIGHT: Record<string, number> = {
  often: 4,
  sometimes: 2,
  blue_moon: 1,
  resting: 0,
};
const DEFAULT_DOMAIN_WEIGHT = DOMAIN_FREQUENCY_WEIGHT.sometimes;

// Frequency-scaled weekly cap: hard backstop on how many questions a single
// domain may yield in the trailing 7 days, so a fact-rich domain can't dominate
// the rotation regardless of sampling luck. 'resting' is 0 for the same
// stray-row reason as its 0 sampling weight above.
const DOMAIN_WEEKLY_CAP_BY_FREQUENCY: Record<string, number> = {
  often: 7,
  sometimes: 3,
  blue_moon: 1,
  resting: 0,
};

export function domainFrequencyWeight(frequency: string | undefined): number {
  // Explicit `in` check so the legitimate 0 for 'resting' isn't swallowed by a
  // truthiness fallback to the default weight.
  if (frequency !== undefined && frequency in DOMAIN_FREQUENCY_WEIGHT) {
    return DOMAIN_FREQUENCY_WEIGHT[frequency];
  }
  return DEFAULT_DOMAIN_WEIGHT;
}

/**
 * Drop admin-capped domains (0121) from a round palette. `cappedKeys` holds
 * folded domain_keys (getCappedDomainKeys); domains are matched by domainKey()
 * so a spelling variant of a capped label is caught too. Unlike the weekly-cap
 * starvation guards there is deliberately NO fallback — a capped domain must
 * yield nothing (serving from the existing bank is untouched). Pure so it's
 * unit-testable and applied identically at every generation chokepoint.
 */
export function dropCappedDomains(
  domains: string[],
  cappedKeys: ReadonlySet<string>,
): string[] {
  if (cappedKeys.size === 0) return domains;
  return domains.filter((domain) => !cappedKeys.has(domainKey(domain)));
}

export function domainWeeklyCap(frequency: string | undefined): number {
  // Same explicit `in` check as domainFrequencyWeight: 'resting' maps to a real 0.
  if (frequency !== undefined && frequency in DOMAIN_WEEKLY_CAP_BY_FREQUENCY) {
    return DOMAIN_WEEKLY_CAP_BY_FREQUENCY[frequency];
  }
  return DOMAIN_PER_WEEK_CAP;
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
 * Per domain: drop it if it's rested or already hit its frequency-scaled weekly
 * cap, then weight it by `w² / (w + recentCount7d)` where w is the frequency
 * weight — recency damping scaled to the tier. The old flat `w / (1 + recent)`
 * cancelled the 'often' boost after a couple of serves: an often domain with 3
 * recent questions (4/4 = 1.0) ranked BELOW a fresh 'sometimes' domain (2.0),
 * so the 4:2:1 tags only held while everything was equally fresh. Dividing the
 * recency count by the tier's own weight (w²/(w+r) = w/(1+r/w)) makes each tier
 * absorb serves in proportion to its target share: often with 3 recent is
 * 16/7 ≈ 2.3, still ahead of fresh sometimes at 2.0. Fresh domains keep the
 * exact 4:2:1 ratio, and within a tier the least-mined domain still ranks first.
 * If the cap empties the set, fall back to the uncapped list rather than starve
 * the queue.
 */
export function selectCustomDomainsForRound(
  selectedDomains: string[],
  frequencyByDomain: Record<string, string>,
  recentCounts: ReadonlyMap<string, number>,
  count: number,
  rng: () => number = Math.random,
): string[] {
  // 'resting' means "won't be asked" — drop rested domains outright, with NO
  // starvation fallback (unlike the weekly cap below): serving a rested domain
  // is a preference violation, not a supply problem. Normally redundant — the
  // setup save and the domain-frequency endpoint both keep rested domains out
  // of selectedDomains — but rows written before the endpoint synced the list
  // still carry strays. An empty result here falls through to the caller's
  // own palette fallback.
  const active = selectedDomains.filter(
    (domain) => frequencyByDomain[domain] !== 'resting',
  );
  if (active.length === 0) return [];

  const recentFor = (domain: string) => recentCounts.get(domainKey(domain)) ?? 0;
  const underCap = (domain: string) =>
    recentFor(domain) < domainWeeklyCap(frequencyByDomain[domain]);

  // Apply the weekly cap, but never let it empty the palette (starvation guard).
  const eligible = active.some(underCap) ? active.filter(underCap) : active;

  const weighted = eligible.map((domain) => {
    const weight = domainFrequencyWeight(frequencyByDomain[domain]);
    return {
      item: domain,
      weight: (weight * weight) / (weight + recentFor(domain)),
    };
  });

  return weightedSampleWithoutReplacement(weighted, count, rng);
}
