/**
 * AppSettings single-row read/write (B-LLM-PROVIDER-AB-SWITCH B2).
 *
 * Exactly one row exists, id = 'singleton' (pinned by a CHECK + seeded by the
 * migration). These helpers are the only place the table is touched; the cached
 * reader in src/server/llm/settings.ts wraps readAppSettings() so callers don't
 * hit the DB on every generation question.
 */
import { eq, sql } from 'drizzle-orm';

import { appSettings, db } from '@/server/db';
import type { LlmProvider } from '@/server/llm/provider';

export const APP_SETTINGS_ID = 'singleton';

export type AppSettingsRow = {
  genProvider: LlmProvider;
  categorizeProvider: LlmProvider;
  suggestProvider: LlmProvider;
  gradeProvider: LlmProvider;
};

// The four columns the panel can write. Each optional — a PATCH may touch one.
export type AppSettingsUpdate = Partial<AppSettingsRow>;

function coerceProvider(value: string): LlmProvider {
  return value === 'openai' ? 'openai' : 'anthropic';
}

/**
 * Read the single settings row. Returns null if the row is somehow absent (a
 * brand-new DB before the seed, or a guard race) — callers treat null as
 * "all Anthropic". Never throws on a missing row; DB errors propagate so the
 * cached wrapper can log + fall back.
 */
export async function readAppSettings(): Promise<AppSettingsRow | null> {
  const [row] = await db
    .select({
      genProvider: appSettings.genProvider,
      categorizeProvider: appSettings.categorizeProvider,
      suggestProvider: appSettings.suggestProvider,
      gradeProvider: appSettings.gradeProvider,
    })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ID))
    .limit(1);

  if (!row) return null;
  return {
    genProvider: coerceProvider(row.genProvider),
    categorizeProvider: coerceProvider(row.categorizeProvider),
    suggestProvider: coerceProvider(row.suggestProvider),
    gradeProvider: coerceProvider(row.gradeProvider),
  };
}

/**
 * Write a subset of the four provider columns to the single row, stamping
 * updated_at. Upserts the singleton row so a write succeeds even if the seed
 * somehow didn't land. Returns the full row after the write.
 */
export async function writeAppSettings(update: AppSettingsUpdate): Promise<AppSettingsRow> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (update.genProvider) set.genProvider = update.genProvider;
  if (update.categorizeProvider) set.categorizeProvider = update.categorizeProvider;
  if (update.suggestProvider) set.suggestProvider = update.suggestProvider;
  if (update.gradeProvider) set.gradeProvider = update.gradeProvider;

  await db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_ID, ...update })
    .onConflictDoUpdate({ target: appSettings.id, set });

  const row = await readAppSettings();
  // The upsert guarantees a row, so readAppSettings() is non-null here.
  return row ?? {
    genProvider: 'anthropic',
    categorizeProvider: 'anthropic',
    suggestProvider: 'anthropic',
    gradeProvider: 'anthropic',
  };
}
