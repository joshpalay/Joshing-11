/**
 * Pool embedding dedup — collision matrix + insert-time orchestration
 * (B1 pool substrate, PRD-D-5 §5.1 D10 / §7).
 *
 * The deterministic guards (fact_key + Haiku + normalized text) remain the cheap
 * first pass; this is the semantic backstop. The cardinal rule (Drift Risk 2):
 * a HUMAN-authored question BEATS a machine near-duplicate. Suppression always
 * flags (is_duplicate + suppressed_by), NEVER deletes — decay is gone, so every
 * suppression must be reversible.
 *
 *   incoming \ nearest │ machine            │ human
 *   ───────────────────┼────────────────────┼────────────────────
 *   machine            │ suppress incoming  │ suppress incoming
 *   human              │ suppress EXISTING  │ suppress incoming
 *
 * Only the human-over-machine cell suppresses the row already in the pool.
 */

import type { PoolOrigin } from '@/server/db/queries/pool';
import {
  findNearestInPool,
  markPoolDuplicate,
  storePoolEmbedding,
  type NearestPoolMatch,
} from '@/server/db/queries/pool';
import { embedText, embedTexts, isEmbeddingEnabled } from '@/server/llm/embeddings';

// Cosine *similarity* threshold (1 = identical). Start strict per §7 (the spec's
// knob table does not pin a number); override via env without a deploy.
export const DEFAULT_DEDUP_COSINE_THRESHOLD = 0.92;

export function getDedupCosineThreshold(): number {
  const raw = process.env.POOL_DEDUP_COSINE_THRESHOLD?.trim();
  if (!raw) return DEFAULT_DEDUP_COSINE_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_DEDUP_COSINE_THRESHOLD;
  }
  return parsed;
}

// Higher bar applied when both rows carry a fact_key and the keys DIFFER. Questions
// about one work share so much vocabulary ("In 'Paradise Lost,' …") that genuinely
// distinct facts embed ABOVE the base 0.92 threshold and were being falsely
// suppressed — a 2026-06-27 audit found ~46% of distinct pooled facts hidden this
// way. Measured separation on the live pool: true same-fact dupes sit ≥0.9996,
// while different-fact pairs span 0.92–0.98. So when fact_key (the authoritative
// "same fact?" signal) says the facts DIFFER, only the embedding's same-text
// backstop should still fire — require near-identity. Override via
// POOL_DEDUP_DIFFERENT_FACT_THRESHOLD.
export const DEFAULT_DIFFERENT_FACT_COSINE_THRESHOLD = 0.99;

export function getDifferentFactCosineThreshold(): number {
  const raw = process.env.POOL_DEDUP_DIFFERENT_FACT_THRESHOLD?.trim();
  if (!raw) return DEFAULT_DIFFERENT_FACT_COSINE_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_DIFFERENT_FACT_COSINE_THRESHOLD;
  }
  return parsed;
}

export type CollisionDecision =
  | { action: 'none' }
  | { action: 'suppress_incoming'; survivorId: string }
  | { action: 'suppress_existing'; existingId: string; existingOrigin: PoolOrigin; survivorId: string };

/**
 * Pure collision matrix. `incomingId` is the row just inserted; `nearest` is the
 * closest existing pool row (excluding self), or null if none within reach.
 */
export function resolveCollision(
  incoming: { id: string; origin: PoolOrigin; factKey?: string | null },
  nearest: NearestPoolMatch | null,
  threshold: number,
  differentFactThreshold: number = getDifferentFactCosineThreshold(),
): CollisionDecision {
  if (!nearest) return { action: 'none' };

  // When BOTH rows have a fact_key and the keys differ, fact_key is the
  // authoritative signal that these are distinct facts — only the embedding's
  // near-identical-text backstop should still suppress, so raise the bar. When
  // either fact_key is absent (or they match), use the base semantic threshold.
  const factKeysDiffer =
    incoming.factKey != null &&
    nearest.factKey != null &&
    incoming.factKey !== nearest.factKey;
  const effectiveThreshold = factKeysDiffer
    ? Math.max(threshold, differentFactThreshold)
    : threshold;
  if (nearest.similarity < effectiveThreshold) return { action: 'none' };

  // Human beats machine: the only case where the EXISTING row is suppressed.
  if (incoming.origin === 'human' && nearest.origin === 'machine') {
    return {
      action: 'suppress_existing',
      existingId: nearest.id,
      existingOrigin: 'machine',
      survivorId: incoming.id,
    };
  }

  // Every other collision (machine vs *, human vs human): suppress the new one.
  return { action: 'suppress_incoming', survivorId: nearest.id };
}

