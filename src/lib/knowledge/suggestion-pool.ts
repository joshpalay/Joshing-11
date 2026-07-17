import { getNearbyTerritories, type NearbyTerritory } from '@/lib/daily/territory-model';
import { domainKey } from '@/lib/knowledge/domain-key';
import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';

// The "Add a topic" suggestion pool: related-but-specific topics the player
// doesn't hold yet. Primary source is the knowledge tree's unheld "ghost"
// leaves — leaf-level adjacent topics (e.g. Bach → Baroque Music, never a broad
// bucket like "Music") — supplemented by the hard-coded adjacency rules over
// the owned domains. `ownedNames` (owned + declared) are excluded.
//
// Pure and shared so the manage page (client, from its live tree) and the home
// suggestions endpoint (server) build the identical pool. Importing the tree
// type here is `import type` only — no server runtime is pulled into clients.
export function buildSuggestionPool(
  tree: KnowledgeTreeNode,
  ownedNames: readonly string[],
): NearbyTerritory[] {
  const owned = new Set(ownedNames.map(domainKey));
  const pool = new Map<string, NearbyTerritory>();

  // Tree ghost leaves — specific adjacent topics. broadCategory comes from the
  // depth-1 ancestor (the broad-category node) so the circle keeps its tint.
  const walk = (node: KnowledgeTreeNode, depth: number, category: string | null) => {
    const cat = depth === 1 ? node.name : category;
    const children = node.children ?? [];
    if (node.ghost && children.length === 0) {
      const key = domainKey(node.name);
      if (!pool.has(key) && !owned.has(key)) {
        pool.set(key, { domain: node.name, broadCategory: cat, reason: 'Related to your map' });
      }
    }
    for (const child of children) walk(child, depth + 1, cat);
  };
  walk(tree, 0, null);

  // Supplement with the hard-coded adjacency rules over the owned domains.
  for (const territory of getNearbyTerritories([...ownedNames])) {
    const key = domainKey(territory.domain);
    if (!pool.has(key) && !owned.has(key)) pool.set(key, territory);
  }

  return [...pool.values()];
}
