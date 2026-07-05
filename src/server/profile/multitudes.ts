import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL, loggedMessagesCreate } from '@/lib/llm';
import type { MasteryTier } from '@/types/db';
import type { PortraitState } from '@/server/profile/portrait';

// Inherit the central generation model (Sonnet 5 in prod) rather than pinning a
// version, so a model flip carries here too. Prose-only, no schema — the tier
// doesn't matter much, but there's no reason to leave it stranded on 4.6.
const MODEL = ANTHROPIC_MODEL;
const SYSTEM_PROMPT = "You are writing a one-line identity statement for a player in a trivia game where knowledge is identity. Their strongest territories are listed. Write a single sentence — 12 to 25 words — that names their intellectual world with warmth and specificity. Tone: a well-written author bio, not a stats report. Never say 'you are' — the sentence should read like a caption. Specific nouns, not abstractions. The sentence should make the player feel recognized, not evaluated.";

type CacheValue = {
  copy: string;
  createdAt: number;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const TRUNCATION_THRESHOLD_WORDS = 30;
const TRUNCATED_WORD_COUNT = 25;

// NOTE: This is a warm-instance deduplication cache only. On Vercel serverless each cold start
// resets this Map, so it provides no cross-request persistence in production. Its value is
// solely de-duplicating concurrent requests within the same warm function invocation.
// If LLM call volume becomes a concern, replace with Vercel KV or a similar edge-compatible store.
const cache = new Map<string, CacheValue>();

export function buildMultitudesCacheKey(userId: string, categories: string[]): string {
  return `${userId}::${[...categories].sort((a, b) => a.localeCompare(b)).join('|')}`;
}

export function getCachedMultitudesCopy(cacheKey: string): string | null {
  const cached = cache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    cache.delete(cacheKey);
    return null;
  }
  return cached.copy;
}

export function setCachedMultitudesCopy(cacheKey: string, copy: string): void {
  cache.set(cacheKey, { copy, createdAt: Date.now() });
}

export function invalidateMultitudesCacheForUser(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}::`)) {
      cache.delete(key);
    }
  }
}

function truncateCopy(copy: string): string {
  const normalizedCopy = copy.trim();
  const words = normalizedCopy.split(/\s+/).filter(Boolean);

  if (words.length <= TRUNCATION_THRESHOLD_WORDS) return normalizedCopy;

  const truncated = `${words.slice(0, TRUNCATED_WORD_COUNT).join(' ')}…`;
  console.warn(
    `[multitudes] generated copy exceeded ${TRUNCATION_THRESHOLD_WORDS} words; truncated to ${TRUNCATED_WORD_COUNT} words`,
    {
    originalWordCount: words.length,
    truncatedWordCount: TRUNCATED_WORD_COUNT,
    },
  );
  return truncated;
}

export function buildFallbackMultitudesCopy(categories: string[]): string {
  return categories.join(' · ');
}

export async function generateMultitudesCopy(input: {
  top_categories: Array<{ canonical_subcategory: string; tier: MasteryTier }>;
  portrait_state: PortraitState;
}): Promise<{ copy: string; usedFallback: boolean }> {
  const categoryNames = input.top_categories.map((item) => item.canonical_subcategory).filter(Boolean);
  if (categoryNames.length === 0) {
    return { copy: '', usedFallback: true };
  }

  const fallback = buildFallbackMultitudesCopy(categoryNames);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return { copy: fallback, usedFallback: true };
  }

  const client = new Anthropic({ apiKey });
  const userPrompt = JSON.stringify({
    top_categories: input.top_categories,
    portrait_state: input.portrait_state,
  });

  try {
    const response = await loggedMessagesCreate(client, 'multitudes', {
      model: MODEL,
      system: SYSTEM_PROMPT,
      max_tokens: 120,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join(' ')
      .trim();

    if (!text) {
      return { copy: fallback, usedFallback: true };
    }

    return { copy: truncateCopy(text), usedFallback: false };
  } catch (error) {
    console.error('[multitudes] generation failed', error);
    return { copy: fallback, usedFallback: true };
  }
}
