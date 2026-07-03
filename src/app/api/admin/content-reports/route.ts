import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  dismissReport,
  resolveActiveIncorrectReportsForQuestion,
  reverseBlock,
  upholdReport,
} from '@/server/db/queries/content-reports';
import {
  approveEditedQuestion,
  editQuestionContent,
  restoreDemotedQuestion,
  retireDemotedQuestion,
} from '@/server/db/queries/machine-demotions';
import { rerunQuestion } from '@/server/quality/rerun-question';

export const dynamic = 'force-dynamic';
// rerun = one answer-generation call + one grounded verify (may web-search).
export const maxDuration = 60;

const reviewReason = z.string().trim().max(500).optional();

// uphold/dismiss act on an OPEN report (keyed by reportId); reverse un-blocks an
// already-actioned target (keyed by the question/generated id), so it carries a
// target instead of a reportId. restore/retire act on a machine-DEMOTED canonical
// question (publicStatus='needs_review'); edit reworks a canonical question's
// content from either stream — the edit clears the verification stamp so the
// batch-verify sweep re-fact-checks it, and resolves any active incorrect reports
// as 'admin_edited' (B-CRAFTER-LIFECYCLE-01 Phase 1).
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('uphold'), reportId: z.string().trim().min(1), reviewReason }),
  z.object({ action: z.literal('dismiss'), reportId: z.string().trim().min(1), reviewReason }),
  z.object({
    action: z.literal('reverse'),
    target: z.object({ table: z.enum(['question', 'generated']), id: z.string().trim().min(1) }),
    reviewReason,
  }),
  z.object({ action: z.literal('restore_demoted'), questionId: z.string().trim().min(1) }),
  z.object({ action: z.literal('retire_demoted'), questionId: z.string().trim().min(1) }),
  z.object({
    action: z.literal('edit'),
    questionId: z.string().trim().min(1),
    questionText: z.string().trim().min(1).max(2000).optional(),
    answerText: z.string().trim().min(1).max(1000).optional(),
    factualExplanation: z.string().trim().max(4000).nullable().optional(),
  }),
  // B-REVIEW-RERUN-01: re-run the (edited) question through the LLM for a fresh
  // answer + grounded verdict. Persists NOTHING — it's the preview the reviewer
  // reads before approving.
  z.object({
    action: z.literal('rerun_verify'),
    questionText: z.string().trim().min(1).max(2000),
    answerText: z.string().trim().max(1000).optional(),
    canonicalSubcategory: z.string().trim().max(200).nullable().optional(),
    broadCategory: z.string().trim().max(200).nullable().optional(),
  }),
  // The commit: persist the edit + a passing verification stamp and return the
  // question to circulation (both stores). Resolves active incorrect reports.
  z.object({
    action: z.literal('approve'),
    target: z.object({ table: z.enum(['question', 'generated']), id: z.string().trim().min(1) }),
    questionText: z.string().trim().min(1).max(2000),
    answerText: z.string().trim().min(1).max(1000),
    explanation: z.string().trim().max(4000).nullable().optional(),
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

  if (data.action === 'rerun_verify') {
    const result = await rerunQuestion({
      questionText: data.questionText,
      answerText: data.answerText,
      canonicalSubcategory: data.canonicalSubcategory,
      broadCategory: data.broadCategory,
    });
    if (!result) {
      return NextResponse.json({ error: 'llm_unavailable' }, { status: 503 });
    }
    return NextResponse.json(result);
  }

  if (data.action === 'approve') {
    const result = await approveEditedQuestion(data.target, {
      questionText: data.questionText,
      answerText: data.answerText,
      explanation: data.explanation,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    return NextResponse.json(result);
  }

  if (data.action === 'edit') {
    const { questionText, answerText, factualExplanation } = data;
    if (questionText === undefined && answerText === undefined && factualExplanation === undefined) {
      return NextResponse.json({ error: 'validation' }, { status: 400 });
    }
    const result = await editQuestionContent(data.questionId, {
      questionText,
      answerText,
      factualExplanation,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason },
        { status: result.reason === 'not_found' ? 404 : 409 },
      );
    }
    // The fix resolves any active incorrect reports on this question, attributed
    // to the admin (mirrors the author-edit bridge in B-Report-4).
    const resolvedReports = await resolveActiveIncorrectReportsForQuestion(
      data.questionId,
      'admin_edited',
    );
    return NextResponse.json({ ...result, resolvedReports });
  }

  const result =
    data.action === 'uphold'
      ? await upholdReport(data.reportId, data.reviewReason)
      : data.action === 'dismiss'
        ? await dismissReport(data.reportId, data.reviewReason)
        : data.action === 'restore_demoted'
          ? await restoreDemotedQuestion(data.questionId)
          : data.action === 'retire_demoted'
            ? await retireDemotedQuestion(data.questionId)
            : await reverseBlock(data.target, data.reviewReason);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'not_found' ? 404 : 409 },
    );
  }

  return NextResponse.json(result);
}
