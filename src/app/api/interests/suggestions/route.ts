import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { getCatalogSuggestions } from '@/server/db/queries/suggestion-catalog';
import { buildSuggestionPool } from '@/lib/knowledge/suggestion-pool';
import { domainKey } from '@/lib/knowledge/domain-key';

export const dynamic = 'force-dynamic';

// Suggestion pool for the "Add a topic" surfaces. Fetched client-side after
// mount (like /api/daily/status) so it never sits on the home critical path.
// Two sources, merged: the knowledge tree's direct unheld siblings (fast,
// hand-authored graph — buildSuggestionPool), and the real question catalog
// under the player's own broad categories (getCatalogSuggestions) — a much
// larger space than the graph alone, so suggestions don't dry up to the same
// small set once the tree-adjacent candidates are exhausted. The client
// shuffles/rotates and shows a few at a time, with add / undo per circle.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [{ tree, ownedDomains }, declared] = await Promise.all([
    getKnowledgeMapData(session.userId),
    getActiveDeclaredInterests(session.userId),
  ]);

  const ownedNames = [
    ...ownedDomains.map((domain) => domain.displayName || domain.domain),
    ...declared.map((interest) => interest.domain),
  ];
  const ownedKeys = new Set(ownedNames.map(domainKey));
  const broadCategories = [
    ...new Set(
      [...ownedDomains, ...declared]
        .map((entry) => entry.broadCategory?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const treeSuggestions = buildSuggestionPool(tree, ownedNames);
  const merged = new Map(treeSuggestions.map((suggestion) => [domainKey(suggestion.domain), suggestion]));
  const catalogSuggestions = await getCatalogSuggestions(broadCategories, new Set([...ownedKeys, ...merged.keys()]));
  for (const suggestion of catalogSuggestions) {
    merged.set(domainKey(suggestion.domain), { ...suggestion, reason: 'From your categories' });
  }

  return NextResponse.json({ suggestions: [...merged.values()] });
}
