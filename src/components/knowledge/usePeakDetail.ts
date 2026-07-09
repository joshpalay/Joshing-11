'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';
import { adoptDomain } from '@/components/knowledge/adopt';
import type { DomainPreferenceFrequency, TerritoryFrequency } from '@/lib/daily/territory-model';

// A peaks leaf's `node.name` === its `canonicalSubcategory`, which is exactly the
// key `domainPreferenceFrequency` stores — matched case-insensitively, just like
// the domain-frequency route. Normalize both sides the same way to resolve it.
export function freqKey(name: string): string {
  return name.trim().toLowerCase();
}

// Decision A: a leaf with no explicit preference shows its actual effective
// default. For an owned peak that's `'sometimes'` ("Sometimes") — the rotation
// it's already in — so the face is truthful, not blank.
export const DEFAULT_FREQUENCY: TerritoryFrequency = 'sometimes';

export type PeakDetailController = {
  tree: KnowledgeTreeNode;
  setTree: Dispatch<SetStateAction<KnowledgeTreeNode>>;
  resolveFrequency: (name: string) => TerritoryFrequency;
  setFrequency: (name: string, frequency: TerritoryFrequency) => Promise<boolean>;
  adoptNode: (id: string, name: string) => Promise<boolean>;
};

// Shared state controller for the knowledge peaks detail sheet: it owns the
// optimistic tree, the per-leaf rotation map (seeded from the server preference),
// and the two writes the sheet performs — set-frequency and adopt. Extracted so
// both the peaks circle grid (KnowledgePeaksView) and the flat portrait page
// (KnowledgeFlatClient) can mount the same PeakDetailCard against one behavior.
export function usePeakDetail(
  initialTree: KnowledgeTreeNode,
  frequencyByDomain: DomainPreferenceFrequency = {},
): PeakDetailController {
  const [tree, setTree] = useState<KnowledgeTreeNode>(initialTree);

  // Optimistic frequency map, keyed by normalized domain. Seeded from the server
  // preference and updated in place on write, so the face pill and detail sheet
  // reflect the change before the next round rebuilds.
  const [freqMap, setFreqMap] = useState<Record<string, TerritoryFrequency>>(() => {
    const seeded: Record<string, TerritoryFrequency> = {};
    for (const [domain, frequency] of Object.entries(frequencyByDomain)) {
      seeded[freqKey(domain)] = frequency;
    }
    return seeded;
  });

  const resolveFrequency = useCallback(
    (name: string): TerritoryFrequency => freqMap[freqKey(name)] ?? DEFAULT_FREQUENCY,
    [freqMap],
  );

  // Optimistic write: flip local state, POST the single-domain change, revert on
  // failure. The route merges server-side and drops untouched Daily Five queues.
  const setFrequency = useCallback(
    async (name: string, frequency: TerritoryFrequency): Promise<boolean> => {
      const key = freqKey(name);
      const previous = freqMap[key];
      setFreqMap((prev) => ({ ...prev, [key]: frequency }));
      try {
        const res = await fetch('/api/daily/preferences/domain-frequency', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ domain: name, frequency }),
        });
        if (!res.ok) throw new Error('frequency update failed');
        return true;
      } catch {
        setFreqMap((prev) => {
          const next = { ...prev };
          if (previous === undefined) delete next[key];
          else next[key] = previous;
          return next;
        });
        return false;
      }
    },
    [freqMap],
  );

  // Optimistic confirmed add: flip the target into a real, owned node so it jumps
  // from "add next" to held; revert on failure. Mirrors the bubble map. Restore
  // the node's ACTUAL prior state on failure — an unheld sibling falls back to a
  // ghost, but an already-held container adopted from "Part of" was never a ghost
  // and must not become one.
  const adoptNode = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const findPrior = (
        subtree: KnowledgeTreeNode,
      ): { ghost?: boolean; value?: number } | null => {
        if (subtree.id === id) return { ghost: subtree.ghost, value: subtree.value };
        for (const child of subtree.children ?? []) {
          const found = findPrior(child);
          if (found) return found;
        }
        return null;
      };
      const prior = findPrior(tree) ?? { ghost: true, value: 40 };
      const setNode = (
        subtree: KnowledgeTreeNode,
        next: { ghost?: boolean; value?: number },
      ): KnowledgeTreeNode =>
        subtree.id === id
          ? { ...subtree, ghost: next.ghost || undefined, value: next.value }
          : { ...subtree, children: subtree.children?.map((c) => setNode(c, next)) };
      setTree((prev) => setNode(prev, { ghost: false, value: 1 }));
      const ok = await adoptDomain(name);
      if (!ok) setTree((prev) => setNode(prev, prior));
      return ok;
    },
    [tree],
  );

  return { tree, setTree, resolveFrequency, setFrequency, adoptNode };
}
