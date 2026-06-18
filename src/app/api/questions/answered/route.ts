import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { getArchiveForUser } from '@/server/db/queries/archive';

export const dynamic = 'force-dynamic';

// Keyset pagination for the Questions → Answered tab. cursor is the opaque
// token returned as nextCursor; limit caps a page (the archive query clamps to
// its own MAX_LIMIT regardless).
const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({
    cursor: params.get('cursor') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const archive = await getArchiveForUser({
    userId: session.userId,
    kind: 'answered',
    limit: parsed.data.limit ?? 50,
    cursor: parsed.data.cursor,
  });

  const items = archive.items.map((item) => ({
    id: item.id,
    questionId: item.questionId,
    questionText: item.questionText,
    domainDisplayName: item.domainDisplayName,
    submittedAnswer: item.submittedAnswer,
    correctAnswer: item.correctAnswer,
    result: item.result,
    askerName: item.askerName,
    authorIsHouse: item.authorIsHouse,
    answeredAt: item.answeredAt,
    sourceLabel: item.sourceLabel,
    reportTarget: item.reportTarget,
  }));

  return NextResponse.json({ items, nextCursor: archive.nextCursor });
}
