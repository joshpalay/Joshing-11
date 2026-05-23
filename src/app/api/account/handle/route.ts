import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { getHandleChangeStatus, updateHandle } from '@/server/db/queries/account';
import {
  isReservedHandle,
  isValidHandleFormat,
  normalizeHandle,
  validateHandle,
} from '@/server/lib/handle-validation';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  handle: z.string().trim().min(3).max(20),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const status = await getHandleChangeStatus(session.userId);
  if (!status) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({
    handle: status.handle,
    handleLastChangedAt: status.handleLastChangedAt?.toISOString() ?? null,
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Handle must be 3–20 characters.' },
      { status: 400 },
    );
  }

  const normalized = normalizeHandle(parsed.data.handle);
  if (!isValidHandleFormat(normalized)) {
    return NextResponse.json(
      {
        error: 'invalid_format',
        message: 'Handle must start with a letter and use only lowercase letters, numbers, and underscores.',
      },
      { status: 400 },
    );
  }
  if (isReservedHandle(normalized)) {
    return NextResponse.json(
      { error: 'reserved', message: 'That handle is reserved.' },
      { status: 400 },
    );
  }

  const verdict = await validateHandle(normalized, { excludeUserId: session.userId });
  if (!verdict.ok) {
    if (verdict.reason === 'taken') {
      return NextResponse.json(
        { error: 'taken', message: 'That handle is already taken.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: verdict.reason, message: 'That handle is not available.' },
      { status: 400 },
    );
  }

  const result = await updateHandle({ userId: session.userId, handle: normalized });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: 'You can change your handle once every 30 days.',
        retryAfter: result.retryAfter.toISOString(),
      },
      { status: 429 },
    );
  }

  return NextResponse.json({ ok: true, handle: result.handle });
}
