/**
 * Verify-gate for thin declared domains (2026-07-06, Josh's fabrication report).
 *
 * Ungrounded generation fabricates canon for thin, bounded niche fiction (the
 * "Ben Ripley vomits when terrified" case in "Spy School Books 1-6"), and the
 * factual gate shares the generator's blind spot — so those questions reach the
 * player UNVERIFIED. This holds back unverified fresh generations in THIN DECLARED
 * domains: only rows that have earned >= machine_verified (ask-to-answer
 * corroboration inline, or the async web-search verify pass once
 * VERIFY_WEB_SEARCH_ALLOWED_DOMAINS is flipped to wikipedia/fandom) reach the
 * queue. Dropped rows stay persisted for that async pass to promote and serve
 * later. "Fewer but true" on exactly the domains where fabrication is likeliest.
 *
 * DEFAULT ON as of 2026-07-08, flipped together with the verifier wiki/fandom
 * allowlist default (verify-question.ts) so held rows have a path back to
 * serving. Set VERIFY_GATE_THIN_DECLARED_ENABLED=false to revert without a
 * deploy. Fail-open: any error serves the ungated set (never blocks a build).
 */
import { narrowKbThinnessThreshold } from '@/server/daily/kb-exhaustion';
import { SELF_PRACTICE_TIERS, type TrustTier } from '@/server/daily/verification-gating';
import { recordGateDrops, recordGateFailedOpen } from '@/server/db/queries/gate-drop-stats';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';
import type { GeneratedQuestionRow } from '@/server/daily/generate-questions';

export function isVerifyGateThinEnabled(): boolean {
  const raw = process.env.VERIFY_GATE_THIN_DECLARED_ENABLED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

const SERVEABLE_TIERS = new Set<TrustTier>(SELF_PRACTICE_TIERS);

/**
 * Pure: drop rows below the self-practice tier floor (i.e. `unverified`) whose
 * domain is in the thin-declared set. Rows in any other domain, and already-
 * verified rows anywhere, pass untouched. Exported for unit tests.
 */
export function filterUnverifiedInDomains(
  rows: GeneratedQuestionRow[],
  thinDeclared: ReadonlySet<string>,
): { kept: GeneratedQuestionRow[]; dropped: number } {
  if (thinDeclared.size === 0) return { kept: rows, dropped: 0 };
  const kept = rows.filter((row) => {
    const domain = row.canonicalSubcategory ?? '';
    if (!thinDeclared.has(domain)) return true;
    return SERVEABLE_TIERS.has(row.trustTier as TrustTier);
  });
  return { kept, dropped: rows.length - kept.length };
}

/**
 * Hold unverified fresh generations in the viewer's THIN DECLARED domains. Thinness
 * is the durable-pool-depth proxy the narrow-KB guard already uses; a domain the
 * player didn't DECLARE is never gated (a demonstrated/borrowed domain isn't a
 * scoped-fiction fabrication risk in the same way). No-op unless flag-enabled.
 */
export async function verifyGateThinDeclared(
  rows: GeneratedQuestionRow[],
  declaredDomains: ReadonlySet<string>,
): Promise<GeneratedQuestionRow[]> {
  if (!isVerifyGateThinEnabled() || rows.length === 0 || declaredDomains.size === 0) {
    return rows;
  }
  try {
    const present = [
      ...new Set(rows.map((row) => row.canonicalSubcategory ?? '').filter(Boolean)),
    ].filter((domain) => declaredDomains.has(domain));
    if (present.length === 0) return rows;

    const depths = await getDurablePoolDepthForDomains(present);
    const threshold = narrowKbThinnessThreshold();
    const thinDeclared = new Set(present.filter((domain) => (depths.get(domain) ?? 0) < threshold));

    const { kept, dropped } = filterUnverifiedInDomains(rows, thinDeclared);
    void recordGateDrops([{ gate: 'thin_declared', considered: rows.length, dropped }]);
    if (dropped > 0) {
      console.info('[verify-gate-thin] held unverified generations in thin declared domains', {
        thinDeclared: [...thinDeclared],
        dropped,
        kept: kept.length,
      });
    }
    return kept;
  } catch (error) {
    console.warn('[verify-gate-thin] failed; serving ungated', {
      error: error instanceof Error ? error.message : String(error),
    });
    recordGateFailedOpen('thin_declared');
    return rows;
  }
}
