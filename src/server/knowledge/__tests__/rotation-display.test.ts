import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db/queries/daily', () => ({ getKnowledgeBase: vi.fn() }));

import { heldLeafNames, parkedLeafDomains } from '@/server/knowledge/rotation-display';
import type { KnowledgeTreeNode } from '@/server/knowledge/knowledge-tree';

const tree: KnowledgeTreeNode = {
  id: 'root',
  name: 'root',
  field: null,
  children: [
    {
      id: 'geo',
      name: 'Geography',
      field: 'Geography',
      children: [
        { id: 'aus', name: 'Australian Geography', field: 'Geography', value: 10 },
        { id: 'caps', name: 'US State Capitals', field: 'Geography', ghost: true, value: 40 },
      ],
    },
    { id: 'auto', name: 'American Auto History', field: null, value: 10 },
  ],
};

describe('rotation display (QA 2026-09-27, S2)', () => {
  it('lists only held leaves — not the root, parents or ghosts', () => {
    expect(heldLeafNames(tree)).toEqual(['Australian Geography', 'American Auto History']);
  });

  it('marks a held leaf the Daily Five does not draw from as parked', () => {
    // A bonus-opened topic answered "Not now" has no knowledge-base row.
    expect(parkedLeafDomains(heldLeafNames(tree), ['australian geography'])).toEqual([
      'American Auto History',
    ]);
  });

  it('matches names through the same casing the page labels use', () => {
    expect(parkedLeafDomains(['US State Capitals'], ['us state capitals'])).toEqual([]);
  });
});
