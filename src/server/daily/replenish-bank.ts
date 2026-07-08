import { countServeableOwnBankStock, getKnowledgeBase } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { generateDailyQuestionsFromKnowledgeBase } from '@/server/daily/generate-questions';
import { DAILY_QUEUE_MAX_PER_SUBCATEGORY, DAILY_QUEUE_SIZE } from '@/server/daily/types';

/**
 * Demand-pull bank replenish (D-SUPPLY-DEMAND-PULL-01) — the BACKBONE of the
 * supply redesign: the unit of supply is the QUEUE, not the category.
 *
 * When a player finishes their Daily Five, that consumption IS the demand
 * signal. This module runs OFF the answer path (via next/server `after()`) and
 * restocks the viewer's own durable bank (GeneratedQuestion, used_in_queue =
 * false) back up to the stock target, so TOMORROW's cron pre-build assembles
 * from ready stock (own-stock bank reuse, B-DAILY-BANK-OWN-01) instead of
 * generating live under the build's time budget — the measured cause of short
 * and slow fives.
 *
 * Deliberately composes with what already exists rather than forking it:
 *  - generation: the same gated generateDailyQuestionsFromKnowledgeBase the
 *    build uses (its rows persist to the bank with used_in_queue=false, and its
 *    custom-mode palette already leads with least-recently-generated domains);
 *  - assembly: untouched — the orchestrator + pickBankSource pick up the stock;
 *  - dedup: stock counting excludes facts the viewer already answered (the
 *    getRecentFactKeys bridge), so replenish never counts a dead row as supply.
 *
 * Fail-open everywhere: replenish is a background optimization — any error is
 * logged and swallowed, and the next morning's build simply behaves as today.
 * Flag-gated OFF (DAILY_REPLENISH_ENABLED) until measured.
 */

export function isDailyReplenishEnabled(): boolean {
  const raw = process.env.DAILY_REPLENISH_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * Stock target: how many serveable own-bank rows a player should hold after a
 * replenish. Default = a full Five plus the two bonus slots. Env-tunable
 * (DAILY_REPLENISH_STOCK_TARGET) so raising the buffer is a config change.
 */
export function replenishStockTarget(): number {
  const raw = Number(process.env.DAILY_REPLENISH_STOCK_TARGET);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DAILY_QUEUE_SIZE + 2;
}

// Ask for more than the deficit so the generator's gate drop-rate (~half) still
// lands the target; capped like the orchestrator's overRequest so one replenish
// never runs away. The generator persists every gate-passing row it makes, so
// "excess" survivors are simply MORE stock — nothing is wasted.
const REPLENISH_OVERPROVISION = 2;
const replenishRequest = (deficit: number): number =>
  Math.min(deficit * REPLENISH_OVERPROVISION, DAILY_QUEUE_SIZE * 2);

export interface ReplenishReport {
  ran: boolean;
  reason?: 'disabled' | 'no-palette' | 'stocked' | 'error';
  stock?: number;
  target?: number;
  deficit?: number;
  generated?: number;
  /** Per-domain stock BEFORE replenish — the least-stocked view (feeds the finiteness loop). */
  stockByDomain?: Record<string, number>;
}

/**
 * Restock the viewer's own bank up to the stock target. Runs after a completed
 * round, off the response path. Returns a report for logging/tests; never throws.
 */
export async function replenishBankAfterPlay(userId: string): Promise<ReplenishReport> {
  if (!isDailyReplenishEnabled()) return { ran: false, reason: 'disabled' };

  try {
    // Palette = the viewer's current selected domains (custom mode) or their
    // full knowledge base (random mode) — stock in dropped domains is not supply.
    const [preferences, knowledgeBase] = await Promise.all([
      getDailyPreferences(userId),
      getKnowledgeBase(userId),
    ]);
    const palette =
      preferences.domainMode === 'custom' && preferences.selectedDomains.length > 0
        ? preferences.selectedDomains
        : knowledgeBase.map((entry) => entry.domain);
    if (palette.length === 0) return { ran: false, reason: 'no-palette' };

    const stockByDomain = await countServeableOwnBankStock(userId, palette);
    // DIVERSITY-AWARE effective stock: the build's intra-day cap only admits
    // ~DAILY_QUEUE_MAX_PER_SUBCATEGORY rows per domain into one queue, so eight
    // Shakespeare rows are two serveable slots, not eight. Cap each domain's
    // contribution so a stock pile concentrated in one deep domain can't mask a
    // genuine shortfall (the measured Josh case: 17 raw rows, 8 in one domain).
    const stock = [...stockByDomain.values()].reduce(
      (sum, n) => sum + Math.min(n, DAILY_QUEUE_MAX_PER_SUBCATEGORY),
      0,
    );
    const target = replenishStockTarget();
    const deficit = target - stock;
    if (deficit <= 0) {
      console.info('[daily/replenish] stock at target; nothing to do', {
        userId,
        stock,
        target,
      });
      return { ran: false, reason: 'stocked', stock, target };
    }

    // The generator handles domain steering (least-recently-generated first /
    // weighted sampling), runs every quality/factual/dedup gate, and persists
    // survivors to the bank (used_in_queue=false). We intentionally do NOT
    // place anything in a queue here — tomorrow's build does the assembling.
    const generated = await generateDailyQuestionsFromKnowledgeBase(
      userId,
      replenishRequest(deficit),
      { firstRun: false },
    );

    console.info('[daily/replenish] restocked bank after play', {
      userId,
      stock,
      target,
      deficit,
      requested: replenishRequest(deficit),
      generated: generated.length,
      stockByDomain: Object.fromEntries(stockByDomain),
    });
    return {
      ran: true,
      stock,
      target,
      deficit,
      generated: generated.length,
      stockByDomain: Object.fromEntries(stockByDomain),
    };
  } catch (error) {
    // Background optimization — never let it surface. Tomorrow's build falls
    // back to today's live-generation behavior.
    console.warn('[daily/replenish] failed (fail-open)', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ran: false, reason: 'error' };
  }
}
