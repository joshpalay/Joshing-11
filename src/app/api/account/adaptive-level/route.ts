import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, users } from '@/server/db';
import { mapAdaptiveLevelToDifficultyHint } from '@/server/adaptive-difficulty';

export const dynamic = 'force-dynamic';

function displayLabel(label: string): string {
  return label
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [user] = await db
    .select({ adaptiveLevel: users.adaptiveLevel })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const hint = mapAdaptiveLevelToDifficultyHint(user.adaptiveLevel);

  return NextResponse.json({
    level: user.adaptiveLevel,
    label: displayLabel(hint.difficultyLabel),
    difficultyLabel: hint.difficultyLabel,
    targetCorrectRate: hint.targetCorrectRate,
  });
}
