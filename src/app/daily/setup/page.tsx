import { redirect } from 'next/navigation';

import { KnowledgeFlatClient } from '../../knowledge/KnowledgeFlatClient';
import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { getFullyExploredDomains } from '@/server/knowledge/fully-explored';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { isMissedReturnEnabledForUser } from '@/server/db/queries/missed-return';
import { MissedReturnSection } from './MissedReturnSection';

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

  // D-MISSED-RETURN-01 §7-D: the returning-questions toggle lives here, on the
  // page that already owns Daily Five tuning, rather than on a net-new route
  // (R11, revised). It goes through `manageExtra` so it renders near the TOP —
  // as a sibling it landed below the Done button, stranded past the page's own
  // terminal action (Josh, 2026-08-10).
  const [{ tree }, preferences, fullyExplored, returnEnabled] = await Promise.all([
    getKnowledgeMapData(session.userId),
    getDailyPreferences(session.userId),
    getFullyExploredDomains(session.userId),
    isMissedReturnEnabledForUser(session.userId),
  ]);

  return (
    <KnowledgeFlatClient
      variant="manage"
      tree={tree}
      frequencyByDomain={preferences.domainPreferenceFrequency}
      fullyExploredDomains={fullyExplored}
      manageExtra={<MissedReturnSection initialEnabled={returnEnabled} />}
    />
  );
}
