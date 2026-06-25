/**
 * Cached provider-settings reader (B-LLM-PROVIDER-AB-SWITCH B2).
 *
 * getProviderSettings() returns which provider each of the four surfaces should
 * use. It wraps the single-row AppSettings read with a short in-process TTL so a
 * generation run (5 LLM calls/user) doesn't hit the DB five times. A read failure
 * never blocks the flow — it falls back to all-Anthropic and logs, so a settings
 * outage degrades to the safe default rather than breaking generation/grading.
 */
import { readAppSettings, type AppSettingsUpdate, writeAppSettings } from '@/server/db/queries/app-settings';
import type { LlmProvider } from '@/server/llm/provider';

export type ProviderSurface = 'gen' | 'categorize' | 'suggest' | 'grade';
export type ProviderSettings = Record<ProviderSurface, LlmProvider>;

const ALL_ANTHROPIC: ProviderSettings = {
  gen: 'anthropic',
  categorize: 'anthropic',
  suggest: 'anthropic',
  grade: 'anthropic',
};

// Short TTL: long enough to absorb a single generation run's 5 reads, short
// enough that flipping a dropdown takes effect within a few seconds.
const CACHE_TTL_MS = 5_000;

let cached: { value: ProviderSettings; expiresAt: number } | null = null;

/**
 * The four providers, cached for CACHE_TTL_MS. Falls back to all-Anthropic (and
 * logs) if the row can't be read — generation/grading must never block on this.
 */
export async function getProviderSettings(now: number = Date.now()): Promise<ProviderSettings> {
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const row = await readAppSettings();
    const value: ProviderSettings = row
      ? {
          gen: row.genProvider,
          categorize: row.categorizeProvider,
          suggest: row.suggestProvider,
          grade: row.gradeProvider,
        }
      : ALL_ANTHROPIC;
    cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.warn('[llm/settings] getProviderSettings read failed; defaulting to anthropic', {
      message: error instanceof Error ? error.message : String(error),
    });
    // Cache the fallback briefly too, so a hard DB outage doesn't hammer it on
    // every call — the next TTL window retries.
    cached = { value: ALL_ANTHROPIC, expiresAt: now + CACHE_TTL_MS };
    return ALL_ANTHROPIC;
  }
}

/**
 * Persist a partial update to the provider settings and refresh the cache so the
 * next read reflects it immediately (the owner panel calls this on save).
 */
export async function updateProviderSettings(update: AppSettingsUpdate): Promise<ProviderSettings> {
  const row = await writeAppSettings(update);
  const value: ProviderSettings = {
    gen: row.genProvider,
    categorize: row.categorizeProvider,
    suggest: row.suggestProvider,
    grade: row.gradeProvider,
  };
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

// Test seam — drop the in-process cache so a test can observe a fresh read.
export function __resetProviderSettingsCache(): void {
  cached = null;
}
