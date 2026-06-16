import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getKnowledgeBase, getTodaysDailyQueue } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { isRoundComplete, type QueueSlot } from '@/server/daily/types';
import { buildInitialFrequencyMap, type TerritoryDomain } from '@/lib/daily/territory-model';

import { TerritorySetupClient } from './TerritorySetupClient';

export const dynamic = 'force-dynamic';

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

export default async function DailySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; domainMode?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const [queue, preferences, knowledgeBase] = await Promise.all([
    getTodaysDailyQueue(session.userId),
    getDailyPreferences(session.userId),
    getKnowledgeBase(session.userId),
  ]);

  const slots = asQueueSlots(queue?.slots);
  const answered = slots.filter((slot) => slot.answered).length;
  const isComplete = queue ? isRoundComplete(slots) : false;
  // A round that's underway belongs in play, not setup.
  if (queue && !isComplete && answered > 0) redirect('/daily');

  const availableDomains: TerritoryDomain[] = knowledgeBase.map((domain) => ({
    domain: domain.domain,
    broadCategory: domain.broadCategory ?? null,
    totalPoints: domain.totalPoints,
    tier: domain.tier,
    correctAnswerCount: domain.correctAnswerCount,
  }));

  const params = await searchParams;
  const requestedDomain = params.domain?.trim();
  const requestedCustom = params.domainMode === 'custom' && requestedDomain ? requestedDomain : null;
  // A custom focus on a territory the user doesn't have yet routes to Knowledge
  // to adopt it first.
  if (
    requestedCustom &&
    !availableDomains.some(
      (domain) =>
        domain.domain.toLocaleLowerCase('en-US') === requestedCustom.toLocaleLowerCase('en-US'),
    )
  ) {
    redirect(`/knowledge?emptyDomain=${encodeURIComponent(requestedCustom)}`);
  }

  const selectedDomains = requestedCustom ? [requestedCustom] : (preferences.selectedDomains ?? []);
  const initialFrequencyByDomain = buildInitialFrequencyMap({
    domains: availableDomains,
    savedFrequency: requestedCustom ? null : (preferences.domainPreferenceFrequency ?? null),
    selectedDomains,
    domainMode: requestedCustom ? 'custom' : (preferences.domainMode ?? 'random'),
  });

  return (
    <TerritorySetupClient
      initialDomains={availableDomains}
      initialDifficulty={preferences.difficulty ?? 'adaptive'}
      initialFrequencyByDomain={initialFrequencyByDomain}
    />
  );
}
