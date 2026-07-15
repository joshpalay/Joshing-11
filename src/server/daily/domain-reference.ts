/**
 * D-FANDOM-GROUNDING-01 — the retrieval layer (ratified A2+B2+C+D1+E+F1).
 *
 * One canon-scoped reference passage per (domain, day), retrieved via the
 * Anthropic web_search tool restricted to Wikipedia + Fandom (D1: reuse the
 * native tool rather than build a fetch+parse layer; D2 deferred). Cached in
 * DomainReferencePassage (0108) so the whole org pays at most one retrieval per
 * domain per day — every user's generation run after the first reads the cache.
 *
 * Consumer A (generate-questions.ts) feeds the passage into the generation
 * prompt as a provenance-labeled reference anchor (B2) with a "prefer facts in
 * the passage" instruction (A2) — a SOFT anchor: the model still writes freely,
 * and the demote-only batch verifier remains the enforcement boundary.
 *
 * Source tiering is asymmetric on purpose: Wikipedia is the primary anchor;
 * Fandom earns its place only where Wikipedia thins out (deep-specialist
 * miss-domains), and the retrieval prompt section-scopes Fandom to in-universe
 * canon (skip Trivia / Behind the Scenes / production / speculation — un-scoped
 * Fandom "trivia" is production gossip and fan theory).
 *
 * Fail-open everywhere: no client, a timeout, an unparseable reply, or a
 * cache-write failure just means no reference block this round — identical to
 * the authored-examples anchor's resilience contract. Spend is ledgered under
 * scope 'domain-reference' (tokens + web_search_requests, 0105).
 */
import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '@/lib/llm';
import {
  getReferencePassageRows,
  upsertReferencePassage,
} from '@/server/db/queries/domain-reference';

/** F1 source allowlist — shared with Consumer B's verifier posture. */
export const REFERENCE_WIKI_DOMAINS = ['wikipedia.org', 'fandom.com'];

export function isGenerationWikiAnchorEnabled(): boolean {
  const raw = process.env.GENERATION_WIKI_ANCHOR_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// Decision E: per-domain daily cache. Wiki content is stable enough that a
// 24h TTL loses nothing; 'none' rows honor the same TTL (negative cache).
const REFERENCE_TTL_MS = 24 * 60 * 60 * 1000;

// Per-run fetch cap: the daily cron fans out per user, so an uncapped cold
// start would retrieve for every user's thin domains at once. Capped, the
// cache warms over a few runs and steady state is ~one retrieval per domain
// per day org-wide. Tunable without a deploy.
const MAX_FETCHES_PER_RUN = Math.max(
  0,
  Number(process.env.DOMAIN_REFERENCE_MAX_FETCHES_PER_RUN ?? 4),
);

// Retrieval quality is the load-bearing risk (a fanon/wrong passage poisons
// BOTH consumers), so this defaults to the generation-tier model, overridable
// for a measured cheap run. One cached call per domain per day keeps the delta
// small either way.
const REFERENCE_MODEL = process.env.DOMAIN_REFERENCE_MODEL?.trim() || ANTHROPIC_MODEL;

const RETRIEVAL_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.DOMAIN_REFERENCE_TIMEOUT_MS ?? 30_000),
);

const PASSAGE_MAX_CHARS = 1200;

// Which source the retriever should lead with for a domain. Default is
// Wikipedia-first (the historic behavior + good for real-world topics). A deep
// fan domain — sized off its Fandom category tree — must lead with FANDOM
// in-universe canon instead, or it gets a shallow "game-as-product" Wikipedia
// blurb (release date, studio, sales) that yields almost no fan-salient
// questions. See resolveReferenceSourcePreference.
export type ReferenceSourcePreference = 'wikipedia' | 'fandom';

// Per-domain routing input, mirroring DomainDepthEstimate's resolution provenance.
export type ReferenceRoutingHint = {
  basis: string | null;
  fandomHost: string | null;
  wikipediaTitle: string | null;
};

/**
 * Pure: pick the lead source for a domain from how it was SIZED. A domain sized
 * off Fandom (basis `fandom:*`) or with a resolved dedicated Fandom wiki host is
 * a deep fan domain whose questions live in in-universe canon — lead with Fandom.
 * Everything else (Wikipedia-sectioned real-world topics, or unsized domains with
 * no hint) keeps the Wikipedia-first default. Exported for unit tests.
 */
export function resolveReferenceSourcePreference(
  hint: ReferenceRoutingHint | undefined,
): ReferenceSourcePreference {
  if (!hint) return 'wikipedia';
  if (hint.fandomHost && hint.fandomHost.trim()) return 'fandom';
  if (hint.basis && hint.basis.trim().toLowerCase().startsWith('fandom')) return 'fandom';
  return 'wikipedia';
}

