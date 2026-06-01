import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { clearContactHashes, replaceContactHashes } from '@/server/db/queries/contact-hashes';

export const dynamic = 'force-dynamic';

const MAX_HASHES = 5000;

const bodySchema = z.object({
  hashes: z
    .array(z.string().regex(/^[a-f0-9]{64}$/, 'must be 64-char lowercase hex'))
    .max(MAX_HASHES),
});

// Atomic replace of the caller's ContactHash rows. Per the privacy invariant
// in B-Friends-1's updateDiscoverability: when the user toggles
// discoverableByContacts OFF, the same rows are deleted in that handler — so
// uploading via this endpoint while contacts-discoverability is OFF would
// leave the rows in place until the next toggle. That's fine; matching only
// returns rows for users with the flag TRUE, so dormant hashes don't leak.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((issue) => issue.code === 'too_big');
    if (tooMany) {
      return NextResponse.json(
        {
          error: 'too_many_hashes',
          message: `At most ${MAX_HASHES} contacts per upload.`,
        },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { error: 'invalid_body', message: 'Hash list malformed.' },
      { status: 400 },
    );
  }

  const result = await replaceContactHashes(session.userId, parsed.data.hashes);
  return NextResponse.json(result);
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await clearContactHashes(session.userId);
  return NextResponse.json({ ok: true });
}
