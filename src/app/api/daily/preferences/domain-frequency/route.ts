import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { TERRITORY_FREQUENCIES, type TerritoryFrequency } from '@/lib/daily/territory-model';
import { getKnowledgeBase, invalidateUntouchedDailyQueues } from '@/server/db/queries/daily';
import { getDailyPreferences, updateDailyPreferences } from '@/server/db/queries/daily-preferences';

export const dynamic = 'force-dynamic';

// `frequency: null` clears any explicit preference, restoring the domain to its
// default rotation — that's how the reveal-card "Undo" steps back to the stage
// before it was moved to "Once in a Blue Moon".
const bodySchema = z.object({
  domain: z.string().trim().min(1),
  frequency: z.enum(TERRITORY_FREQUENCIES).nullable(),
});

// Set a single domain's Daily Five frequency without the caller needing the full
// preference map. Used by the new-territory reveal card to nudge a freshly-opened
// domain into "Once in a Blue Moon" (and to undo it). Merges server-side so a
// targeted change can't clobber the rest of the user's frequency choices.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: 'domain and frequency are required' },
      { status: 400 },
    );
  }
  const { domain, frequency } = parsed.data;

  const [preferences, knowledgeBase] = await Promise.all([
    getDailyPreferences(session.userId),
    getKnowledgeBase(session.userId),
  ]);

  const domainKey = domain.toLowerCase();
  const matched =
    knowledgeBase.map((entry) => entry.domain).find((d) => d.toLowerCase() === domainKey) ?? domain;

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

  const updated = await updateDailyPreferences(session.userId, {
    domainPreferenceFrequency: nextFrequencyByDomain,
  });

  // Frequency is a question-defining input, so drop untouched pre-built queues;
  // the next /api/daily/queue POST regenerates from the new preference. Mirrors
  // the PATCH handler in ../route.ts. In-progress rounds are left intact.
  await invalidateUntouchedDailyQueues(session.userId);

  return NextResponse.json({
    ok: true,
    domain: matched,
    frequency,
    previousFrequency,
    domainPreferenceFrequency: updated.domainPreferenceFrequency,
  });
}