// The Wikipedia-first prompt (default / real-world topics).
const RETRIEVAL_SYSTEM_PROMPT_WIKIPEDIA = `You retrieve ONE compact reference passage of established facts about a trivia domain, for grounding question generation. Use the web_search tool (it is restricted to Wikipedia and Fandom).

Source tiering — NOT equal votes:
1. Prefer Wikipedia. It is the primary anchor.
2. Use Fandom ONLY when Wikipedia has little or nothing on the domain (deep fan domains). When reading Fandom, use ONLY in-universe canon / factual sections — NEVER Trivia, Behind the Scenes, Speculation, production, or fan-theory material.
3. If neither source covers the domain, say so — do not improvise from memory.

Write the passage yourself as plain factual sentences (max ${PASSAGE_MAX_CHARS} characters): concrete, stable, verifiable facts a question-writer can anchor to — names, relationships, events, works, dates. No opinions, no fan speculation, no plot summary padding.

Return ONE JSON object only, no prose outside it:
{ "found": true | false, "source": "wikipedia" | "fandom", "source_url": "<page url>", "passage": "<the passage>" }
- found=false (omit the other fields) when neither source has real coverage.`;

// The Fandom-first prompt (deep fan domains sized off a Fandom corpus). Leads
// with in-universe canon and deliberately maximizes the DENSITY and VARIETY of
// concrete facts in the single passage — the same 1,200 chars should surface as
// many distinct, question-able facts as possible across characters, locations,
// items/mechanics, events/story, and lore, because for these domains a shallow
// overview is exactly what produces zero usable questions. Wikipedia is demoted
// to at most high-level framing.
const RETRIEVAL_SYSTEM_PROMPT_FANDOM = `You retrieve ONE dense reference passage of established IN-UNIVERSE facts about a deep fan domain (a game, show, book series, or franchise), for grounding trivia question generation. Use the web_search tool (it is restricted to Wikipedia and Fandom).

Source tiering — NOT equal votes:
1. Prefer FANDOM. This domain's questions live in its in-universe canon — characters, locations, items, abilities/mechanics, quests/events, factions, and lore. Read ONLY canon / factual sections. NEVER use Trivia, Behind the Scenes, Speculation, production/development, sales/reception, or fan-theory material.
2. Use Wikipedia only for high-level framing if Fandom is thin — never as the primary anchor for a deep fan domain.
3. If neither source has real in-universe coverage, say so — do not improvise from memory.

Pack the passage with as MANY distinct, concrete, specific facts as fit (max ${PASSAGE_MAX_CHARS} characters), spread ACROSS facets — characters and who they are, named locations, specific items/abilities and what they do, specific quests/events and outcomes, factions, and named lore. Prefer the specific over the general: proper nouns, exact relationships, exact effects. No opinions, no production/meta facts (release date, studio, voice cast, sales), no plot-summary padding.

Return ONE JSON object only, no prose outside it:
{ "found": true | false, "source": "wikipedia" | "fandom", "source_url": "<page url>", "passage": "<the passage>" }
- found=false (omit the other fields) when neither source has real in-universe coverage.`;

function retrievalSystemPrompt(pref: ReferenceSourcePreference): string {
  return pref === 'fandom' ? RETRIEVAL_SYSTEM_PROMPT_FANDOM : RETRIEVAL_SYSTEM_PROMPT_WIKIPEDIA;
}

/**
 * Pure: the per-domain user message, scoped by any resolved source pages so the
 * search lands on the right wiki instead of guessing. Exported for unit tests.
 */
export function buildRetrievalUserMessage(
  domain: string,
  hint: ReferenceRoutingHint | undefined,
  pref: ReferenceSourcePreference,
): string {
  const lines = [`Domain: ${domain}`];
  if (pref === 'fandom' && hint?.fandomHost?.trim()) {
    lines.push(`This domain's canon lives on the Fandom wiki at ${hint.fandomHost.trim()} — search there first.`);
  }
  if (pref === 'wikipedia' && hint?.wikipediaTitle?.trim()) {
    lines.push(`The primary Wikipedia article is titled "${hint.wikipediaTitle.trim()}".`);
  }
  lines.push('Retrieve the reference passage. JSON only.');
  return lines.join('\n');
}

export type DomainReference = { source: 'wikipedia' | 'fandom'; passage: string };
export type DomainReferences = ReadonlyMap<string, DomainReference>;

