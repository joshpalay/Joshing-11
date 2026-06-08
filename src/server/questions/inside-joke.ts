import { areFriends } from '@/server/db/queries/friends';
import type { InsideJokeKind } from '@/lib/questions-types';

export type ViewerInsideJoke = { text: string; kind: InsideJokeKind };

// Decides whether a question's aside is shown to a viewer, and under which
// provenance label. Shared by the daily / feed / joshing-game answer routes
// (previously three identical copies).
//
// - LLM-origin questions (null creatorId) have no human author and no
//   relationship to gate on: the aside shows under the non-relational
//   `editorial` label.
// - Human-authored questions keep the relational gate: shown to the author and
//   to friends under the `relational` label, hidden from strangers.
export async function selectInsideJokeForViewer(
  insideJoke: string | null,
  creatorId: string | null,
  viewerId: string,
): Promise<ViewerInsideJoke | null> {
  if (!insideJoke) return null;
  if (!creatorId) return { text: insideJoke, kind: 'editorial' };
  if (creatorId === viewerId) return { text: insideJoke, kind: 'relational' };
  const friends = await areFriends(viewerId, creatorId);
  return friends ? { text: insideJoke, kind: 'relational' } : null;
}
