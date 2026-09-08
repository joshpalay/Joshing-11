import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, users } from '@/server/db';
import { acceptFriendInvitation } from '@/server/friends/invitations';

const bodySchema = z.object({ token: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'That invitation is not valid.' },
      { status: 400 },
    );
  }

  const [user] = await db
    .select({
      phoneNumber: users.phoneNumber,
      phoneVerified: users.phoneVerified,
      onboardingComplete: users.onboardingComplete,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.phoneVerified) {
    return NextResponse.json(
      {
        error: 'verification_required',
        message: 'Verify your phone number to continue this invitation.',
      },
      { status: 403 },
    );
  }

  const result = await acceptFriendInvitation({
    token: parsed.data.token,
    inviteeUserId: session.userId,
    verifiedPhone: user.phoneNumber,
  });
  if (!result.accepted) {
    return NextResponse.json(
      {
        error: 'invalid_invitation',
        message: 'This invitation is no longer available for this account.',
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    nextHref: user.onboardingComplete ? '/' : '/onboarding',
  });
}
