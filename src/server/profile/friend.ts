import { prisma } from '@/lib/prisma';
import { getPortraitData } from '@/server/profile/portrait';

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) {
    if (b.has(x)) n++;
  }
  return n;
}

/**
 * For each canonical subcategory, pick the peer (other than the viewer) with the largest
 * overlap with the viewer on questions both answered correctly in shared groups.
 */
async function computeOverlapTopPeerNames(
  viewerId: string,
  canonicalSubcategories: string[],
  sharedGroupIds: string[],
): Promise<Map<string, string>> {
  void viewerId;
  void canonicalSubcategories;
  void sharedGroupIds;
  // TODO v11.0: prisma.game.findMany - needs new data source
  // TODO v11.0: answer.game_id shared-group overlap scoping - needs new data source
  return new Map<string, string>();
}

export async function getFriendPortraitData(userId: string, viewerId: string) {
  const [ownerPortrait, viewerPortrait, viewerAnswers] = await Promise.all([
    getPortraitData(userId),
    getPortraitData(viewerId),
    prisma.answer.findMany({
      where: { user_id: viewerId },
      select: {
        result: true,
        question: { select: { canonical_subcategory: true } },
      },
    }),
  ]);

  // TODO v11.0: prisma.groupMember.findMany - needs new data source
  const sharedGroupIds: string[] = [];

  const subcats = ownerPortrait.categories.map((c) => c.canonical_subcategory);
  let topPeerBySubcat = new Map<string, string>();
  if (sharedGroupIds.length > 0 && subcats.length > 0) {
    topPeerBySubcat = await computeOverlapTopPeerNames(viewerId, subcats, sharedGroupIds);
  }

  const overlapByCategory = new Map<string, { answered: number; correct: number }>();
  for (const answer of viewerAnswers) {
    const key = answer.question.canonical_subcategory?.trim();
    if (!key) continue;
    const current = overlapByCategory.get(key) ?? { answered: 0, correct: 0 };
    current.answered += 1;
    if (answer.result === 'correct') current.correct += 1;
    overlapByCategory.set(key, current);
  }

  const categories = ownerPortrait.categories.map((item) => {
    const o = overlapByCategory.get(item.canonical_subcategory);
    const hasPlayed = (o?.answered ?? 0) > 0;
    const hasCorrect = (o?.correct ?? 0) > 0;
    return {
      ...item,
      visitor_overlap: {
        has_played_here: hasPlayed,
        has_correct_here: hasCorrect,
        questions_answered: o?.answered ?? 0,
        questions_correct: o?.correct ?? 0,
        overlap_top_peer_name: topPeerBySubcat.get(item.canonical_subcategory) ?? null,
      },
    };
  });

  const ownerCategorySet = new Set(ownerPortrait.categories.map((item) => item.canonical_subcategory));
  const visitor_unexplored = viewerPortrait.categories
    .filter((item) => !ownerCategorySet.has(item.canonical_subcategory))
    .slice(0, 50)
    .map((item) => ({
      canonical_subcategory: item.canonical_subcategory,
      broad_category: item.broad_category,
    }));

  return {
    categories,
    max_declared_score: ownerPortrait.max_declared_score,
    max_proven_score: ownerPortrait.max_proven_score,
    visitor_unexplored,
  };
}
