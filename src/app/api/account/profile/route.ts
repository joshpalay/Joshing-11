import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { getEditableProfile, updateProfileFields } from '@/server/db/queries/account';

export const dynamic = 'force-dynamic';

// Migration 0054 dropped bio/tagline/location, leaving only displayName
// on this endpoint. Handle is excluded — handle changes go through PATCH
// /api/account/handle which owns the 30-day rate-limit.
const bodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).optional(),
  })
  .refine((patch) => patch.displayName !== undefined, {
    message: 'At least one field is required.',
  });

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const profile = await getEditableProfile(session.userId);
  if (!profile) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ profile });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await updateProfileFields(session.userId, parsed.data);
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      invalid_display_name: 'Display name must be 1–60 characters.',
      empty_patch: 'At least one field is required.',
    };
    return NextResponse.json(
      { error: result.reason, message: messages[result.reason] },
      { status: 400 },
    );
  }

  const profile = await getEditableProfile(session.userId);
  return NextResponse.json({ ok: true, profile });
}