/**
 * Insert-time dedup, best-effort. Embeds the freshly-inserted row, stores the
 * vector, finds its nearest pool neighbour, and applies the collision matrix.
 * Any failure (no key, API error, missing column pre-migration) is swallowed so
 * generation/authoring is never blocked — the deterministic guards still ran.
 */
export async function embedAndResolveDuplicate(args: {
  id: string;
  origin: PoolOrigin;
  questionText: string;
  factKey?: string | null;
}): Promise<void> {
  if (!isEmbeddingEnabled()) return;
  try {
    const embedding = await embedText(args.questionText, 'document');
    if (!embedding) return;

    await storePoolEmbedding(args.origin, args.id, embedding);

    const nearest = await findNearestInPool(embedding, args.id);
    const decision = resolveCollision(
      { id: args.id, origin: args.origin, factKey: args.factKey ?? null },
      nearest,
      getDedupCosineThreshold(),
    );

    if (decision.action === 'suppress_incoming') {
      await markPoolDuplicate(args.origin, args.id, decision.survivorId);
      console.info('[pool/dedup] suppressed new near-duplicate', {
        origin: args.origin,
        id: args.id,
        survivor: decision.survivorId,
      });
    } else if (decision.action === 'suppress_existing') {
      // Human beat an existing machine row.
      await markPoolDuplicate(decision.existingOrigin, decision.existingId, decision.survivorId);
      console.info('[pool/dedup] human beat machine; suppressed existing machine row', {
        existing: decision.existingId,
        survivor: decision.survivorId,
      });
    }
  } catch (error) {
    console.warn('[pool/dedup] insert-time dedup skipped (non-fatal)', {
      id: args.id,
      origin: args.origin,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Batched variant of {@link embedAndResolveDuplicate} for a freshly-generated
 * pool batch (B-DEDUP-EMBED-RELIABILITY). Embeds every row's text in ONE Voyage
 * call instead of one-call-per-row, which is what made the daily generation
 * cron burst dozens of concurrent single-item requests and get rate-limited
 * (~20-50% of rows landed embedding-less). Storage + the collision pass stay
 * per-row and interleaved (store row i, then resolve it against the pool, which
 * now includes rows already stored this batch) — identical semantics to calling
 * embedAndResolveDuplicate in a loop, minus the Voyage call amplification.
 * Best-effort: a disabled/failed embed leaves the rows un-embedded (the daily
 * gate then can't see them) but never blocks generation.
 */
export async function embedAndResolveDuplicatesBatch(
  rows: Array<{ id: string; origin: PoolOrigin; questionText: string; factKey?: string | null }>,
): Promise<void> {
  if (!isEmbeddingEnabled() || rows.length === 0) return;
  try {
    const vectors = await embedTexts(rows.map((r) => r.questionText), 'document');
    if (!vectors) return;
    const threshold = getDedupCosineThreshold();
    for (let i = 0; i < rows.length; i += 1) {
      const embedding = vectors[i];
      if (!embedding) continue;
      const row = rows[i];
      await storePoolEmbedding(row.origin, row.id, embedding);

      const nearest = await findNearestInPool(embedding, row.id);
      const decision = resolveCollision(
        { id: row.id, origin: row.origin, factKey: row.factKey ?? null },
        nearest,
        threshold,
      );
      if (decision.action === 'suppress_incoming') {
        await markPoolDuplicate(row.origin, row.id, decision.survivorId);
        console.info('[pool/dedup] suppressed new near-duplicate', {
          origin: row.origin,
          id: row.id,
          survivor: decision.survivorId,
        });
      } else if (decision.action === 'suppress_existing') {
        await markPoolDuplicate(decision.existingOrigin, decision.existingId, decision.survivorId);
        console.info('[pool/dedup] human beat machine; suppressed existing machine row', {
          existing: decision.existingId,
          survivor: decision.survivorId,
        });
      }
    }
  } catch (error) {
    console.warn('[pool/dedup] batch insert-time dedup skipped (non-fatal)', {
      count: rows.length,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
