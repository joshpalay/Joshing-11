import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { draftCandidatesForDomain, flagDraftCandidates } from '@/server/crafter/draft-candidates';
import { keepCandidate } from '@/server/crafter/keep-candidate';
import { recordDraftDecision } from '@/server/db/queries/crafter-decisions';
import {
  getDomainPlayersWithInvitationState,
  inviteToAuthor,
  revokeInvitation,
} from '@/server/db/queries/author-invitations';

export const dynamic = 'force-dynamic';
// draft = one generation call + two gate calls; keep = one vet call. Mirror the
// generation cron's ceiling so a slow draft finishes instead of being killed.
export const maxDuration = 120;

// B-CRAFTER-LIFECYCLE-01 Phase 2+3 — the crafter surface's verbs.
//   draft:   machine proposes candidates for a domain+tier. NOTHING persists;
//            candidates exist only in the response, machine doubts included.
//   keep:    the crafter's yes — enters on the shared authoring rail
//            (keep-candidate.ts): inline vet, verifiedAt=NULL for the
//            batch-verify dragnet, honest llm_suggested/llm_edited provenance.
//   players: who's active in a domain + their invitation state (Panel B row).
//   invite / revoke: flip the manual per-(player, domain) invitation checkbox
//            (Phase 3 decision: manual first; 'domain_exhausted' is the first
//            of a couple of invitation reasons). Revoke is soft — resolvedAt,
//            never a DELETE.
// Kill is client-side only — an unkept candidate never existed server-side.

const tierSchema = z.enum(['shallow', 'deep']);
const domainSchema = z.string().trim().min(1).max(120);
// The machine doubts shown on the card at decision time — recorded with the
// verdict so gate calibration can compare flags against human decisions
// (B-CRAFTER-DECISION-LEDGER-01).
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
    // The machine's original draft answer, BEFORE any inline edit — kept for
    // honest answerSource attribution (llm_suggested vs llm_edited semantics).
    machineDraftAnswer: z.string().trim().max(500).optional(),
    difficultyEstimate: z.enum(['accessible', 'moderate', 'specialist']),
    broadCategory: z.string().trim().min(1).max(120),
    flags: decisionFlagsSchema,
    // Public byline: self (default), machine (Maid Acasa), or house (Joshing).
    attribution: z.enum(['self', 'machine', 'house']).default('self'),
    // 'own' = the crafter wrote it themselves (no machine draft behind it) —
    // same rail, same vet, same batch fact-check.
    origin: z.enum(['machine_draft', 'own']).default('machine_draft'),
  }),
  // The kill verdict, recorded to the decision ledger. Nothing else persists —
  // an unkept candidate still never exists as a servable question; this is
  // teaching data only (what the human rejected, with the flags they saw).
  z.object({
    action: z.literal('kill'),
    domain: domainSchema,
    tier: tierSchema,
    questionText: z.string().trim().min(1).max(2000),
    answer: z.string().trim().min(1).max(500),
    flags: decisionFlagsSchema,
  }),
  // The deferred LLM doubt pass: run the factual/quality gates over candidates
  // the client already rendered, so drafts appear fast and flags stream in.
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
  z.object({ action: z.literal('players'), domain: domainSchema }),
  z.object({ action: z.literal('invite'), domain: domainSchema, userId: z.string().trim().min(1) }),
  z.object({ action: z.literal('revoke'), domain: domainSchema, userId: z.string().trim().min(1) }),
]);

export async function POST(request: NextRequest) {
  const session = await getSession();
  // Non-admins (and the unauthenticated) get 404 — never reveal the route exists.
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }
  const data = parsed.data;

  switch (data.action) {
    case 'draft': {
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

    case 'keep': {
      const result = await keepCandidate({
        keeperUserId: session.userId,
        domain: data.domain,
        questionText: data.questionText,
        answer: data.answer,
        explainer: data.explainer,
        machineDraftAnswer: data.machineDraftAnswer,
        difficultyEstimate: data.difficultyEstimate,
        broadCategory: data.broadCategory,
        attribution: data.attribution,
        origin: data.origin,
      });
      // Ledger the human's verdict either way — a keep the vet then blocked is
      // still a keep for teaching purposes. Best-effort by contract.
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
        // Safety-fail: saved but hard-blocked from every surface (same contract
        // as the authoring route's failed_content_check).
        return NextResponse.json({ error: result.reason, id: result.id }, { status: 422 });
      }
      return NextResponse.json(
        { id: result.id, publicStatus: result.publicStatus, vetReason: result.vetReason },
        { status: 201 },
      );
    }

    case 'kill': {
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

    case 'flags': {
      const flagged = await flagDraftCandidates(data.domain, data.candidates);
      return NextResponse.json({ flagged });
    }

    case 'players': {
      const players = await getDomainPlayersWithInvitationState(data.domain);
      return NextResponse.json({ players });
    }

    case 'invite': {
      const result = await inviteToAuthor({
        userId: data.userId,
        domain: data.domain,
        invitedBy: session.userId,
      });
      return NextResponse.json(result);
    }

    case 'revoke': {
      const result = await revokeInvitation(data.userId, data.domain);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 404 });
      }
      return NextResponse.json(result);
    }
  }
}
