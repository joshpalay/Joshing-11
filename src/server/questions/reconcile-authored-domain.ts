/**
 * B-CATEGORY-AUTHORED-RECONCILE-01 — reconcile a user-authored question's blind
 * category label against domains that already exist, the way the generated/daily
 * path (reconcileProposedDomain) and the onboarding path (convergeDomain) already
 * do, so an authored "Hamlet" question folds onto the player's existing
 * "Shakespearean Tragedy" / "Hamlet" instead of minting a near-duplicate sibling.
 *
 * Mechanism (Josh's fork resolution): **(C) both — pg_trgm first, Haiku on miss**,
 * applied **silently** (no author confirm step). We deliberately do NOT reimplement
 * either reconcile primitive — we compose the two existing ones:
 *
 *   1. convergeDomain() — deterministic pg_trgm convergence against the cross-game
 *      PLAYER_MASTERY corpus. We auto-adopt ONLY its exact-key candidate. Its fuzzy
 *      candidates are LEXICAL ("Roman Empire" ~ "Holy Roman Empire") and per that
 *      module's contract are never auto-applied — we log them for the shadow-log
 *      review but do not fold on them silently.
 *   2. reconcileProposedDomain() — Haiku semantic reconcile against the player's OWN
 *      existing domains, run ONLY on a trgm-exact miss. Folds synonyms trgm can't
 *      ("The Bard's Tragedies" → "Shakespearean Tragedy").
 *
 * Both primitives already swallow their own infra faults (pg_trgm absent, LLM
 * timeout) and degrade to "no fold", so a reconcile fault never blocks a save.
 */

import { reconcileProposedDomain } from '@/lib/questions/categorization';
import { convergeDomain } from '@/server/knowledge/converge-domain';
import { getDeepGlobalDomains } from '@/server/db/queries/knowledge';

export type AuthoredReconcileMethod = 'trgm-exact' | 'llm' | 'none';

export type AuthoredReconcileOutcome = {
  /** The blind label the categorizer proposed (post-normalization). */
  proposed: string;
  /** The label that WOULD be written if the fold is applied (proposed when no fold). */
  canonicalDomain: string;
  /** Whether the reconcile folded onto a different existing domain. */
  reconciled: boolean;
  /**
   * True iff the reconciled label differs from the proposed RAW spelling (the
   * apply gate). Raw, not domainKey: PLAYER_MASTERY is keyed on the stored
   * canonical_subcategory string, so converging "hamlet" → "Hamlet" collapses a
   * real duplicate row even though both fold to the same domainKey. (A
   * trgm-exact match shares the input's domainKey by construction — a domainKey
   * gate would make it a permanent no-op.)
   */
  differs: boolean;
  method: AuthoredReconcileMethod;
  /** The trgm exact-key corpus label, if one matched (telemetry). */
  trgmExactLabel: string | null;
  /** trgm fuzzy candidates — logged for shadow-log review, NEVER auto-applied. */
  trgmFuzzyCandidates: Array<{ label: string; similarity: number }>;
  /** Whether the Haiku pass reported a semantic fold. */
  llmReconciled: boolean;
};

/**
 * Tier-1 prevention (D-NARROW-KB-FABRICATION-01 follow-up): authored-path
 * reconcile is now ON by default — the Phase-1 shadow-log period is over and
 * folding authored labels onto existing domains is the durable fix for spelling
 * fragmentation. The env var remains an instant kill switch: set
 * RECONCILE_AUTHORED_DOMAINS to a falsy value (false/0/no/off) to revert to the
 * blind-write behaviour without a deploy. The authored path still always
 * COMPUTES + shadow-logs the outcome regardless of this flag.
 */
export function isReconcileAuthoredDomainsEnabled(): boolean {
  const raw = process.env.RECONCILE_AUTHORED_DOMAINS?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true; // default ON
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

export async function reconcileAuthoredDomain(
  proposedDomain: string,
  userId: string,
): Promise<AuthoredReconcileOutcome> {
  const proposed = proposedDomain;
  const base: AuthoredReconcileOutcome = {
    proposed,
    canonicalDomain: proposed,
    reconciled: false,
    differs: false,
    method: 'none',
    trgmExactLabel: null,
    trgmFuzzyCandidates: [],
    llmReconciled: false,
  };

  // ── Pass 1: deterministic pg_trgm convergence (cheap, no LLM) ──────────────
  let trgmExactLabel: string | null = null;
  let trgmFuzzyCandidates: Array<{ label: string; similarity: number }> = [];
  try {
    const converge = await convergeDomain(proposed);
    trgmExactLabel = converge.candidates.find((c) => c.kind === 'exact')?.label ?? null;
    trgmFuzzyCandidates = converge.candidates
      .filter((c) => c.kind === 'fuzzy')
      .map((c) => ({ label: c.label, similarity: c.similarity }));
  } catch (error) {
    // convergeDomain already degrades internally when pg_trgm is absent; this is
    // a belt-and-suspenders guard so a corpus query fault never blocks a save.
    console.warn('[authored-reconcile] converge failed (non-fatal)', {
      proposed,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Exact-key matches are the only trgm candidates safe to fold silently. An
  // exact-key hit means this domain already exists canonically, so we short-
  // circuit the LLM regardless — adopting the corpus spelling when it differs.
  if (trgmExactLabel) {
    const differs = trgmExactLabel !== proposed;
    return {
      ...base,
      canonicalDomain: trgmExactLabel,
      reconciled: differs,
      differs,
      method: differs ? 'trgm-exact' : 'none',
      trgmExactLabel,
      trgmFuzzyCandidates,
    };
  }

  // ── Pass 2: Haiku semantic reconcile, on trgm-exact miss only ──────────────
  // reconcileProposedDomain returns the player's existing spelling on a fold
  // (semantic OR its own per-user exact-casing short-circuit), else the proposal.
  // We also hand it the deep GLOBAL domains so it can fold onto an established
  // domain (e.g. one the house Library owns) the author hasn't personally played.
  let globalDomains: string[] = [];
  try {
    globalDomains = (await getDeepGlobalDomains()).map((d) => d.domain);
  } catch (error) {
    console.warn('[authored-reconcile] global domain fetch failed (non-fatal)', {
      proposed,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  let llm = { canonicalDomain: proposed, reconciled: false };
  try {
    llm = await reconcileProposedDomain(proposed, userId, { additionalDomains: globalDomains });
  } catch (error) {
    console.warn('[authored-reconcile] llm reconcile failed (non-fatal)', {
      proposed,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Adopt the pass-2 label whenever it actually differs (covers both the Haiku
  // semantic fold and the helper's per-user exact-casing fold, which reports
  // reconciled=false but still hands back the existing spelling).
  const folded = llm.canonicalDomain !== proposed;
  return {
    ...base,
    canonicalDomain: folded ? llm.canonicalDomain : proposed,
    reconciled: folded,
    differs: folded,
    method: folded ? 'llm' : 'none',
    trgmFuzzyCandidates,
    llmReconciled: llm.reconciled,
  };
}
