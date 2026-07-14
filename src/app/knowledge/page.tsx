import { redirect } from 'next/navigation';

import { KnowledgeFlatClient } from './KnowledgeFlatClient';
import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { getFullyExploredDomains } from '@/server/knowledge/fully-explored';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';

export const dynamic = 'force-dynamic';

// The knowledge page is the flat portrait ("previous") view only (Josh,
// 2026-07-14). The ?view= switcher and its alternates — the "peaks" gallery
// (KnowledgePeaksPage) and the nested circle-pack map (KnowledgeBubblePage) —
// are retired from routing but kept on disk in case a view is revived; any
// ?view= param is simply ignored.
export default async function KnowledgePage() {
  // The flat portrait still self-loads /api/knowledge, but the per-circle
  // frequency word and the tapped-circle detail pop-up need the knowledge
  // tree + rotation preferences. Fetch them here and thread them in — an
  // additive read, no change to the portrait's own load.
  const session = await getSession();
  if (!session) redirect('/login');

  const [{ tree }, preferences, fullyExplored] = await Promise.all([
    getKnowledgeMapData(session.userId),
    getDailyPreferences(session.userId),
    getFullyExploredDomains(session.userId),
  ]);

  return (
    <KnowledgeFlatClient
      tree={tree}
      frequencyByDomain={preferences.domainPreferenceFrequency}
      fullyExploredDomains={fullyExplored}
    />
  );
}
