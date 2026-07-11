import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  adminBulkReattributeToHouse,
  adminEditQuestion,
  adminRestoreQuestion,
  adminSoftDeleteQuestion,
} from '@/server/db/queries/admin-questions';
import { CATEGORIES } from '@/lib/questions-types';

export const dynamic = 'force-dynamic';

// B-ADMIN-QUESTIONS-OVERVIEW-01 Phase 4 — admin-gated mutations for the pool
// audit table. edit reuses the canon "content changed ⇒ re-verify" stamp-clear;
// delete is a SOFT delete (deletedAt) and restore is its inverse — never a hard
// DELETE. Every mutation re-checks isAdminUser on the server (the client is never
// trusted). Field set is the ratified minimal set (Decision B); no audit log
// (Decision A1). Decision C (no bulk actions) was revised 2026-07-11 for exactly
// one bulk act — person → house re-attribution — after admin bulk uploads landed
// attributed to the uploading admin personally; everything else stays per-row.

// visibility is limited to the admin-settable values ('blocked' is a safety
// terminal state set by the vet path, not hand-editable here).
const editSchema = z.object({
  action: z.literal('edit'),
  id: z.string().trim().min(1),
  questionText: z.string().trim().min(1).max(2000).optional(),
  answerText: z.string().trim().min(1).max(1000).optional(),
  acceptedAlternatives: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  factualExplanation: z.string().trim().max(4000).nullable().optional(),
  // The "between us" aside — flavor text, not grading-adjacent.
  insideJoke: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
  // Re-attribution to the house author (creator_id NULL + source house_authored).
  // Only 'house' is settable here — reassigning to a specific person would need a
  // person picker this tool doesn't have.
  attribution: z.enum(['house']).optional(),
});

const bodySchema = z.discriminatedUnion('action', [
  editSchema,
  z.object({ action: z.literal('delete'), id: z.string().trim().min(1) }),
  z.object({ action: z.literal('restore'), id: z.string().trim().min(1) }),
  // Bulk person → house re-attribution. Capped at one admin page of rows per
  // request (MAX_PAGE_SIZE in admin-questions.ts) — the client selects from the
  // rendered table, so a larger sweep is several requests, each deliberate.
  z.object({
    action: z.literal('reattribute_house'),
    ids: z.array(z.string().trim().min(1)).min(1).max(200),
  }),
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

  if (data.action === 'delete') {
    const result = await adminSoftDeleteQuestion(data.id);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
    return NextResponse.json(result);
  }

  if (data.action === 'restore') {
    const result = await adminRestoreQuestion(data.id);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
    return NextResponse.json(result);
  }

  if (data.action === 'reattribute_house') {
    // Skipped rows (already house/LLM, or deleted) are reported, not errors.
    const result = await adminBulkReattributeToHouse(data.ids);
    return NextResponse.json(result);
  }

  // edit — require at least one field to change.
  const { id, ...fields } = data;
  const patch = {
    questionText: fields.questionText,
    answerText: fields.answerText,
    acceptedAlternatives: fields.acceptedAlternatives,
    factualExplanation: fields.factualExplanation,
    insideJoke: fields.insideJoke,
    category: fields.category,
    visibility: fields.visibility,
    attribution: fields.attribution,
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }
  const result = await adminEditQuestion(id, patch);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'not_found' ? 404 : 400 });
  }
  return NextResponse.json(result);
}
