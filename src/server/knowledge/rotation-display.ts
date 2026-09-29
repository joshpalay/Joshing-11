import { getKnowledgeBase } from '@/server/db/queries/daily';
import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';
import { titleCaseDomain } from '@/lib/knowledge/domain-casing';

// The knowledge / manage-topics pages draw every leaf with no saved frequency
// as "Sometimes · These stay in rotation" (usePeakDetail's DEFAULT_FREQUENCY).
// That is only true for leaves the Daily Five actually draws from. A domain
// first opened by a +2 bonus answer stays parked out of rotation until the
// player adopts it (B-DOMAIN-BONUS-ROTATION-01: no PLAYER_MASTERY row until the
// reveal card's "Yes"), so after a "Not now" the page claimed the topic was in
// rotation when it wasn't (QA 2026-09-27, S2).
//
// "Parked" = a held leaf the Daily Five knowledge base doesn't contain. The
// page shows parked leaves as "Never" and routes a real frequency pick through
// the adopt endpoint, which creates the row the rotation needs.

// Compare on the same casing/punctuation normalization the page labels go
// through (titleCaseDomain), so a stored "us state capitals" and its displayed
// "US State Capitals" match.
function key(name: string): string {
  return titleCaseDomain(name).toLowerCase();
}

/** Held (non-ghost) leaf names in the knowledge tree. */
export function heldLeafNames(tree: KnowledgeTreeNode): string[] {
  const names: string[] = [];
  const walk = (node: KnowledgeTreeNode, isRoot: boolean) => {
    const children = node.children ?? [];
    if (!isRoot && !node.ghost && children.length === 0) names.push(node.name);
    for (const child of children) walk(child, false);
  };
  walk(tree, true);
  return names;
}

/** Held leaves that the Daily Five knowledge base does not draw from. */
export function parkedLeafDomains(
  heldDomains: readonly string[],
  rotatingDomains: readonly string[],
): string[] {
  const rotating = new Set(rotatingDomains.map(key));
  return heldDomains.filter((domain) => {
    const k = key(domain);
    return k.length > 0 && !rotating.has(k);
  });
}

export async function getParkedDomains(userId: string, tree: KnowledgeTreeNode): Promise<string[]> {
  const knowledgeBase = await getKnowledgeBase(userId);
  return parkedLeafDomains(
    heldLeafNames(tree),
    knowledgeBase.map((entry) => entry.domain),
  );
}
