import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { estimateDomainSize, SIZE_CEIL } from '@/server/daily/domain-size-estimate';
import {
  getDepthEstimates,
  setManualEstimate,
  upsertCorpusSizeEstimate,
} from '@/server/db/queries/domain-depth-estimate';

export const dynamic = 'force-dynamic';

// Admin actions for the /admin/supply dashboard (0119 follow-up to
// D-SUPPLY-FINITENESS-01 #5, which shipped the dashboard read-only):
//  - resize:       re-run the corpus resolver (Haiku + Wikipedia/Wikidata/Fandom)
//                  for one domain and upsert the refreshed corpus estimate. The
//                  label fed to the resolver is the row's stored sample_label —
//                  never client input.
//  - set_estimate: write the manual override (manual_estimated_questions); it
//                  wins over the corpus estimate everywhere and is never touched
//                  by resolver re-runs or co-calibration. null clears it.
// Same admin gate as every /admin surface: non-admins get a 404 that doesn't
// reveal the route exists.

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resize'), domainKey: z.string().trim().min(1) }),
  z.object({
    action: z.literal('set_estimate'),
    domainKey: z.string().trim().min(1),
    // Bounded well past SIZE_CEIL — an admin may know a franchise outsizes the
    // resolver's clamp — but still finite to keep fat-finger entries out.
    estimate: z.number().int().min(1).max(SIZE_CEIL * 10).nullable(),
  }),
]);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }
  const data = parsed.data;

  if (data.action === 'set_estimate') {
    const updated = await setManualEstimate(data.domainKey, data.estimate);
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  // resize — resolve the row's stored label against the live corpus.
  const row = (await getDepthEstimates([data.domainKey])).get(data.domainKey);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const label = row.sampleLabel ?? data.domainKey;
  const estimate = await estimateDomainSize(label).catch(() => null);
  if (!estimate || estimate.estimatedQuestions == null) {
    // Resolver miss or bespoke shape — nothing trustworthy to write. The row
    // keeps its current estimate; surface the miss instead of degrading it.
    return NextResponse.json({ error: 'resolver_unresolved' }, { status: 422 });
  }

  await upsertCorpusSizeEstimate({
    domainKey: data.domainKey,
    sampleLabel: label,
    estimatedQuestions: estimate.estimatedQuestions,
    corpusCount: estimate.corpusCount,
    shape: estimate.shape,
    confidence: estimate.confidence,
    basis: estimate.basis,
    wikipediaTitle: estimate.wikipediaTitle,
    wikidataQid: estimate.wikidataQid,
    fandomHost: estimate.fandomHost,
  });
  return NextResponse.json({
    ok: true,
    estimatedQuestions: estimate.estimatedQuestions,
    confidence: estimate.confidence,
    basis: estimate.basis,
  });
}
