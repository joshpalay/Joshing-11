import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { markDomainExpansionOffered } from '@/server/adaptive-difficulty';
import { recordAreaExpansion } from '@/server/knowledge/open-domain';
import {
  addDeclaredInterest,
  DeclaredInterestLimitError,
} from '@/server/db/queries/users';
import { TooBroadInterestError } from '@/lib/knowledge/interest-specificity';
import { UnanswerableInterestError } from '@/server/llm/interests';

// Accept or dismiss the post-daily-Five expansion offer. `selectedDomains` are the
// adjacent domains the player chose to add to their rotation (empty = "Not now").
// Either way the offer is resolved (expansionOfferedAt stamped) so it shows once.
const expandSchema = z.object({
  sourceDomain: z.string().trim().min(1).max(120),
  selectedDomains: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        broadCategory: z.string().trim().max(80).nullable().optional(),
        // 'broader' picks (a parent area, e.g. Pride → Moral Philosophy) get an
        // expansion provenance record; 'wider' siblings do not. Absent/legacy
        // payloads are treated as wider (no provenance), matching prior behavior.
        kind: z.enum(['wider', 'broader']).optional(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = expandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Send a sourceDomain and any selected domains.' },
      { status: 400 },
    );
  }

  const { sourceDomain, selectedDomains } = parsed.data;

  const added: { domain: string; broadCategory: string | null }[] = [];
  const skipped: { label: string; reason: string }[] = [];
  let expandedCount = 0;

  for (const pick of selectedDomains) {
    try {
      const result = await addDeclaredInterest(session.userId, {
        label: pick.label,
        broadCategory: pick.broadCategory ?? null,
      });
      added.push({ domain: result.domain, broadCategory: result.broadCategory });
      // R4: a broader (parent) pick records "expandedFrom" provenance on the new
      // area — best-effort, never blocks the add or the confirmation.
      if (pick.kind === 'broader') {
        await recordAreaExpansion({
          userId: session.userId,
          sourceDomain,
          targetDomain: result.domain,
        });
        expandedCount += 1;
      }
    } catch (error) {
      // The interest cap is a hard stop — surface it and stop trying further picks.
      if (error instanceof DeclaredInterestLimitError) {
        skipped.push({ label: pick.label, reason: 'interest_limit_reached' });
        break;
      }
      // A suggested label that the guards reject (too broad / unanswerable) is
      // skipped individually rather than failing the whole accept.
      if (error instanceof TooBroadInterestError) {
        skipped.push({ label: pick.label, reason: 'too_broad' });
        continue;
      }
      if (error instanceof UnanswerableInterestError) {
        skipped.push({ label: pick.label, reason: 'unanswerable' });
        continue;
      }
      skipped.push({ label: pick.label, reason: 'add_failed' });
    }
  }

  // Resolve the offer regardless of accept/dismiss so it surfaces only once.
  await markDomainExpansionOffered(session.userId, sourceDomain);

  // Audit the expansion-offer funnel (eligible → shown → resolved): did the
  // player accept (and how many domains) or dismiss?
  console.info('[expansion-offer] resolved', {
    phase: 'resolved',
    userId: session.userId,
    sourceDomain,
    accepted: added.length > 0,
    addedCount: added.length,
    broaderAddedCount: expandedCount,
    widerAddedCount: added.length - expandedCount,
    skippedCount: skipped.length,
    dismissed: selectedDomains.length === 0,
  });

  return NextResponse.json({ added, skipped });
}
