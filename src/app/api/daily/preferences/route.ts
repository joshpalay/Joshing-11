import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dailyPreferences, db } from '@/server/db';
import { getDailyPreferences, getKnowledgeBase } from '@/server/db/queries/daily';

export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES = ['normal', 'moderate', 'challenging', 'ridiculous', 'adaptive'] as const;
type DifficultyPreference = typeof VALID_DIFFICULTIES[number];

function isValidDifficulty(value: unknown): value is DifficultyPreference {
  return VALID_DIFFICULTIES.includes(value as DifficultyPreference);
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed) result.push(trimmed);
  }
  return [...new Set(result)];
}

async function requireUserId() {
  const session = await getSession();
  return session?.userId ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const preferences = await getDailyPreferences(userId);
  return NextResponse.json({
    preferences: preferences
      ? {
          friend_ids: preferences.friendIds,
          include_community: preferences.includeCommunity,
          selected_domains: preferences.selectedDomains,
          difficulty_preference: preferences.difficultyPreference,
        }
      : null,
  });
}

export async function PUT(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'validation', message: 'invalid_json' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const selectedDomains = parseStringArray(record.selected_domains);
  if (selectedDomains === null) {
    return NextResponse.json(
      { error: 'validation', message: 'selected_domains must be a string array' },
      { status: 400 },
    );
  }

  const difficultyPreference = isValidDifficulty(record.difficulty_preference)
    ? record.difficulty_preference
    : 'adaptive';

  const knowledgeBase = await getKnowledgeBase(userId);
  const allowedDomains = new Set(knowledgeBase.map((domain) => domain.domain));
  const sanitizedDomains = selectedDomains.filter((domain) => allowedDomains.has(domain));

  const [preferences] = await db
    .insert(dailyPreferences)
    .values({
      userId,
      friendIds: [],
      includeCommunity: false,
      selectedDomains: sanitizedDomains,
      difficultyPreference,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dailyPreferences.userId,
      set: {
        selectedDomains: sanitizedDomains,
        difficultyPreference,
        updatedAt: new Date(),
      },
    })
    .returning();

  await db
    .update(dailyPreferences)
    .set({ friendIds: [], includeCommunity: false })
    .where(eq(dailyPreferences.userId, userId));

  return NextResponse.json({
    preferences: {
      friend_ids: preferences.friendIds,
      include_community: preferences.includeCommunity,
      selected_domains: preferences.selectedDomains,
      difficulty_preference: preferences.difficultyPreference,
    },
  });
}
