import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getKnowledgeBase } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { buildInitialFrequencyMap, type TerritoryDomain } from '@/lib/daily/territory-model';

import { TerritorySetupClient } from './TerritorySetupClient';

export const dynamic = 'force-dynamic';

// The dedicated "manage your topics" page (Josh, 2026-07-17): un-retired from
// the /knowledge redirect stub. This is the separate surface for adding topics
// (with nearby suggestions), setting how often each comes up, and throwing ones
// out — deliberately NOT the /knowledge portrait, which stays the read-only
// "your mind" view with the shareable modules. Existing links already point
// here (the daily-reminder email's manage-interests URL, the refine flow's
// ADD_TERRITORIES_HREF); they now land on the real page instead of redirecting.
export default async function DailySetupPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [preferences, knowledgeBase] = await Promise.all([
    getDailyPreferences(session.userId),
    getKnowledgeBase(session.userId),
  ]);

  const availableDomains: TerritoryDomain[] = knowledgeBase.map((domain) => ({
    domain: domain.domain,
    broadCategory: domain.broadCategory ?? null,
    totalPoints: domain.totalPoints,
    tier: domain.tier,
    correctAnswerCount: domain.correctAnswerCount,
  }));

  const initialFrequencyByDomain = buildInitialFrequencyMap({
    domains: availableDomains,
    savedFrequency: preferences.domainPreferenceFrequency ?? null,
    selectedDomains: preferences.selectedDomains ?? [],
    domainMode: preferences.domainMode ?? 'random',
  });

  return (
    <TerritorySetupClient
      initialDomains={availableDomains}
      initialDifficulty={preferences.difficulty ?? 'adaptive'}
      initialFrequencyByDomain={initialFrequencyByDomain}
    />
  );
}
