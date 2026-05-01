import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getUserOnboardingProfile } from '@/server/db/queries/users';

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await getUserOnboardingProfile(session.userId);

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      phone_number: user.phoneNumber,
      display_name: user.displayName,
      timezone: user.timezone,
      preferred_theme: user.preferredTheme,
      onboardingComplete: user.onboardingComplete,
    },
  });
}
