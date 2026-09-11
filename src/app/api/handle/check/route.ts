import { NextResponse } from 'next/server';

import {
  isReservedHandle,
  isValidHandleFormat,
  normalizeHandle,
  validateHandle,
} from '@/server/lib/handle-validation';

export const dynamic = 'force-dynamic';

// F9 (2026-09-10 audit) — this comment used to claim "Public (no auth)", but
// this route is NOT excluded from src/proxy.ts's matcher, so an
// unauthenticated request is rejected (401) by the proxy before this handler
// ever runs. It is reachable only for an authenticated session with an
// accepted invitation. Fixed the comment; deliberately NOT adding a proxy
// exemption to make it actually public — that's a separate, unasked-for
// change to the auth boundary.
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
