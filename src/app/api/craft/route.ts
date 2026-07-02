import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { draftCandidatesForDomain, flagDraftCandidates } from '@/server/crafter/draft-candidates';
import { keepCandidate } from '@/server/crafter/keep-candidate';
import { hasActiveInvitation } from '@/server/db/queries/author-invitations';
import { recordDraftDecision } from '@/server/db/queries/crafter-decisions';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the PLAYER creation surface's API. Same two
// verbs as the admin route (/api/admin/craft), same shared rails
// (draft-candidates + keep-candidate), different gate: an ACTIVE author
// invitation for THIS domain (the manual checkbox a crafter flipped), not the
// admin allowlist. A player without an invitation gets 404 — the surface's
// existence isn't revealed. Every kept question is inline-vetted and enters
// with verifiedAt=NULL so the batch-verify sweep fact-checks it; the
// authorship-exclusion invariant keeps the author from ever being served it.

const tierSchema = z.enum(['shallow', 'deep']);
const domainSchema = z.string().trim().min(1).max(120);
// Machine doubts shown at decision time — ledgered with the verdict
// (B-CRAFTER-DECISION-LEDGER-01, same contract as the admin route).
const decisionFlagsSchema = z
  .array(z.object({ kind: z.string().trim().min(1).max(40), note: z.string().trim().max(500) }))
  .max(8)
  .optional();

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('draft'),
    domain: domainSchema,
    tier: tierSchema,
    count: z.number().int().min(1).max(6).default(4),
  }),
  z.object({
    action: z.literal('keep'),
    domain: domainSchema,
    tier: tierSchema,
    questionText: z.string().trim().min(1).max(2000),
    answer: z.string().trim().min(1).max(500),
    explainer: z.string().trim().max(4000).optional(),
    machineDraftAnswer: z.string().trim().max(500).optional(),
    difficultyEstimate: z.enum(['accessible', 'moderate', 'specialist']),
    broadCategory: z.string().trim().min(1).max(120),
    flags: decisionFlagsSchema,
  }),
  // Kill verdict → decision ledger only. Nothing servable is created; this is
  // the invited player teaching the machine what they rejected.
  z.object({
    action: z.literal('kill'),
    domain: domainSchema,
    tier: tierSchema,
    questionText: z.string().trim().min(1).max(2000),
    answer: z.string().trim().min(1).max(500),
    flags: decisionFlagsSchema,
  }),
  z.object({
    action: z.literal('flags'),
    domain: domainSchema,
    candidates: z
      .array(
        z.object({
          questionText: z.string().trim().min(1).max(2000),
          answer: z.string().trim().min(1).max(500),
          difficultyEstimate: z.enum(['accessible', 'moderate', 'specialist']),
        }),
      )
      .min(1)
      .max(12),
  }),
]);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }
  const data = parsed.data;

  // The invitation IS the gate — scoped to this player and this domain.
  const invited = await hasActiveInvitation(session.userId, data.domain);
  if (!invited) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (data.action === 'draft') {
    const result = await draftCandidatesForDomain({
      domain: data.domain,
      tier: data.tier,
      count: data.count,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 503 });
    }
    return NextResponse.json({ candidates: result.candidates });
  }

  if (data.action === 'flags') {
    const flagged = await flagDraftCandidates(data.domain, data.candidates);
    return NextResponse.json({ flagged });
  }

  if (data.action === 'kill') {
    await recordDraftDecision({
      deciderId: session.userId,
      domain: data.domain,
      tier: data.tier,
      questionText: data.questionText,
      answer: data.answer,
      decision: 'killed',
      flags: data.flags,
    });
    return NextResponse.json({ ok: true });
  }

  const result = await keepCandidate({
    keeperUserId: session.userId,
    domain: data.domain,
    questionText: data.questionText,
    answer: data.answer,
    explainer: data.explainer,
    machineDraftAnswer: data.machineDraftAnswer,
    difficultyEstimate: data.difficultyEstimate,
    broadCategory: data.broadCategory,
  });
  // Ledger the verdict either way — a keep the vet blocked is still a keep for
  // teaching purposes. Best-effort by contract.
  await recordDraftDecision({
    deciderId: session.userId,
    domain: data.domain,
    tier: data.tier,
    questionText: data.questionText,
    answer: data.answer,
    decision: 'kept',
    flags: data.flags,
    editedAnswer:
      data.machineDraftAnswer && data.machineDraftAnswer !== data.answer ? data.answer : null,
    questionId: result.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, id: result.id }, { status: 422 });
  }
  return NextResponse.json(
    { id: result.id, publicStatus: result.publicStatus, vetReason: result.vetReason },
    { status: 201 },
  );
}
