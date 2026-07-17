import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { buildSuggestionPool } from '@/lib/knowledge/suggestion-pool';

export const dynamic = 'force-dynamic';

// Suggestion pool for the "Add a topic" surfaces. Fetched client-side after
// mount (like /api/daily/status) so it never sits on the home critical path.
// Returns the related-but-specific topics the player doesn't already hold; the
// client shuffles and shows a few, with add / "not for me" per circle.
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

  return NextResponse.json({ suggestions: buildSuggestionPool(tree, ownedNames) });
}
