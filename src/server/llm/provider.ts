/**
 * Provider abstraction for the Anthropic ↔ OpenAI A/B switch
 * (B-LLM-PROVIDER-AB-SWITCH, phase B1).
 *
 * This module owns the OpenAI side only. The Anthropic side stays exactly where
 * it is (`src/lib/llm.ts`): the four surface functions keep their existing
 * Anthropic code path verbatim and add a parallel OpenAI branch that produces
 * the *same* text the existing validators already parse. The dispatch helper
 * that picks the branch lives in `src/lib/llm.ts` (`dispatchLlmText`) so it can
 * reuse `getAnthropicClient`/`loggedMessagesCreate`/`extractTextContent` without
 * a circular import — this file deliberately imports nothing from there.
 *
 * Default everything to Anthropic. Nothing here runs unless a caller explicitly
 * passes `provider: 'openai'`, and that only happens once B2 wires the settings.
 */

import OpenAI from 'openai';

import { recordLlmUsage } from '@/server/db/queries/llm-provider-experiment';

// The single source of truth for which provider a surface routes to. Anthropic
// is always the default; OpenAI is the opt-in test arm.
export type LlmProvider = 'anthropic' | 'openai';

const OPENAI_PLACEHOLDER_KEYS = new Set([
  '',
  'placeholder',
  'your_api_key_here',
  'changeme',
  'undefined',
  'null',
]);

// Model strings are deploy-time choices, not hardcodes: OpenAI's lineup and
// pricing move, so the exact model is read from env with a sensible default.
// The flagship default is gpt-4.1-mini — the cost/quality trade chosen after the
// cost readout showed gpt-4o running ~5x the Anthropic arm (see the OpenAI rows
// in src/server/llm/pricing.ts; gpt-4.1-mini is ~84% cheaper on a generation
// workload). For a stricter quality comparison against Sonnet, override
// OPENAI_MODEL to gpt-4.1 (or gpt-4o) — both are priced in the cost map.
// Grading stays on a cheaper mini for the high-volume path. Override
// OPENAI_MODEL / OPENAI_GRADING_MODEL to pin the exact strings without a code change.
export const OPENAI_FLAGSHIP_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
export const OPENAI_GRADING_MODEL = process.env.OPENAI_GRADING_MODEL?.trim() || 'gpt-4o-mini';

// Default per-call timeout, mirrors DEFAULT_LLM_TIMEOUT_MS on the Anthropic side
// so a stalled OpenAI socket can't blow a Vercel function budget either.
const DEFAULT_OPENAI_TIMEOUT_MS = 20_000;

let cachedClient: OpenAI | null = null;
let cachedClientKey: string | null = null;
let hasLoggedInvalidApiKey = false;

function isValidOpenAIApiKey(apiKey: string | undefined): apiKey is string {
  if (!apiKey) return false;
  const normalized = apiKey.trim();
  if (!normalized || OPENAI_PLACEHOLDER_KEYS.has(normalized.toLowerCase())) {
    return false;
  }
  // OpenAI keys start with `sk-` (project keys `sk-proj-`); guard length so an
  // obvious placeholder doesn't sail through.
  return normalized.startsWith('sk-') && normalized.length > 'sk-'.length + 8;
}

/**
 * Cached OpenAI client. Mirrors getAnthropicClient() in src/lib/llm.ts: honours
 * the LLM_ENABLED kill-switch, validates the key, and returns null (rather than
 * throwing) when the key is missing/invalid so callers fall back exactly as the
 * Anthropic null-client path does. Never expose this client or the key to the
 * browser — server-only, like the Anthropic client.
 */
export function getOpenAIClient(): OpenAI | null {
  if (process.env.LLM_ENABLED === 'false') {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!isValidOpenAIApiKey(apiKey)) {
    if (!hasLoggedInvalidApiKey) {
      console.warn('[LLM] OpenAI disabled: OPENAI_API_KEY is missing or invalid');
      hasLoggedInvalidApiKey = true;
    }
    return null;
  }

  hasLoggedInvalidApiKey = false;
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new OpenAI({ apiKey });
    cachedClientKey = apiKey;
  }
  return cachedClient;
}

/**
 * One OpenAI chat completion → plain text. The OpenAI branch of every surface
 * funnels through here: same prompt text as the Anthropic branch, only the
 * request envelope differs (system message instead of a `system` field, a
 * single text choice instead of content blocks).
 *
 * Returns `null` when the client is unavailable (missing key / kill-switch) so
 * the caller hits its existing fallback, identical to the Anthropic
 * null-client return. Throws on an API error, mirroring loggedMessagesCreate,
 * so the surface's existing retry/catch handles both providers the same way.
 *
 * Every Joshing prompt already instructs "Return JSON only", so json_object
 * response format keeps the output contract identical to the Anthropic branch
 * — the same `parseJsonObject(text)` downstream consumes both.
 */
export async function openaiCompleteJsonText(opts: {
  scope: string;
  systemText: string;
  userText: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
}): Promise<string | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
  try {
    const response = await client.chat.completions.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: opts.systemText },
          { role: 'user', content: opts.userText },
        ],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );

    const usage = response.usage;
    console.info('[llm]', {
      scope: opts.scope,
      provider: 'openai',
      model: opts.model,
      duration_ms: Date.now() - startedAt,
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    });
    // B-LLM-PROVIDER-AB-METRICS Part 2: persist usage for the cost rollup.
    // Fire-and-forget — recordLlmUsage swallows its own errors. (OpenAI's
    // chat-completions usage has no separate cache buckets on this path.)
    void recordLlmUsage({
      scope: opts.scope,
      provider: 'openai',
      model: opts.model,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      durationMs: Date.now() - startedAt,
    });
    return response.choices[0]?.message?.content ?? '';
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    console.warn(isTimeout ? '[llm] openai timeout' : '[llm] openai error', {
      scope: opts.scope,
      model: opts.model,
      duration_ms: Date.now() - startedAt,
      timeout_ms: timeoutMs,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
