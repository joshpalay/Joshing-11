import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

// Returns the PHONE_HASH_SALT used by the client-side contact-hashing path
// (ContactMatchBlock). The salt is NOT a true secret — it lives on every
// authenticated client. Its purpose is rainbow-table defense, not
// insider-attack defense. See B-Friends-prompts §9.6.3.6.
//
// 500 if unset — the client can't hash without it, and contact matching
// is therefore non-functional until ops sets the env var. The rest of the
// app keeps working (the boot guard at instrumentation.ts only warns).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const salt = process.env.PHONE_HASH_SALT;
  if (!salt) {
    return NextResponse.json(
      {
        error: 'salt_unset',
        message: 'Contact-hash matching is not configured. Try again later.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ salt });
}
