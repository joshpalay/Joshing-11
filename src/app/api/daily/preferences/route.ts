import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getKnowledgeBase } from '@/server/db/queries/daily';
import {
  DAILY_DIFFICULTIES,
  DAILY_DOMAIN_MODES,
  getDailyPreferences,
  updateDailyPreferences,
  type DailyDifficulty,
  type DailyDomainMode,
} from '@/server/db/queries/daily-preferences';

export const dynamic = 'force-dynamic';

function isValidDifficulty(value: unknown): value is DailyDifficulty {
  return DAILY_DIFFICULTIES.includes(value as DailyDifficulty);
}

function isValidDomainMode(value: unknown): value is DailyDomainMode {
  return DAILY_DOMAIN_MODES.includes(value as DailyDomainMode);
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

function serializePreferences(preferences: Awaited<ReturnType<typeof getDailyPreferences>>) {
  return {
    userId: preferences.userId,
    difficulty: preferences.difficulty,
    domainMode: preferences.domainMode,
    selectedDomains: preferences.selectedDomains,
    updatedAt: preferences.updatedAt?.toISOString() ?? null,
    difficulty_preference: preferences.difficulty,
    selected_domains: preferences.selectedDomains,
    domain_mode: preferences.domainMode,
  };
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [preferences, knowledgeBase] = await Promise.all([
    getDailyPreferences(userId),
    getKnowledgeBase(userId),
  ]);

  return NextResponse.json({
    preferences: serializePreferences(preferences),
    domains: knowledgeBase.map((domain) => ({
      domain: domain.domain,
      broadCategory: domain.broadCategory,
      source: domain.source,
      totalPoints: domain.totalPoints,
      tier: domain.tier,
      canonical_subcategory: domain.domain,
      broad_category: domain.broadCategory,
      total_points: domain.totalPoints,
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'validation', message: 'invalid_json' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const difficultyValue = record.difficulty ?? record.difficulty_preference;
  const domainModeValue = record.domainMode ?? record.domain_mode;
  const selectedDomainsValue = record.selectedDomains ?? record.selected_domains;

  if (difficultyValue !== undefined && !isValidDifficulty(difficultyValue)) {
    return NextResponse.json({ error: 'validation', message: 'invalid_difficulty' }, { status: 400 });
  }

  if (domainModeValue !== undefined && !isValidDomainMode(domainModeValue)) {
    return NextResponse.json({ error: 'validation', message: 'invalid_domain_mode' }, { status: 400 });
  }

  const parsedSelectedDomains =
    selectedDomainsValue === undefined ? undefined : parseStringArray(selectedDomainsValue);
  if (parsedSelectedDomains === null) {
    return NextResponse.json(
      { error: 'validation', message: 'selectedDomains must be a string array' },
      { status: 400 },
    );
  }

  const knowledgeBase = await getKnowledgeBase(userId);
  const allowedDomains = new Set(knowledgeBase.map((domain) => domain.domain));
  const sanitizedDomains = parsedSelectedDomains?.filter((domain) => allowedDomains.has(domain));
  const nextDomainMode = isValidDomainMode(domainModeValue) ? domainModeValue : undefined;

  if (nextDomainMode === 'custom' && sanitizedDomains?.length === 0) {
    return NextResponse.json(
      { error: 'validation', message: 'Choose at least one domain for Custom mode.' },
      { status: 400 },
    );
  }

  const preferences = await updateDailyPreferences(userId, {
    ...(isValidDifficulty(difficultyValue) ? { difficulty: difficultyValue } : {}),
    ...(nextDomainMode ? { domainMode: nextDomainMode } : {}),
    ...(sanitizedDomains ? { selectedDomains: sanitizedDomains } : {}),
  });

  return NextResponse.json({ preferences: serializePreferences(preferences) });
}

export const PUT = PATCH;
