import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { beatsPayloadSchema } from '@/server/ceremony/compute-beats';
import { getCeremonyById } from '@/server/db/queries/ceremony';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ ceremonyId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ceremonyId } = await context.params;
  const ceremony = await getCeremonyById(ceremonyId);
  if (!ceremony) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (ceremony.userId !== session.userId)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // F3.5: validate payload shape on read so a malformed JSONB doesn't
  // silently render as a blank page. We use safeParse (lenient) so we can
  // surface an explicit error to the client without throwing — the page
  // can render a recovery state. Strict validation happens at write.
  const parsed = beatsPayloadSchema.safeParse(ceremony.beatsPayload);
  if (!parsed.success) {
    console.warn('[ceremony/GET] beatsPayload failed validation', {
      ceremonyId,
      issues: parsed.error.issues,
    });
    return NextResponse.json(
      {
        error: 'payload_invalid',
        message: 'This ceremony could not be loaded due to a data issue.',
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ceremony: { ...ceremony, beatsPayload: parsed.data } });
}
