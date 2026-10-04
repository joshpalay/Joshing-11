import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';
import { getRatedCassianDetails, saveCassianRating } from '@/server/cassian/review';

const ratingSchema = z.object({
  revisionId: z.string().uuid(),
  overall: z.enum(['Good', 'Fix', 'Reject', 'Unsure']),
  accuracy: z.enum(['Correct', 'Incorrect', 'Cannot verify']).optional(),
  accuracyIssue: z.enum(['Answer', 'Premise', 'Explanation', 'Multiple']).optional(),
  clarity: z.enum(['Clear', 'Ambiguous', 'Missing context', 'Gives answer away']).optional(),
  interest: z.enum(['Interesting', 'Fine', 'Boring or generic']).optional(),
  difficulty: z.enum(['Too easy', 'About right', 'Too hard', 'Cannot judge']).optional(),
  topicFit: z.enum(['On topic', 'Partly', 'Off topic']).optional(),
  appropriateness: z.enum(['Fine', 'Inappropriate', 'Unsure']).optional(),
  repetition: z.enum(['New', 'Already seen', 'Same-fact paraphrase']).optional(),
  answerAcceptance: z.enum(['Grading correct', 'My answer should count', 'Key or variants need correction', 'Not attempted']).optional(),
  creationSpeed: z.enum(['Fine', 'Noticeable wait', 'Too slow', 'Not observed']).optional(),
  gateReview: z.enum(['Pass', 'Revise', 'Reject', 'Unsure']).optional(),
  candidateDisposition: z.enum(['Keep', 'Revise', 'Reject', 'Unsure']).optional(),
  gateDecisionReview: z.enum(['Yes', 'No', 'Unsure']).optional(),
  postGateNote: z.string().max(4000).optional(),
  note: z.string().max(4000).optional(),
  correctedQuestion: z.string().max(1000).optional(),
  correctedAnswer: z.string().max(500).optional(),
  correctedExplanation: z.string().max(2000).optional(),
  supportingSource: z.string().max(1000).optional(),
  correctedVariants: z.string().max(1000).optional(),
  familiarity: z.enum(['Knew it', 'Recognized it', 'New to me', 'Cannot judge']).optional(),
}).superRefine((value, context) => {
  if (['Fix', 'Reject'].includes(value.overall) && !value.note?.trim()) {
    context.addIssue({ code: 'custom', path: ['note'], message: 'A reason is required.' });
  }
});
const bodySchema = z.object({ candidateId: z.string().regex(/^[a-f0-9]{32}$/), rating: ratingSchema });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid rating.' }, { status: 400 });
  const saved = await saveCassianRating(session.userId, body.data.candidateId, body.data.rating);
  if (!saved) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const details = await getRatedCassianDetails(session.userId, body.data.candidateId);
  return NextResponse.json({ saved: true, details }, { headers: { 'Cache-Control': 'private, no-store' } });
}
