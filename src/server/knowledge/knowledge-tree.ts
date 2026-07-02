/**
 * B-KNOWLEDGE-TAXONOMY-01 P5 — the nested tree behind the bubble map.
 *
 * Assembles the player's owned leaves (real mastery/points from the existing
 * knowledge loader) into the human-authored graph (P1 tables via P2 reads).
 * Mirrors the knowledge-bubbles prototype's DATA shape:
 *   { id, name, field, value?, mastered?, ghost?, children? }
 *
 * Rules carried from the D-doc:
 *   - value only on owned nodes = REAL points (bubble area). Parents carry no
 *     own value; their area is the sum of real descendants.
 *   - ghosts are unheld roster siblings: a layout footprint, ZERO real points
 *     (§5.1 — they never inflate a parent's total).
 *   - one home-parent per leaf for containment (§E — first substantive edge);
 *     other memberships don't render in the packed view.
 *   - leaf mastery is leaf-exact; parent mastery = threshold + ≥2 corners
 *     (parentProgress). Collection parents are NOT containers of points and
 *     are excluded from the packed view (out of scope per the P5 slate).
 */

import { getKnowledgePageData } from '@/server/db/queries/knowledge';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
import {
  litCorners,
  parentProgress,
  rollUpCredit,
  type GraphEdge,
} from '@/server/knowledge/graph';
import {
  getParentMasteryForUser,
  isKnowledgeGraphMasteryEnabled,
} from '@/server/knowledge/parent-mastery';
import { domainKey } from '@/lib/knowledge/domain-key';

export type KnowledgeTreeNode = {
  id: string;
  name: string;
  field: string | null;
  value?: number;
  mastered?: boolean;
  ghost?: boolean;
  children?: KnowledgeTreeNode[];
};

export type OwnedLeaf = {
  domain: string; // display label (canonicalSubcategory)
  points: number;
  mastered: boolean;
  broadCategory: string | null;
};

export type AuthoredNode = {
  domainKey: string;
  label: string;
  nodeKind: 'leaf' | 'parent' | 'both';
  masteryThreshold: number | null;
  fieldHue: string | null;
  broadCategory: string | null;
};

// Ghost bubbles need a footprint to be tappable, but it is layout-only — the
// realValue accounting (and every point total) excludes ghosts entirely.
export const GHOST_FOOTPRINT = 40;

// Broad-category display names → the --cat-* hue scale (always paired with the
// node label in the UI — hue never carries meaning alone).
export function hueForBroadCategory(broadCategory: string | null): string | null {
  if (!broadCategory) return null;
  const folded = broadCategory.trim().toLowerCase().replace(/\s*&\s*|\s+/g, '-');
  const known = new Set([
    'literature',
    'music',
    'film-tv',
    'history',
    'science',
    'sports',
    'technology',
    'philosophy',
    'pop-culture',
    'food',
    'architecture',
    'language',
  ]);
  if (known.has(folded)) return folded;
  if (folded === 'film-television' || folded === 'film-tv-shows') return 'film-tv';
  if (folded === 'sport') return 'sports';
  return null;
}

/**
 * Pure tree assembly — unit-tested without a DB.
 *
 * Included graph nodes: any node that is owned or has an owned descendant via
 * substantive edges (plus the ancestor chain up to its root). Ghost siblings
 * render only inside parents the player has actually entered. Owned leaves
 * with no authored node land directly under the root — the graph starts
 * nearly empty, and every real territory must still show.
 */
