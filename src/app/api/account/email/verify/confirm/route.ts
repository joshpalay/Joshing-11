import { NextResponse } from 'next/server';
import { z } from 'zod';

import { consumeVerificationToken } from '@/server/db/queries/email-verification';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(32).max(256),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Missing or malformed token.' },
      { status: 400 },
    );
  }

  const result = await consumeVerificationToken(parsed.data.token);

  if (result.ok) {
    return NextResponse.json({ ok: true, email: result.email });
  }

  if (result.reason === 'email_already_in_use') {
    return NextResponse.json(
      {
        error: 'email_already_in_use',
        message: 'That email is already linked to another Joshing account.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      error: 'invalid_or_expired',
      message: 'This confirmation link is invalid or expired. Request a new one from your profile.',
    },
    { status: 400 },
  );
}
