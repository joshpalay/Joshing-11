/**
 * D-4 via-attribution — per-card "by {author}" + "via {source}" stranger-
 * discovery affordances on forwarded feed questions.
 *
 * A batched, gated read of the two strangers worth discovering off a feed card:
 *  - AUTHOR — the human who wrote the question (`Question.creatorId`).
 *  - VIA — the relay source the question reached the viewer through, two hops up
 *    (`FeedItem.viaUserId`, stamped at forward time).
 *
 * Both ride the SAME D-2 niche-match consent shape (`notifyNicheMatch`): they
 * surface only when the viewer↔person relationship is `none` (STRANGER gate),
 * the person has opted in (the flag of the EXPOSED party gates the exposure —
 * `discoverableByNicheMatch` for the author, `discoverableByForward` for the
 * relay source), and the question is public. Author leads; if author == via,
 * a single (author) affordance is shown — never "by X · via X".
 *
 * The pure `composeDiscoveryAttribution` is DB-free so the gate/dedupe
 * invariants are unit-testable without a database. The DB function batches
 * every lookup (relationships, both opt-in flags, display names) — no N+1.
 */

import { inArray } from 'drizzle-orm';

import { db, users } from '@/server/db';
import { getForwardDiscoverable, getNicheMatchDiscoverable } from '@/server/db/queries/account';
import { getRelationships } from '@/server/db/queries/friend-requests';

/** A resolved discovery target, ready for the wire / a profile link. */
export type DiscoveryPerson = {
  userId: string;
  displayName: string;
  href: string;
};

/** The (optional) author + via affordances for one feed item. */
export type DiscoveryAttribution = {
  author?: DiscoveryPerson;
  via?: DiscoveryPerson;
};

/** Per-feed-item inputs: the candidate author/via ids and the public gate. */
export type DiscoveryItemInput = {
  feedItemId: string;
  /** Question.creatorId — the human author, or null for LLM-origin questions. */
  authorUserId: string | null;
  /** FeedItem.viaUserId — the two-hop relay source, or null. */
  viaUserId: string | null;
  /** Question.visibility === 'public'. Gates BOTH signals. */
  isPublic: boolean;
};

function profileHref(userId: string): string {
  return `/users/${encodeURIComponent(userId)}`;
}

/**
 * Compose the gated author/via affordances for a page of feed items. Pure and
 * deterministic. Enforces, per item:
 *  - public-only: a non-public question surfaces neither signal;
 *  - self-exclusion: the viewer is never surfaced as their own author/via;
 *  - stranger gate: only ids in `strangerIds` (relationship === 'none') survive;
 *  - consent: author gated by `authorOptedIn`, via gated by `forwardOptedIn`
 *    (the flag of the exposed party);
 *  - dedupe + lead: when author and via are the SAME person, only the author
 *    affordance is emitted (author leads — they made it).
 * Items with neither surviving signal are omitted from the result map.
 */
export function composeDiscoveryAttribution(
  items: DiscoveryItemInput[],
  ctx: {
    viewerUserId: string;
    strangerIds: Set<string>;
    authorOptedIn: Set<string>;
    forwardOptedIn: Set<string>;
    person: (userId: string) => DiscoveryPerson | null;
  },
): Map<string, DiscoveryAttribution> {
  const { viewerUserId, strangerIds, authorOptedIn, forwardOptedIn, person } = ctx;
  const result = new Map<string, DiscoveryAttribution>();

  const qualifies = (userId: string | null, optedIn: Set<string>): DiscoveryPerson | null => {
    if (!userId || userId === viewerUserId) return null;
    if (!strangerIds.has(userId)) return null;
    if (!optedIn.has(userId)) return null;
    return person(userId);
  };

  for (const item of items) {
    if (!item.isPublic) continue;
    const author = qualifies(item.authorUserId, authorOptedIn);
    // Author leads: when via is the same person as the author, the author
    // affordance already covers them — don't also emit a redundant "via X".
    const via =
      item.viaUserId && item.viaUserId === item.authorUserId && author
        ? null
        : qualifies(item.viaUserId, forwardOptedIn);

    if (!author && !via) continue;
    const attribution: DiscoveryAttribution = {};
    if (author) attribution.author = author;
    if (via) attribution.via = via;
    result.set(item.feedItemId, attribution);
  }

  return result;
}

/**
 * Batched resolve + gate of the author/via discovery affordances for a page of
 * feed items. One relationship query, two opt-in flag queries, one name query —
 * no N+1. Returns an empty map for an empty page.
 */
export async function getDiscoveryAttributionForItems(
  viewerUserId: string,
  items: DiscoveryItemInput[],
): Promise<Map<string, DiscoveryAttribution>> {
  // Candidate ids are only those on PUBLIC questions and not the viewer.
  const authorIds = new Set<string>();
  const viaIds = new Set<string>();
  for (const item of items) {
    if (!item.isPublic) continue;
    if (item.authorUserId && item.authorUserId !== viewerUserId) authorIds.add(item.authorUserId);
    if (item.viaUserId && item.viaUserId !== viewerUserId) viaIds.add(item.viaUserId);
  }
  const candidateIds = [...new Set([...authorIds, ...viaIds])];
  if (candidateIds.length === 0) return new Map();

  // STRANGER gate first — only `none`-relationship candidates can be surfaced;
  // drop the rest before the (cheaper) flag/name lookups.
  const relationships = await getRelationships(viewerUserId, candidateIds);
  const strangerIds = new Set(
    candidateIds.filter((id) => (relationships.get(id)?.state ?? 'none') === 'none'),
  );
  if (strangerIds.size === 0) return new Map();

  const strangerAuthorIds = [...authorIds].filter((id) => strangerIds.has(id));
  const strangerViaIds = [...viaIds].filter((id) => strangerIds.has(id));

  const [authorOptedIn, forwardOptedIn] = await Promise.all([
    getNicheMatchDiscoverable(strangerAuthorIds),
    getForwardDiscoverable(strangerViaIds),
  ]);

  // Only resolve names for ids that cleared both the stranger gate and a
  // relevant opt-in flag.
  const nameIds = [
    ...new Set([
      ...strangerAuthorIds.filter((id) => authorOptedIn.has(id)),
      ...strangerViaIds.filter((id) => forwardOptedIn.has(id)),
    ]),
  ];
  const nameRows = nameIds.length
    ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, nameIds))
    : [];
  const personById = new Map<string, DiscoveryPerson>(
    nameRows.map((row) => [
      row.id,
      { userId: row.id, displayName: row.displayName?.trim() || 'Someone', href: profileHref(row.id) },
    ]),
  );

  return composeDiscoveryAttribution(items, {
    viewerUserId,
    strangerIds,
    authorOptedIn,
    forwardOptedIn,
    person: (userId) => personById.get(userId) ?? null,
  });
}
