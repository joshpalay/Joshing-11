/**
 * B-CATEGORY-BANK-RECONCILE-01 — reconcile a generated question's proposed
 * domain label against labels the question corpus ALREADY uses, so a pool/daily
 * batch stops minting sibling spelling variants of an existing territory
 * ("Renaissance Polyphony & Imitation" alongside "Renaissance & Medieval
 * Polyphony"). Every depth consumer — getDurablePoolDepthForDomains, the
 * kb-exhaustion "thin" guard, crafter heat — GROUPs BY the exact
 * canonical_subcategory string, so each stray variant starts a depth-0
 * territory and makes a well-covered topic read as shallow.
 *
 * Before this module the generated persist path reconciled ONLY against the
 * player's own knowledge base (reconcileProposedDomain with no extras); the
 * bank's existing labels were invisible to it. Here we compose the existing
 * primitives, mirroring reconcile-authored-domain.ts:
 *
 *   1. reconcileProposedDomain's deterministic domainKey short-circuit, now fed
 *      EVERY existing corpus label (generated + authored, depth ≥ 1 — a
 *      1-question fragment is exactly what we must not re-mint) via
 *      additionalDomains. Free, no LLM.
 *   2. Its Haiku semantic pass over the same candidates, which folds the
 *      word-order/phrasing variants the key fold can't. The prompt's
 *      granularity rule is unchanged: same-scope phrasing folds, narrow never
 *      folds into broad — containment roll-up (Medici → Renaissance Florence)
 *      is D-SUPPLY-FINITE-SET-01 territory, not this module's.
 *
 * Fails open at every seam: a label-index fault degrades to the plain per-user
 * reconcile the persist path did before; the flag is an instant kill switch.
 */

import { reconcileProposedDomain } from '@/lib/questions/categorization';
import type { GlobalDomainDepth } from '@/server/db/queries/knowledge';

export type BankReconcileMethod = 'key-exact' | 'llm' | 'none';

export type BankReconcileOutcome = {
  /** The label the generation LLM proposed. */
  proposed: string;
  /** The label to persist (proposed when no fold). */
  canonicalDomain: string;
  /** Whether the outcome differs from the proposal (any fold, key or semantic). */
  reconciled: boolean;
  method: BankReconcileMethod;
};

// Full corpus label index: minDepth 1 because pass 1's whole point is to never
// mint a NEW spelling of a label that exists at ALL. The limit bounds the Haiku
// candidate list; ~120 distinct bank labels exist today (2026-07), so the cap
// only bites at ~3x current scale — logged below when it does.
const LABEL_INDEX_MIN_DEPTH = 1;
const LABEL_INDEX_LIMIT = 400;

/**
 * RECONCILE_BANK_DOMAINS — default ON. Set to a falsy value (false/0/no/off)
 * to revert the generated path to the player-KB-only reconcile without a
 * deploy. Same kill-switch contract as RECONCILE_AUTHORED_DOMAINS.
 */
export function isReconcileBankDomainsEnabled(): boolean {
  const raw = process.env.RECONCILE_BANK_DOMAINS?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true; // default ON
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

/**
 * The corpus label index for pass-1/pass-2 candidates. Fetch ONCE per persist
 * batch and thread through `options.labelIndex` — the underlying query scans
 * both question tables. Fails open to an empty index.
 */
export async function getBankLabelIndex(): Promise<GlobalDomainDepth[]> {
  try {
    // Lazy import: queries/knowledge transitively evaluates table columns at
    // module load, which breaks test suites that partially mock '@/server/db'.
    // This seam is already fail-open, so the import belongs inside the try.
    const { getDeepGlobalDomains } = await import('@/server/db/queries/knowledge');
    const labels = await getDeepGlobalDomains(LABEL_INDEX_MIN_DEPTH, LABEL_INDEX_LIMIT);
    if (labels.length >= LABEL_INDEX_LIMIT) {
      console.warn('[bank-reconcile] label index hit its cap — shallowest labels dropped', {
        cap: LABEL_INDEX_LIMIT,
      });
    }
    return labels;
  } catch (error) {
    console.warn('[bank-reconcile] label index fetch failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function reconcileBankDomain(
  proposedDomain: string,
  userId: string,
  options: { labelIndex?: GlobalDomainDepth[] } = {},
): Promise<BankReconcileOutcome> {
  const proposed = proposedDomain;

  if (!isReconcileBankDomainsEnabled()) {
    // Legacy behavior: player-KB-only reconcile, corpus labels invisible.
    const llm = await reconcileProposedDomain(proposed, userId);
    const folded = llm.canonicalDomain !== proposed;
    return {
      proposed,
      canonicalDomain: llm.canonicalDomain,
      reconciled: folded,
      method: folded ? 'llm' : 'none',
    };
  }

  const labelIndex = options.labelIndex ?? (await getBankLabelIndex());
  const llm = await reconcileProposedDomain(proposed, userId, {
    additionalDomains: labelIndex.map((d) => d.domain),
  });

  const folded = llm.canonicalDomain !== proposed;
  // llm.reconciled=true only on a semantic (Haiku) fold; a fold with
  // reconciled=false is the helper's deterministic domainKey short-circuit.
  const method: BankReconcileMethod = !folded ? 'none' : llm.reconciled ? 'llm' : 'key-exact';
  if (folded) {
    console.log(
      `[bank-reconcile] proposed="${proposed}" canonical="${llm.canonicalDomain}" method=${method}`,
    );
  }
  return { proposed, canonicalDomain: llm.canonicalDomain, reconciled: folded, method };
}
