import { redirect } from 'next/navigation';

import { KnowledgeFlatClient } from '../../knowledge/KnowledgeFlatClient';
import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { getFullyExploredDomains } from '@/server/knowledge/fully-explored';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';

export const dynamic = 'force-dynamic';

// The dedicated "manage your topics" page (Josh, 2026-07-17): un-retired from
// the /knowledge redirect stub. It reuses the /knowledge portrait format (the
// same Domain/Mastery/Frequency circles and the tap-a-circle detail pop-up that
// changes frequency, adds a related topic, or removes it) via the `manage`
// variant — no shareable modules, and the add-topics field lifted to the top.
// Existing links already point here (the daily-reminder email's manage-interests
// URL, the refine flow's ADD_TERRITORIES_HREF); they now land on the real page.
export default async function DailySetupPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [{ tree }, preferences, fullyExplored] = await Promise.all([
    getKnowledgeMapData(session.userId),
    getDailyPreferences(session.userId),
    getFullyExploredDomains(session.userId),
  ]);

  return (
    <KnowledgeFlatClient
      variant="manage"
      tree={tree}
      frequencyByDomain={preferences.domainPreferenceFrequency}
      fullyExploredDomains={fullyExplored}
    />
  );
}
