import { eq } from 'drizzle-orm';

import { dailyPreferences, db } from '@/server/db';

export const DAILY_DIFFICULTIES = [
  'normal',
  'moderate',
  'challenging',
  'ridiculous',
  'adaptive',
] as const;
export const DAILY_DOMAIN_MODES = ['random', 'custom'] as const;

export type DailyDifficulty = (typeof DAILY_DIFFICULTIES)[number];
export type DailyDomainMode = (typeof DAILY_DOMAIN_MODES)[number];

export type DailyPreferences = {
  userId: string;
  difficulty: DailyDifficulty;
  domainMode: DailyDomainMode;
  selectedDomains: string[];
  updatedAt: Date | null;
};

export type DailyPreferencesUpdate = Partial<
  Pick<DailyPreferences, 'difficulty' | 'domainMode' | 'selectedDomains'>
>;

export function defaultDailyPreferences(userId: string): DailyPreferences {
  return {
    userId,
    difficulty: 'adaptive',
    domainMode: 'random',
    selectedDomains: [],
    updatedAt: null,
  };
}

function isDailyDifficulty(value: unknown): value is DailyDifficulty {
  return DAILY_DIFFICULTIES.includes(value as DailyDifficulty);
}

function isDailyDomainMode(value: unknown): value is DailyDomainMode {
  return DAILY_DOMAIN_MODES.includes(value as DailyDomainMode);
}

function normalizeSelectedDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const domains = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(domains)];
}

function serializePreference(row: typeof dailyPreferences.$inferSelect): DailyPreferences {
  return {
    userId: row.userId,
    difficulty: isDailyDifficulty(row.difficulty) ? row.difficulty : 'adaptive',
    domainMode: isDailyDomainMode(row.domainMode) ? row.domainMode : 'random',
    selectedDomains: normalizeSelectedDomains(row.selectedDomains),
    updatedAt: row.updatedAt ?? null,
  };
}

export async function getDailyPreferences(userId: string): Promise<DailyPreferences> {
  const [preference] = await db
    .select()
    .from(dailyPreferences)
    .where(eq(dailyPreferences.userId, userId))
    .limit(1);

  return preference ? serializePreference(preference) : defaultDailyPreferences(userId);
}

export async function updateDailyPreferences(
  userId: string,
  data: DailyPreferencesUpdate,
): Promise<DailyPreferences> {
  const now = new Date();
  const selectedDomains =
    data.selectedDomains === undefined ? undefined : normalizeSelectedDomains(data.selectedDomains);
  const difficulty =
    data.difficulty && isDailyDifficulty(data.difficulty) ? data.difficulty : undefined;
  const domainMode =
    data.domainMode && isDailyDomainMode(data.domainMode) ? data.domainMode : undefined;

  const [preference] = await db
    .insert(dailyPreferences)
    .values({
      userId,
      difficulty: difficulty ?? 'adaptive',
      domainMode: domainMode ?? 'random',
      selectedDomains: selectedDomains ?? [],
      difficultyPreference: difficulty ?? 'adaptive',
      friendIds: [],
      includeCommunity: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dailyPreferences.userId,
      set: {
        ...(difficulty ? { difficulty, difficultyPreference: difficulty } : {}),
        ...(domainMode ? { domainMode } : {}),
        ...(selectedDomains ? { selectedDomains } : {}),
        updatedAt: now,
      },
    })
    .returning();

  return serializePreference(preference);
}