export type ParsedRetrieval =
  | { found: false }
  | { found: true; source: 'wikipedia' | 'fandom'; passage: string; sourceUrl: string | null };

/** Pure: parse the retrieval call's JSON reply. Exported for unit tests. */
export function parseReferenceResponse(raw: string): ParsedRetrieval | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  if (parsed.found === false) return { found: false };
  if (parsed.found !== true) return null;
  const source = parsed.source;
  if (source !== 'wikipedia' && source !== 'fandom') return null;
  const passage = typeof parsed.passage === 'string' ? parsed.passage.trim() : '';
  if (!passage) return null;
  const sourceUrl = typeof parsed.source_url === 'string' && parsed.source_url.trim()
    ? parsed.source_url.trim()
    : null;
  return { found: true, source, passage: passage.slice(0, PASSAGE_MAX_CHARS), sourceUrl };
}

/**
 * Pure (decision C): true when a generated question's text is a verbatim lift
 * from its source passage. Grounding-only means passage prose must never be
 * persisted into a served question — this is the lint the D-doc requires.
 * Exported for unit tests and applied by generate-questions on anchored domains.
 */
export function questionLeaksPassageText(questionText: string, passage: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = normalize(questionText);
  // Below ~40 normalized chars a "match" is a common phrase, not a lift.
  if (q.length < 40) return false;
  return normalize(passage).includes(q);
}

/**
 * Cache-first reference passages for `domains`. Fresh cache rows are returned
 * directly ('none' rows are respected as negative cache); stale/missing domains
 * are retrieved live, up to MAX_FETCHES_PER_RUN per call. Never throws.
 */
export async function getReferencePassagesForDomains(
  domains: string[],
  // Per-domain routing hints (keyed by the EXACT domain string in `domains`).
  // Absent → Wikipedia-first default, byte-for-byte the prior behavior. A hint
  // sized off Fandom routes retrieval to the in-universe-canon prompt so a deep
  // fan domain grounds from the well that sized it (Layer 3).
  hintByDomain?: ReadonlyMap<string, ReferenceRoutingHint>,
): Promise<Map<string, DomainReference>> {
  const result = new Map<string, DomainReference>();
  if (domains.length === 0) return result;

  let toFetch: string[] = [];
  try {
    const cached = await getReferencePassageRows(domains);
    const now = Date.now();
    for (const domain of domains) {
      const row = cached.get(domain);
      if (row && now - row.fetchedAt.getTime() < REFERENCE_TTL_MS) {
        if (row.source !== 'none' && row.passage) {
          result.set(domain, { source: row.source, passage: row.passage });
        }
        continue; // fresh (including fresh 'none') — no retrieval
      }
      toFetch.push(domain);
    }
  } catch (error) {
    console.warn('[domain-reference] cache read failed; skipping retrieval this round', {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  toFetch = toFetch.slice(0, MAX_FETCHES_PER_RUN);
  if (toFetch.length === 0) return result;

  const client = getAnthropicClient();
  if (!client) return result;

  for (const domain of toFetch) {
    try {
      const hint = hintByDomain?.get(domain);
      const pref = resolveReferenceSourcePreference(hint);
      const response = await loggedMessagesCreate(
        client,
        'domain-reference',
        {
          model: REFERENCE_MODEL,
          max_tokens: 1500,
          system: retrievalSystemPrompt(pref),
          messages: [
            {
              role: 'user',
              content: buildRetrievalUserMessage(domain, hint, pref),
            },
          ],
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 3,
              allowed_domains: REFERENCE_WIKI_DOMAINS,
            },
          ],
        },
        { timeoutMs: RETRIEVAL_TIMEOUT_MS },
      );
      const parsed = parseReferenceResponse(extractTextContent(response.content));
      if (!parsed) {
        console.warn('[domain-reference] unparseable retrieval reply', { domain });
        continue; // no upsert — retried next run
      }
      if (parsed.found) {
        await upsertReferencePassage({
          canonicalSubcategory: domain,
          source: parsed.source,
          passage: parsed.passage,
          sourceUrl: parsed.sourceUrl,
        });
        result.set(domain, { source: parsed.source, passage: parsed.passage });
      } else {
        await upsertReferencePassage({
          canonicalSubcategory: domain,
          source: 'none',
          passage: null,
          sourceUrl: null,
        });
      }
    } catch (error) {
      // Fail open per domain: a timeout or API error costs this domain its
      // anchor for a day, nothing more. No 'none' upsert on errors — a transient
      // failure should not negative-cache the domain.
      console.warn('[domain-reference] retrieval failed', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
