/**
 * Joshing embeddings — Voyage AI client (B1 pool substrate, PRD-D-5 §5.1/§7).
 *
 * The rest of the pipeline is Anthropic-only and Anthropic ships no first-party
 * embedding model, so the pool's semantic-dedup backstop uses Voyage AI
 * (Anthropic's recommended embeddings partner). Model: voyage-3.5-lite,
 * 1024-dim. All calls are server-side only.
 *
 * Graceful by design (mirrors getAnthropicClient): with no VOYAGE_API_KEY — or
 * LLM_ENABLED=false — every entry point returns null and callers fall back to
 * the cheap deterministic guards (fact_key + Haiku + normalized text). This is
 * what keeps embedding dedup OFF until the key is provisioned, so B1 ships with
 * no behavior change.
 */

export const VOYAGE_EMBEDDING_MODEL = 'voyage-3.5-lite';
export const EMBEDDING_DIMENSIONS = 1024;
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
// Voyage caps batches at 1000 inputs / 120k tokens; stay well under for safety.
export const EMBEDDING_BATCH_SIZE = 128;

let hasLoggedMissingKey = false;

export function isEmbeddingEnabled(): boolean {
  if (process.env.LLM_ENABLED === 'false') return false;
  return Boolean(process.env.VOYAGE_API_KEY?.trim());
}

type VoyageResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
};

async function callVoyage(
  inputs: string[],
  inputType: 'query' | 'document',
): Promise<number[][] | null> {
  const apiKey = process.env.VOYAGE_API_KEY?.trim();
  if (process.env.LLM_ENABLED === 'false' || !apiKey) {
    if (!hasLoggedMissingKey) {
      console.warn('[embeddings] Voyage disabled: VOYAGE_API_KEY missing — dedup falls back to deterministic guards');
      hasLoggedMissingKey = true;
    }
    return null;
  }
  hasLoggedMissingKey = false;

  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: inputs,
        model: VOYAGE_EMBEDDING_MODEL,
        input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) {
      console.warn('[embeddings] Voyage request failed', { status: res.status });
      return null;
    }
    const json = (await res.json()) as VoyageResponse;
    const data = json.data;
    if (!data?.length) return null;
    // Preserve request order (Voyage returns an index per item).
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((d) => d.embedding);
    if (vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS)) {
      console.warn('[embeddings] Voyage returned unexpected vector shape');
      return null;
    }
    return vectors as number[][];
  } catch (error) {
    console.warn('[embeddings] Voyage call threw', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Embed a single text. Returns null when disabled or on any failure. */
export async function embedText(
  text: string,
  inputType: 'query' | 'document' = 'document',
): Promise<number[] | null> {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const vectors = await callVoyage([trimmed], inputType);
  return vectors?.[0] ?? null;
}

/**
 * Embed many texts in batches. Returns one entry per input (null for blanks),
 * or null overall when embedding is disabled. Used by the backfill job.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'query' | 'document' = 'document',
): Promise<Array<number[] | null> | null> {
  if (!isEmbeddingEnabled()) return null;
  const out: Array<number[] | null> = new Array(texts.length).fill(null);
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const nonBlank = slice
      .map((t, i) => ({ t: t?.trim() ?? '', i }))
      .filter((x) => x.t.length > 0);
    if (!nonBlank.length) continue;
    const vectors = await callVoyage(nonBlank.map((x) => x.t), inputType);
    if (!vectors) return null;
    nonBlank.forEach((x, k) => {
      out[start + x.i] = vectors[k] ?? null;
    });
  }
  return out;
}
