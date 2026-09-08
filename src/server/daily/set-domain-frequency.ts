import { TERRITORY_FREQUENCIES, type TerritoryFrequency } from '@/lib/daily/territory-model';
import { getKnowledgeBase, invalidateUntouchedDailyQueues } from '@/server/db/queries/daily';
import { getDailyPreferences, updateDailyPreferences } from '@/server/db/queries/daily-preferences';

export { TERRITORY_FREQUENCIES };

export type SetDomainFrequencyResult = {
  domain: string;
  frequency: TerritoryFrequency | null;
  previousFrequency: TerritoryFrequency | null;
  domainPreferenceFrequency: Record<string, TerritoryFrequency>;
};

/**
 * Set a single domain's Daily Five frequency without the caller needing the
 * full preference map. Merges server-side so a targeted change can't clobber
 * the rest of the user's frequency choices. Shared by the frequency-only
 * endpoint (`/api/daily/preferences/domain-frequency`, used by the reveal
 * card's Often/Sometimes/Blue Moon/Never dial and its Undo) and the
 * ask-before-add bonus-domain confirm endpoint
 * (`/api/daily/preferences/adopt-bonus-domain`), which calls this immediately
 * after creating the knowledge-base row so the chosen frequency lands in the
 * same request as the add.
 */
export async function setDomainFrequency(
  userId: string,
  rawDomain: string,
  frequency: TerritoryFrequency | null,
): Promise<SetDomainFrequencyResult> {
  const [preferences, knowledgeBase] = await Promise.all([
    getDailyPreferences(userId),
    getKnowledgeBase(userId),
  ]);

  const domainKey = rawDomain.toLowerCase();
  const matched =
    knowledgeBase.map((entry) => entry.domain).find((d) => d.toLowerCase() === domainKey) ?? rawDomain;

  // Capture the prior value (case-insensitively) so the client can offer a true
  // revert, then rebuild the map dropping any case variants of this domain.
  let previousFrequency: TerritoryFrequency | null = null;
  const nextFrequencyByDomain: Record<string, TerritoryFrequency> = {};
  for (const [existingDomain, existingFrequency] of Object.entries(
    preferences.domainPreferenceFrequency,
  )) {
    if (existingDomain.toLowerCase() === domainKey) {
      previousFrequency = existingFrequency;
      continue;
    }
    nextFrequencyByDomain[existingDomain] = existingFrequency;
  }
  if (frequency) nextFrequencyByDomain[matched] = frequency;

  // Keep selectedDomains in lockstep for custom-mode players. The territory-
  // setup save derives selectedDomains = every tagged, non-rested domain; this
  // endpoint must preserve that invariant or a domain rested here keeps
  // competing for daily slots via the stale list (observed in prod 2026-07-12:
  // two rested domains held ~6 core slots in a week). Resting removes the
  // domain from the list; tagging it with any active frequency — or undoing a
  // rest back to the default — restores it, provided it's a real KB domain.
  let nextSelectedDomains: string[] | undefined;
  if (preferences.domainMode === 'custom') {
    const inSelection = preferences.selectedDomains.some(
      (existing) => existing.toLowerCase() === domainKey,
    );
    if (frequency === 'resting' && inSelection) {
      nextSelectedDomains = preferences.selectedDomains.filter(
        (existing) => existing.toLowerCase() !== domainKey,
      );
    } else if (frequency !== 'resting' && !inSelection) {
      const isKnownDomain = knowledgeBase.some(
        (entry) => entry.domain.toLowerCase() === domainKey,
      );
      const shouldRestore = frequency !== null || previousFrequency === 'resting';
      if (isKnownDomain && shouldRestore) {
        nextSelectedDomains = [...preferences.selectedDomains, matched];
      }
    }
  }

  const updated = await updateDailyPreferences(userId, {
    domainPreferenceFrequency: nextFrequencyByDomain,
    ...(nextSelectedDomains ? { selectedDomains: nextSelectedDomains } : {}),
  });

  // Frequency is a question-defining input, so drop untouched pre-built queues;
  // the next /api/daily/queue POST regenerates from the new preference.
  // In-progress rounds are left intact.
  await invalidateUntouchedDailyQueues(userId);

  return {
    domain: matched,
    frequency,
    previousFrequency,
    domainPreferenceFrequency: updated.domainPreferenceFrequency,
  };
}