export function buildKnowledgeTree(
  owned: readonly OwnedLeaf[],
  nodes: readonly AuthoredNode[],
  edges: readonly GraphEdge[],
  // P4: terminal parent masteries from the freeze ledger (§B). A frozen parent
  // reads as mastered even when roster growth or a threshold edit would place
  // today's computed value below the bar — mastery is never revoked. Empty /
  // omitted (flag off) → pure computation, P5 behavior unchanged.
  frozenParents: ReadonlySet<string> = new Set(),
): KnowledgeTreeNode {
  const nodeByKey = new Map(nodes.map((n) => [n.domainKey, n]));
  const ownedByKey = new Map(owned.map((leaf) => [domainKey(leaf.domain), leaf]));

  const substantive = edges.filter((e) => e.edgeType === 'substantive');
  // §E home-parent: the FIRST substantive edge is the containment edge.
  const homeParentByChild = new Map<string, string>();
  const homeChildrenByParent = new Map<string, string[]>();
  for (const edge of substantive) {
    if (homeParentByChild.has(edge.childDomainKey)) continue;
    if (!nodeByKey.has(edge.childDomainKey) || !nodeByKey.has(edge.parentDomainKey)) continue;
    homeParentByChild.set(edge.childDomainKey, edge.parentDomainKey);
    const list = homeChildrenByParent.get(edge.parentDomainKey);
    if (list) list.push(edge.childDomainKey);
    else homeChildrenByParent.set(edge.parentDomainKey, [edge.childDomainKey]);
  }

  // Full-value totals for parent mastery (§5.1) — ghosts contribute nothing
  // because only owned points enter the credit map.
  const credits = new Map<string, number>();
  for (const [key, leaf] of ownedByKey) {
    if (leaf.points > 0) credits.set(key, leaf.points);
  }
  const totals = rollUpCredit(credits, edges);

  // A graph node is "held" if it or any home-descendant is owned.
  const heldMemo = new Map<string, boolean>();
  const isHeld = (key: string): boolean => {
    const memo = heldMemo.get(key);
    if (memo !== undefined) return memo;
    heldMemo.set(key, false); // cycle guard
    const own = ownedByKey.has(key);
    const viaChildren = (homeChildrenByParent.get(key) ?? []).some((child) => isHeld(child));
    const held = own || viaChildren;
    heldMemo.set(key, held);
    return held;
  };

  const buildGraphNode = (key: string): KnowledgeTreeNode | null => {
    const node = nodeByKey.get(key);
    if (!node) return null;
    const ownedLeaf = ownedByKey.get(key);
    const roster = homeChildrenByParent.get(key) ?? [];

    const children: KnowledgeTreeNode[] = [];
    for (const childKey of roster) {
      if (isHeld(childKey)) {
        const built = buildGraphNode(childKey);
        if (built) children.push(built);
      } else {
        // Unheld sibling → ghost: dashed, footprint-only, zero real points.
        const childNode = nodeByKey.get(childKey);
        if (childNode) {
          children.push({
            id: childNode.domainKey,
            name: childNode.label,
            field: childNode.fieldHue ?? hueForBroadCategory(childNode.broadCategory),
            value: GHOST_FOOTPRINT,
            ghost: true,
          });
        }
      }
    }

    // Mastery grain (§D): leaf-exact for owned leaves; threshold + ≥2 corners
    // for parents — with the P4 freeze winning before recomputation (§B).
    // A 'both' node can be leaf-mastered on its own points.
    const isParentKind = node.nodeKind !== 'leaf' && children.length > 0;
    const parentMastered = isParentKind
      ? frozenParents.has(key) ||
        parentProgress(totals.get(key) ?? 0, litCorners(key, totals, edges), node.masteryThreshold)
          .isMaster
      : false;
    const mastered = Boolean(ownedLeaf?.mastered) || parentMastered;

    return {
      id: key,
      name: node.label,
      field: node.fieldHue ?? hueForBroadCategory(node.broadCategory ?? ownedLeaf?.broadCategory ?? null),
      ...(ownedLeaf && ownedLeaf.points > 0 ? { value: ownedLeaf.points } : {}),
      ...(mastered ? { mastered: true } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };

  const rootChildren: KnowledgeTreeNode[] = [];

  // Graph roots: held nodes with no home parent.
  const graphRootKeys = [...nodeByKey.keys()].filter(
    (key) => !homeParentByChild.has(key) && isHeld(key),
  );
  for (const key of graphRootKeys) {
    const built = buildGraphNode(key);
    if (built) rootChildren.push(built);
  }

  // Owned leaves the graph doesn't know yet — straight under the root, so the
  // map is complete even while the authored graph is sparse.
  const graphKeys = new Set(nodeByKey.keys());
  for (const [key, leaf] of ownedByKey) {
    if (graphKeys.has(key) || leaf.points <= 0) continue;
    rootChildren.push({
      id: key,
      name: leaf.domain,
      field: hueForBroadCategory(leaf.broadCategory),
      value: leaf.points,
      ...(leaf.mastered ? { mastered: true } : {}),
    });
  }

  return { id: 'root', name: 'Everything', field: null, children: rootChildren };
}

/** Sum of REAL points in a subtree — ghosts excluded (unit-test hook). */
export function sumRealPoints(node: KnowledgeTreeNode): number {
  if (node.ghost) return 0;
  const own = node.value ?? 0;
  return own + (node.children ?? []).reduce((sum, child) => sum + sumRealPoints(child), 0);
}

export async function getKnowledgeTree(userId: string): Promise<KnowledgeTreeNode> {
  const [pageData, graph] = await Promise.all([
    getKnowledgePageData(userId),
    listKnowledgeGraph(),
  ]);

  const owned: OwnedLeaf[] = pageData.allDomains
    .filter((d) => d.points > 0 && !d.isHidden)
    .map((d) => ({
      domain: d.displayName || d.domain,
      points: d.points,
      mastered: d.tier === 'mastery',
      broadCategory: d.broadCategory,
    }));

  const nodes: AuthoredNode[] = graph.nodes.map((n) => ({
    domainKey: n.domainKey,
    label: n.label,
    nodeKind: n.nodeKind,
    masteryThreshold: n.masteryThreshold,
    fieldHue: n.fieldHue,
    broadCategory: n.broadCategory,
  }));
  const edges: GraphEdge[] = graph.edges.map((e) => ({
    childDomainKey: e.childDomainKey,
    parentDomainKey: e.parentDomainKey,
    edgeType: e.edgeType,
  }));

  // P4: frozen-aware parent mastery + terminal stamping of fresh crossings.
  // Flag off → empty frozen set, no writes — P5's pure behavior.
  let frozenParents: ReadonlySet<string> = new Set();
  if (isKnowledgeGraphMasteryEnabled()) {
    const credits = new Map<string, number>();
    for (const leaf of owned) {
      if (leaf.points > 0) credits.set(domainKey(leaf.domain), leaf.points);
    }
    const totals = rollUpCredit(credits, edges);
    const parents = nodes.filter((n) => n.nodeKind !== 'leaf');
    const resolved = await getParentMasteryForUser(userId, parents, totals, edges);
    frozenParents = new Set(
      [...resolved.entries()].filter(([, entry]) => entry.isMaster).map(([key]) => key),
    );
  }

  return buildKnowledgeTree(owned, nodes, edges, frozenParents);
}
