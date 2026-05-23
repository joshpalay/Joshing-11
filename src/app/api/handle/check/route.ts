import { NextResponse } from 'next/server';

import {
  isReservedHandle,
  isValidHandleFormat,
  normalizeHandle,
  validateHandle,
} from '@/server/lib/handle-validation';

export const dynamic = 'force-dynamic';

// Public (no auth) so the signup handle picker can hit it before login.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('handle') ?? '';
  const normalized = normalizeHandle(raw);

  if (!isValidHandleFormat(normalized)) {
    return NextResponse.json({ available: false, reason: 'format' as const });
  }
  if (isReservedHandle(normalized)) {
    return NextResponse.json({ available: false, reason: 'reserved' as const });
  }

  const result = await validateHandle(normalized);
  if (result.ok) {
    return NextResponse.json({ available: true });
  }
  return NextResponse.json({ available: false, reason: result.reason });
}
