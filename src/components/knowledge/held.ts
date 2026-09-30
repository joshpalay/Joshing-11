import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';

// "On the player's map" for a knowledge-tree node. Points alone used to decide
// this, so a topic the player had just added (0 points until its first answer)
// rendered as a ghost and offered "Add it" again even though the setup page
// listed it (Hamlet, 2026-09-30). The tree now marks every owned node `held`;
// points > 0 stays as a fallback for optimistic/older node shapes.
export function isHeldNode(node: KnowledgeTreeNode): boolean {
  return !node.ghost && (Boolean(node.held) || (node.value ?? 0) > 0);
}
