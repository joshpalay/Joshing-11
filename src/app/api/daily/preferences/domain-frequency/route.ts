import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { TERRITORY_FREQUENCIES } from '@/lib/daily/territory-model';
import { setDomainFrequency } from '@/server/daily/set-domain-frequency';

export const dynamic = 'force-dynamic';

// `frequency: null` clears any explicit preference, restoring the domain to its
// default rotation — that's how the reveal-card "Undo" steps back to the stage
// before it was moved to "Once in a Blue Moon".
const bodySchema = z.object({
  domain: z.string().trim().min(1),
  frequency: z.enum(TERRITORY_FREQUENCIES).nullable(),
});

// Set a single domain's Daily Five frequency without the caller needing the
// full preference map. Used by the new-territory reveal card to nudge a freshly-opened
// domain into "Once in a Blue Moon" (and to undo it).
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

  const result = await setDomainFrequency(session.userId, domain, frequency);

  return NextResponse.json({ ok: true, ...result });
}
