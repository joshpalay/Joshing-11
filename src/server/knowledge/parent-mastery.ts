/**
 * B-KNOWLEDGE-TAXONOMY-01 P4 — parent-grain mastery, derived at read time with
 * a durable FREEZE on crossing (D-doc §B / §5):
 *
 *   - progress = full rolled-up points / the parent's absolute threshold
 *     (§5.1 revised — no fractional cap); mastery needs the bar AND ≥2 corners.
 *   - the moment a player crosses, a KnowledgeParentMastery row is stamped and
 *     mastery is TERMINAL: the guard reads the frozen row BEFORE recomputing,
 *     so roster growth or a threshold edit can never revoke it (§5 as durable
 *     state, the fail-toward-the-player canon).
 *   - leaf mastery is untouched by everything in this module — it stays on the
 *     existing playerMastery path, leaf-exact (§D).
 *
 * Flag-gated: with KNOWLEDGE_GRAPH_MASTERY off (default) nothing reads or
 * writes the ledger and no surface changes.
 */

import { eq } from 'drizzle-orm';

import { db, knowledgeParentMastery } from '@/server/db';
import {
  litCorners,
  parentProgress,
  rosterCoverage,
  type GraphEdge,
  type ParentProgress,
  type RosterCoverage,
} from '@/server/knowledge/graph';

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

export function isKnowledgeGraphMasteryEnabled(): boolean {
  return boolEnv('KNOWLEDGE_GRAPH_ENABLED', false) && boolEnv('KNOWLEDGE_GRAPH_MASTERY', false);
}

export async function getFrozenParentKeys(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ parentDomainKey: knowledgeParentMastery.parentDomainKey })
    .from(knowledgeParentMastery)
    .where(eq(knowledgeParentMastery.userId, userId));
  return new Set(rows.map((r) => r.parentDomainKey));
}

// Idempotent stamp — the unique (user, parent) index makes a re-cross a no-op.
export async function freezeParentMastery(userId: string, parentKey: string): Promise<void> {
  await db
    .insert(knowledgeParentMastery)
    .values({ userId, parentDomainKey: parentKey })
    .onConflictDoNothing();
}

export type ParentMasteryEntry = ParentProgress & {
  frozen: boolean;
  coverage: RosterCoverage;
};

export type ParentNodeInput = {
  domainKey: string;
  masteryThreshold: number | null;
};

/**
 * Pure resolution — unit-tested without a DB. Frozen wins BEFORE any
 * recomputation (§B): a frozen parent reads as master with a frozen full
 * fraction even if roster growth or a threshold edit would place the computed
 * value below the bar today.
 */
export function resolveParentMastery(
  parents: readonly ParentNodeInput[],
  totals: ReadonlyMap<string, number>,
  edges: readonly GraphEdge[],
  frozenKeys: ReadonlySet<string>,
): Map<string, ParentMasteryEntry> {
  const result = new Map<string, ParentMasteryEntry>();
  for (const parent of parents) {
    const coverage = rosterCoverage(parent.domainKey, totals, edges);
    if (frozenKeys.has(parent.domainKey)) {
      // Terminal: fraction frozen, mastery never re-litigated.
      result.set(parent.domainKey, { pct: 1, isMaster: true, frozen: true, coverage });
      continue;
    }
    const progress = parentProgress(
      totals.get(parent.domainKey) ?? 0,
      litCorners(parent.domainKey, totals, edges),
      parent.masteryThreshold,
    );
    result.set(parent.domainKey, { ...progress, frozen: false, coverage });
  }
  return result;
}

/**
 * DB-backed wrapper: reads the freeze ledger, resolves, and stamps any fresh
 * crossings so they become terminal. Flag-off returns pure computation with an
 * empty frozen set and never writes.
 */
export async function getParentMasteryForUser(
  userId: string,
  parents: readonly ParentNodeInput[],
  totals: ReadonlyMap<string, number>,
  edges: readonly GraphEdge[],
): Promise<Map<string, ParentMasteryEntry>> {
  const enabled = isKnowledgeGraphMasteryEnabled();
  const frozenKeys = enabled ? await getFrozenParentKeys(userId) : new Set<string>();
  const resolved = resolveParentMastery(parents, totals, edges, frozenKeys);

  if (enabled) {
    for (const [key, entry] of resolved) {
      if (entry.isMaster && !entry.frozen) {
        await freezeParentMastery(userId, key); // best-effort terminal stamp
      }
    }
  }
  return resolved;
}
