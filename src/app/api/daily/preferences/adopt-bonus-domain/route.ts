import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { adoptBonusDomain } from '@/server/mastery/write-mastery-event';
import { setDomainFrequency } from '@/server/daily/set-domain-frequency';

export const dynamic = 'force-dynamic';

// Never/'resting' isn't accepted here — that's the "Not now" branch of the
// ask-before-add prompt, which makes no call at all (nothing was persisted to
// undo). Only a real "yes" reaches this endpoint.
const bodySchema = z.object({
  domain: z.string().trim().min(1),
  frequency: z.enum(['often', 'sometimes', 'blue_moon']),
  broadCategory: z.string().trim().min(1).nullish(),
});

/**
 * Ask-before-add confirm endpoint for a Daily Five +2 bonus domain
 * (B-DOMAIN-BONUS-ROTATION-01). writeMasteryEvent deliberately does NOT write
 * a PLAYER_MASTERY row when a bonus answer opens a brand-new territory — the
 * "Add {domain} to your topics?" reveal card calls this only once the player
 * picks a frequency, at which point the row is created for the first time and
 * tagged with that frequency in one request.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: 'domain and a non-Never frequency are required' },
      { status: 400 },
    );
  }
  const { domain, frequency, broadCategory } = parsed.data;

  const adopted = await adoptBonusDomain({ userId: session.userId, domain, broadCategory });
  const result = await setDomainFrequency(session.userId, adopted.domain, frequency);

  return NextResponse.json({ ok: true, ...result });
}
