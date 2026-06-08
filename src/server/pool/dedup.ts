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
import { embedText, isEmbeddingEnabled } from '@/server/llm/embeddings';

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

export type CollisionDecision =
  | { action: 'none' }
  | { action: 'suppress_incoming'; survivorId: string }
  | { action: 'suppress_existing'; existingId: string; existingOrigin: PoolOrigin; survivorId: string };

/**
 * Pure collision matrix. `incomingId` is the row just inserted; `nearest` is the
 * closest existing pool row (excluding self), or null if none within reach.
 */
export function resolveCollision(
  incoming: { id: string; origin: PoolOrigin },
  nearest: NearestPoolMatch | null,
  threshold: number,
): CollisionDecision {
  if (!nearest) return { action: 'none' };
  if (nearest.similarity < threshold) return { action: 'none' };

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
}): Promise<void> {
  if (!isEmbeddingEnabled()) return;
  try {
    const embedding = await embedText(args.questionText, 'document');
    if (!embedding) return;

    await storePoolEmbedding(args.origin, args.id, embedding);

    const nearest = await findNearestInPool(embedding, args.id);
    const decision = resolveCollision(
      { id: args.id, origin: args.origin },
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
