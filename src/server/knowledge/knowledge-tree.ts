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
  DEFAULT_PARENT_MASTERY_THRESHOLD,
  litCorners,
  parentProgress,
  rollUpCredit,
  type GraphEdge,
} from '@/server/knowledge/graph';
import {
  getParentMasteryForUser,
  isKnowledgeGraphMasteryEnabled,
} from '@/server/knowledge/parent-mastery';
import {
  getV2MasteryForUser,
  isKnowledgeMasteryV2Enabled,
} from '@/server/knowledge/mastery-v2-resolve';
import { domainKey } from '@/lib/knowledge/domain-key';

// Gap-view framing for a substantive parent (D-KNOWLEDGE-MAP-USABILITY-01 C3):
// everything here is the §9-A math the map already trusts for mastery, exposed
// so the focus header can say "6 of 9 · 1,240/2,000 pts" instead of nothing.
export type KnowledgeParentProgress = {
  /** Full-value rolled-up points (§5.1). */
  points: number;
  /** The absolute mastery bar (human-set, or the deliberate default). */
  threshold: number;
  /** Direct substantive corners with any credit. */
  corners: number;
  /** Home-roster children the player holds (directly or via descendants). */
  rosterCovered: number;
  rosterSize: number;
};

export type KnowledgeTreeNode = {
  id: string;
  name: string;
  field: string | null;
  value?: number;
  mastered?: boolean;
  ghost?: boolean;
  progress?: KnowledgeParentProgress;
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
const KNOWN_HUES = [
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
] as const;
const KNOWN_HUE_SET: ReadonlySet<string> = new Set(KNOWN_HUES);

export function hueForBroadCategory(broadCategory: string | null): string | null {
  if (!broadCategory) return null;
  const folded = broadCategory.trim().toLowerCase().replace(/\s*&\s*|\s+/g, '-');
  if (KNOWN_HUE_SET.has(folded)) return folded;
  if (folded === 'film-television' || folded === 'film-tv-shows') return 'film-tv';
  if (folded === 'sport') return 'sports';
  // A broad category outside the mapped set used to fall through to null →
  // the gray --brand-ink-400 fallback, which reads as "disabled" when several
  // large bubbles land there. Assign a stable hue from the scale instead;
  // the label still carries the meaning (hue never does alone).
  if (!folded) return null;
  let hash = 0;
  for (let i = 0; i < folded.length; i += 1) hash = (hash * 31 + folded.charCodeAt(i)) >>> 0;
  return KNOWN_HUES[hash % KNOWN_HUES.length];
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
export type BuildTreeOptions = {
  /**
   * Ghosts + grow-rim are OWN-map affordances (tap-to-adopt). A friend's map
   * is read-only: false renders only what they actually hold — no invitations
   * on someone else's behalf.
   */
  includeGhosts?: boolean;
  /**
   * Mastery v2 (KNOWLEDGE_MASTERY_V2): the set of AUTHORED node keys mastered
   * under the depth-weighted read-model (leaf ≥ bar / frozen, or parent ≥ 75%
   * coverage). When present it REPLACES the v1 per-node master badge
   * (leaf-tier + parentProgress). Un-authored owned leaves (rendered under the
   * root) keep their v1 leaf-tier badge — v2 only knows authored nodes.
   */
  masteredOverride?: ReadonlySet<string>;
};

export function buildKnowledgeTree(
  owned: readonly OwnedLeaf[],
  nodes: readonly AuthoredNode[],
  edges: readonly GraphEdge[],
  // P4: terminal parent masteries from the freeze ledger (§B). A frozen parent
  // reads as mastered even when roster growth or a threshold edit would place
  // today's computed value below the bar — mastery is never revoked. Empty /
  // omitted (flag off) → pure computation, P5 behavior unchanged.
  frozenParents: ReadonlySet<string> = new Set(),
  options: BuildTreeOptions = {},
): KnowledgeTreeNode {
  const includeGhosts = options.includeGhosts ?? true;
  const nodeByKey = new Map(nodes.map((n) => [n.domainKey, n]));
  const ownedByKey = new Map(owned.map((leaf) => [domainKey(leaf.domain), leaf]));

  // §E home-parent: the FIRST edge is the containment edge (every edge is
  // depth-eligible since the collection type was dropped 2026-07-04).
  const substantive = edges;
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
      } else if (includeGhosts) {
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
    const corners = isParentKind ? litCorners(key, totals, edges) : 0;
    const parentMastered = isParentKind
      ? frozenParents.has(key) ||
        parentProgress(totals.get(key) ?? 0, corners, node.masteryThreshold).isMaster
      : false;
    // v2 (when the override is present) owns the master badge for authored nodes;
    // otherwise the v1 grain (leaf-tier OR parent threshold+corners) stands.
    const mastered = options.masteredOverride
      ? options.masteredOverride.has(key)
      : Boolean(ownedLeaf?.mastered) || parentMastered;

    // Gap-view framing (C3) — the same numbers the mastery call just used,
    // surfaced so the map can say "6 of 9 · 1,240/2,000 pts" on focus.
    const progress: KnowledgeParentProgress | undefined = isParentKind
      ? {
          points: Math.round(totals.get(key) ?? 0),
          threshold: node.masteryThreshold ?? DEFAULT_PARENT_MASTERY_THRESHOLD,
          corners,
          rosterCovered: roster.filter((childKey) => isHeld(childKey)).length,
          rosterSize: roster.length,
        }
      : undefined;

    return {
      id: key,
      name: node.label,
      field: node.fieldHue ?? hueForBroadCategory(node.broadCategory ?? ownedLeaf?.broadCategory ?? null),
      ...(ownedLeaf && ownedLeaf.points > 0 ? { value: ownedLeaf.points } : {}),
      ...(mastered ? { mastered: true } : {}),
      ...(progress ? { progress } : {}),
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

  // The GROW RIM: unheld authored ROOTS in fields the player already inhabits,
  // rendered as ghost invitations at the home view — the wider world beyond
  // what they hold, without promising unbuilt areas (only authored nodes ever
  // appear). Capped so the rim stays an edge, not a crowd. Own-map only.
  if (includeGhosts) {
    const heldFields = new Set(
      rootChildren.map((child) => child.field).filter((f): f is string => Boolean(f)),
    );
    const rimCandidates = [...nodeByKey.values()].filter((node) => {
      if (homeParentByChild.has(node.domainKey) || isHeld(node.domainKey)) return false;
      const field = node.fieldHue ?? hueForBroadCategory(node.broadCategory);
      return field !== null && heldFields.has(field);
    });
    for (const node of rimCandidates.slice(0, GROW_RIM_CAP)) {
      rootChildren.push({
        id: node.domainKey,
        name: node.label,
        field: node.fieldHue ?? hueForBroadCategory(node.broadCategory),
        value: GHOST_FOOTPRINT,
        ghost: true,
      });
    }
  }

  return { id: 'root', name: 'Everything', field: null, children: rootChildren };
}

// The rim invites, it doesn't crowd — at most this many unheld roots at home.
export const GROW_RIM_CAP = 3;

// collectCollections / CollectionSummary removed 2026-07-04 (migration 0110):
// the collection edge type is gone, so there is no coverage strip.

/** Sum of REAL points in a subtree — ghosts excluded (unit-test hook). */
export function sumRealPoints(node: KnowledgeTreeNode): number {
  if (node.ghost) return 0;
  const own = node.value ?? 0;
  return own + (node.children ?? []).reduce((sum, child) => sum + sumRealPoints(child), 0);
}

export type KnowledgeMapData = {
  tree: KnowledgeTreeNode;
  /** The owned, visible domains behind the tree — reused for share-card props. */
  ownedDomains: Array<{
    domain: string;
    displayName: string;
    points: number;
    tier: string;
    iconKey: string;
    broadCategory: string | null;
  }>;
};

// The full map payload for a user. `includeGhosts: false` is the friend/read-
// only variant: what they hold, nothing tap-to-adopt. Hidden domains are
// excluded for BOTH variants (the map is a portrait surface, same posture as
// the flat page's portrait grid).
export async function getKnowledgeMapData(
  userId: string,
  options: BuildTreeOptions = {},
): Promise<KnowledgeMapData> {
  const [pageData, graph] = await Promise.all([
    getKnowledgePageData(userId),
    listKnowledgeGraph(),
  ]);

  const visible = pageData.allDomains.filter((d) => d.points > 0 && !d.isHidden);
  const owned: OwnedLeaf[] = visible.map((d) => ({
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
  }));

  let frozenParents: ReadonlySet<string> = new Set();
  let masteredOverride: ReadonlySet<string> | undefined;
  if (isKnowledgeMasteryV2Enabled()) {
    // v2 read path: depth-weighted coverage over the containment tree. Overrides
    // the per-node master badge; the v1 gap-view numbers still frame the focus
    // header for now (a v2 coverage framing is a follow-up). Reachable-supply cap
    // is not yet wired, so the leaf bar is uncapped depth (also a follow-up).
    const v2Nodes = graph.nodes.map((n) => ({
      domainKey: n.domainKey,
      nodeKind: n.nodeKind,
      nodeWeight: n.nodeWeight,
    }));
    const pointsByKey = new Map<string, number>();
    for (const leaf of owned) pointsByKey.set(domainKey(leaf.domain), leaf.points);
    const v2 = await getV2MasteryForUser(userId, v2Nodes, edges, pointsByKey);
    const mastered = new Set<string>();
    for (const [key, leaf] of v2.leaves) if (leaf.isMaster) mastered.add(key);
    for (const [key, parent] of v2.parents) if (parent.isMaster) mastered.add(key);
    masteredOverride = mastered;
  } else if (isKnowledgeGraphMasteryEnabled()) {
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

  return {
    tree: buildKnowledgeTree(owned, nodes, edges, frozenParents, { ...options, masteredOverride }),
    ownedDomains: visible.map((d) => ({
      domain: d.domain,
      displayName: d.displayName || d.domain,
      points: d.points,
      tier: d.tier,
      iconKey: d.iconKey,
      broadCategory: d.broadCategory,
    })),
  };
}

export async function getKnowledgeTree(userId: string): Promise<KnowledgeTreeNode> {
  return (await getKnowledgeMapData(userId)).tree;
}
