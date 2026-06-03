/**
 * Lately "Convergence" moments (B-Convergence-1) — same-correct overlap.
 *
 * Read-derived, additive surface: it surfaces when the viewer and a friend have
 * INDEPENDENTLY answered the SAME shared questions correctly. It celebrates
 * intellectual overlap ("the people who get you, getting you"), and — like
 * `deriveLatelyMilestones` — it's a pure transform so it can be unit-tested
 * without a DB. No write path, no migration, no points, no mastery.
 *
 * FIRING / RESET / OWNERSHIP (the part most likely to drift):
 *  - A card fires when CONVERGENCE_THRESHOLD (=3) co-correct shared questions
 *    accumulate for the pair. No rarity/difficulty gate — every co-correct
 *    shared question is eligible.
 *  - 14-day window, CLUSTER-RELATIVE: the 3 questions in a card must fall within
 *    a CONVERGENCE_WINDOW_DAYS (=14) span of EACH OTHER. We replay the pair's
 *    co-correct questions in chronological order (by the moment each became
 *    co-correct) and chunk them into groups of 3. This makes consumption,
 *    reset, and single-owner all deterministic from timestamps alone — so no
 *    consumed-tracking table is needed (the chunk boundaries ARE the
 *    consumption record, and a question is never reused across two clusters).
 *  - Reset on fire: when a cluster of 3 is emitted the buffer clears; the next
 *    card requires 3 fresh questions.
 *  - Ownership — fires for ONE person only: the card belongs to whoever answered
 *    the cluster-completing ("3rd qualifying") question FIRST. The other member
 *    of the pair gets nothing. `deriveConvergences` is called per-viewer and
 *    only emits the clusters that viewer owns.
 *
 * "Shared" excludes pair-authored questions — that exclusion happens in the
 * query layer (a question authored by either member is covered by the existing
 * they_got_you / you_got_them moments), so the rows handed here are already the
 * third-party co-correct overlap.
 */

export const CONVERGENCE_WINDOW_DAYS = 14;
export const CONVERGENCE_THRESHOLD = 3;

const WINDOW_MS = CONVERGENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// One co-correct shared question for a (viewer, friend) pair. `qualifyingAt`
// (the moment it became co-correct) is max(viewerAnsweredAt, friendAnsweredAt).
export type ConvergenceCoCorrectRow = {
  friendId: string;
  friendName: string;
  friendFirstName: string;
  questionId: string;
  viewerAnsweredAt: Date;
  friendAnsweredAt: Date;
};

export type Convergence = {
  kind: 'same_correct';
  id: string;
  friendId: string;
  friendName: string;
  friendFirstName: string;
  // Exactly CONVERGENCE_THRESHOLD question ids, in the order they became
  // co-correct (qualifyingAt asc).
  questionIds: string[];
  sortAt: Date;
};

function qualifyingAt(row: ConvergenceCoCorrectRow): number {
  return Math.max(row.viewerAnsweredAt.getTime(), row.friendAnsweredAt.getTime());
}

/**
 * Derive the convergence cards the given viewer OWNS from a flat list of the
 * pair's co-correct shared questions. Pure + deterministic: sorting by
 * qualifyingAt (questionId tie-break) and chunking by 3 means the same rows
 * always yield the same cards, with no question reused across cards.
 */
export function deriveConvergences(
  viewerId: string,
  rows: ConvergenceCoCorrectRow[],
  opts: { windowMs?: number; threshold?: number } = {},
): Convergence[] {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const threshold = opts.threshold ?? CONVERGENCE_THRESHOLD;

  // 1. Group by friend, deduping questionId (a question answered twice can't
  //    count toward the threshold twice — keep the EARLIEST co-correct moment).
  const byFriend = new Map<string, Map<string, ConvergenceCoCorrectRow>>();
  for (const row of rows) {
    let group = byFriend.get(row.friendId);
    if (!group) {
      group = new Map();
      byFriend.set(row.friendId, group);
    }
    const prev = group.get(row.questionId);
    if (!prev || qualifyingAt(row) < qualifyingAt(prev)) {
      group.set(row.questionId, row);
    }
  }

  const out: Convergence[] = [];
  for (const [friendId, group] of byFriend) {
    // 2. Chronological order by the moment each became co-correct.
    const sorted = [...group.values()].sort((a, b) => {
      const delta = qualifyingAt(a) - qualifyingAt(b);
      return delta !== 0 ? delta : a.questionId.localeCompare(b.questionId);
    });

    // 3. Replay into a buffer, evicting entries that fall outside a 14-day span
    //    of the current question, and emitting + clearing on every 3rd.
    let buffer: ConvergenceCoCorrectRow[] = [];
    for (const q of sorted) {
      const cutoff = qualifyingAt(q) - windowMs;
      while (buffer.length > 0 && qualifyingAt(buffer[0]) < cutoff) {
        buffer.shift();
      }
      buffer.push(q);
      if (buffer.length === threshold) {
        const cluster = buffer;
        buffer = [];
        // 4. The cluster-completing question is the newest (last) in the buffer.
        //    Owner = whoever answered IT first. Emit only the viewer's clusters.
        const q3 = cluster[cluster.length - 1];
        if (ownerOf(viewerId, friendId, q3) === viewerId) {
          out.push(buildConvergence(friendId, cluster, q3));
        }
      }
    }
  }

  // Most-recent first; id as a stable tie-break (mirrors deriveLatelyMilestones).
  return out.sort((a, b) => {
    const delta = b.sortAt.getTime() - a.sortAt.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

// Owner = whichever of the pair answered the cluster-completing question first.
// Tie on identical timestamps falls to the lexicographically lower user id so
// the result is deterministic (and still assigns exactly one owner).
function ownerOf(
  viewerId: string,
  friendId: string,
  q3: ConvergenceCoCorrectRow,
): string {
  const viewerAt = q3.viewerAnsweredAt.getTime();
  const friendAt = q3.friendAnsweredAt.getTime();
  if (viewerAt < friendAt) return viewerId;
  if (friendAt < viewerAt) return friendId;
  return viewerId < friendId ? viewerId : friendId;
}

function buildConvergence(
  friendId: string,
  cluster: ConvergenceCoCorrectRow[],
  q3: ConvergenceCoCorrectRow,
): Convergence {
  const questionIds = cluster.map((c) => c.questionId);
  return {
    kind: 'same_correct',
    // Content-stable across renders: same pair + same 3 questions => same id,
    // which the deterministic caption assignment keys off.
    id: `converge:${friendId}:${[...questionIds].sort().join('_')}`,
    friendId,
    friendName: q3.friendName,
    friendFirstName: q3.friendFirstName,
    questionIds,
    sortAt: new Date(qualifyingAt(q3)),
  };
}
