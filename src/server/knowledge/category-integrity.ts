import { domainKey } from '@/lib/knowledge/domain-key';

export type CountedLabel = { label: string; rows: number };
export type KeyedLabel = { label: string; key: string | null; rows: number };
export type CategoryNode = { label: string; domainKey: string };
export type CategoryEdge = { childDomainKey: string; parentDomainKey: string };
export type RecentMerge = { sources: string[]; target: string };

/** Pure analysis behind the read-only nightly report. Similar names with
 * different keys are deliberately not treated as duplicates: they may be
 * separate works, eras, or a parent and child. */
export function analyzeCategoryIntegrity(input: {
  labels: readonly CountedLabel[];
  bankLabels: readonly KeyedLabel[];
  nodes: readonly CategoryNode[];
  edges: readonly CategoryEdge[];
  recentMerges?: readonly RecentMerge[];
}) {
  const groups = new Map<string, Map<string, number>>();
  for (const { label, rows } of input.labels) {
    const key = domainKey(label);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(label, (spellings.get(label) ?? 0) + rows);
    groups.set(key, spellings);
  }
  const splitKeys = [...groups.entries()]
    // "Other" is a catchall bucket, not a knowledge topic to merge.
    .filter(([key, spellings]) => key !== 'other' && spellings.size > 1)
    .map(([key, spellings]) => ({
      key,
      labels: [...spellings.entries()].map(([label, rows]) => ({ label, rows })),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const nodeKeys = new Set(input.nodes.map((node) => node.domainKey));
  const nodeKeyMismatches = input.nodes.filter((node) => domainKey(node.label) !== node.domainKey);
  const orphanEdges = input.edges.filter(
    (edge) => !nodeKeys.has(edge.childDomainKey) || !nodeKeys.has(edge.parentDomainKey),
  );
  const bankKeyMismatches = input.bankLabels.filter((row) => domainKey(row.label) !== row.key);
  const graphSourceMerges = (input.recentMerges ?? []).flatMap((merge) =>
    merge.sources
      .filter((source) => nodeKeys.has(domainKey(source)) && domainKey(source) !== domainKey(merge.target))
      .map((source) => ({ source, target: merge.target })),
  );

  const parentsByChild = new Map<string, string[]>();
  for (const edge of input.edges) {
    parentsByChild.set(edge.childDomainKey, [...(parentsByChild.get(edge.childDomainKey) ?? []), edge.parentDomainKey]);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let hasCycle = false;
  function visit(key: string): void {
    if (visiting.has(key)) { hasCycle = true; return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const parent of parentsByChild.get(key) ?? []) visit(parent);
    visiting.delete(key);
    visited.add(key);
  }
  for (const node of input.nodes) visit(node.domainKey);

  return { splitKeys, nodeKeyMismatches, orphanEdges, bankKeyMismatches, graphSourceMerges, hasCycle };
}
