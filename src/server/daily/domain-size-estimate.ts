import {
  HAIKU_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

/**
 * Corpus-grounded domain SIZE estimate (D-SUPPLY-FINITENESS-01).
 *
 * Answers "how many distinct good daily-five questions can this domain sustain?"
 * — the referee the finiteness state machine and the discrepancy alarm compare
 * REALIZED generation against. This replaces the bare Haiku 1-10 guess in
 * `scoreDomainDepth` (domain-depth.ts) with a resolve → count → normalize pass:
 *
 *   1. RESOLVE  — Haiku disambiguates the domain label against real Wikipedia /
 *      Wikidata candidates and routes it to a SHAPE (+ a fandom host if one
 *      exists). Feeding it candidates (not guessing blind) is what stops
 *      "Classical Symphonic Music" resolving to "Symphonic metal".
 *   2. COUNT    — a SHAPE-AWARE corpus count: author works (Wikidata P50),
 *      article sections, or fandom category/article counts.
 *   3. NORMALIZE— entities × a per-shape questions-per-entity constant, clamped.
 *
 * Everything FAILS OPEN: any outage / malformed response / low-confidence
 * resolution returns null so callers fall back to the existing depth estimate.
 * The estimate is a SEED — the finiteness loop co-calibrates it from observed
 * yield (a domain that keeps yielding past the estimate raises it).
 */

export type DomainShape =
  | 'person_creator'
  | 'single_work'
  | 'series_or_franchise'
  | 'event'
  | 'abstract_topic'
  | 'bespoke';

export type ResolutionConfidence = 'high' | 'medium' | 'low';

export interface DomainSizeEstimate {
  shape: DomainShape;
  /** The raw corpus signal that was counted (works / sections / articles / members). */
  corpusCount: number | null;
  /** Normalized "distinct good questions" the domain can sustain. null → use the Haiku depth fallback. */
  estimatedQuestions: number | null;
  confidence: ResolutionConfidence;
  /** Which signal produced corpusCount — for the dashboard + debugging. */
  basis: string;
  /** Resolved anchors (for auditability / the coverage dashboard). */
  wikipediaTitle: string | null;
  wikidataQid: string | null;
  fandomHost: string | null;
}

// Questions a single counted entity is worth. A work → several askable facts;
// a fandom character/item or an article section → fewer. Tunable; the alarm and
// finiteness gate only need order-of-magnitude accuracy, and co-calibration
// corrects per-domain drift over time.
const K_PER_SHAPE: Record<Exclude<DomainShape, 'bespoke'>, number> = {
  person_creator: 5,
  single_work: 3,
  series_or_franchise: 2.5,
  event: 3,
  abstract_topic: 3,
};

export const SIZE_FLOOR = 20;
export const SIZE_CEIL = 1200;

/**
 * PURE core (unit-tested): counted entities → estimated sustainable questions.
 * Returns null for `bespoke` or an absent/degenerate count so the caller uses
 * the Haiku depth fallback instead of a floored guess.
 */
export function normalizeToQuestionEstimate(
  shape: DomainShape,
  entities: number | null | undefined,
): number | null {
  if (shape === 'bespoke') return null;
  if (entities == null || !Number.isFinite(entities) || entities <= 0) return null;
  const raw = Math.round(entities * K_PER_SHAPE[shape]);
  return Math.max(SIZE_FLOOR, Math.min(SIZE_CEIL, raw));
}

// --- Corpus fetchers (fail-open; plain MediaWiki / Wikidata / Fandom APIs) ---

const UA = 'Joshing/1.0 (domain-size-estimate; +https://joshing.app)';

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// SPARQL COUNT(...) responses share this shape.
type SparqlCount = { results?: { bindings?: { c?: { value?: string } }[] } };
function sparqlCountValue(data: SparqlCount | null): number | null {
  const raw = data?.results?.bindings?.[0]?.c?.value;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function wikipediaSections(title: string): Promise<number | null> {
  const url =
    'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=parse' +
    `&page=${encodeURIComponent(title)}&prop=sections`;
  const data = await fetchJson<{ parse?: { sections?: unknown[] } }>(url);
  const n = data?.parse?.sections?.length;
  return typeof n === 'number' ? n : null;
}

async function wikipediaCandidates(label: string): Promise<{ title: string; snippet: string }[]> {
  const url =
    'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&list=search' +
    `&srsearch=${encodeURIComponent(label)}&srlimit=5`;
  const data = await fetchJson<{ query?: { search?: { title?: string; snippet?: string }[] } }>(url);
  return (data?.query?.search ?? []).map((x) => ({
    title: String(x.title ?? ''),
    snippet: String(x.snippet ?? '').replace(/<[^>]+>/g, '').slice(0, 90),
  }));
}

async function wikidataCandidates(label: string): Promise<{ qid: string; label: string; desc: string }[]> {
  const url =
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=5' +
    `&search=${encodeURIComponent(label)}`;
  const data = await fetchJson<{ search?: { id?: string; label?: string; description?: string }[] }>(url);
  return (data?.search ?? []).map((x) => ({
    qid: String(x.id ?? ''),
    label: String(x.label ?? ''),
    desc: String(x.description ?? ''),
  }));
}

async function resolveQidByTitle(title: string): Promise<string | null> {
  const url =
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=1' +
    `&search=${encodeURIComponent(title)}`;
  const data = await fetchJson<{ search?: { id?: string }[] }>(url);
  return data?.search?.[0]?.id ?? null;
}

async function worksAuthored(qid: string): Promise<number | null> {
  const sparql = `SELECT (COUNT(DISTINCT ?w) AS ?c) WHERE { ?w wdt:P50 wd:${qid}. }`;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  return sparqlCountValue(await fetchJson<SparqlCount>(url, 25_000));
}

/** Whole-wiki article count — the reliable franchise size signal (bounded by the CEIL downstream). */
async function fandomArticles(host: string): Promise<number | null> {
  const url = `https://${host}/api.php?action=query&meta=siteinfo&siprop=statistics&format=json`;
  const data = await fetchJson<{ query?: { statistics?: { articles?: number } } }>(url);
  const n = data?.query?.statistics?.articles;
  return typeof n === 'number' ? n : null;
}

/**
 * Sub-topic entity count: sum members of CONTENT categories on `host` whose
 * titles match `phrase` (e.g. "… in Tears of the Kingdom"). Scopes a rich work
 * inside a broader fandom without pulling the whole wiki. Members capped at 500
 * per category — the estimate only needs magnitude.
 */
async function fandomScopedEntities(host: string, phrase: string): Promise<number | null> {
  const search = await fetchJson<{ query?: { search?: { title?: string }[] } }>(
    `https://${host}/api.php?action=query&list=search&srnamespace=14&srlimit=8&format=json` +
      `&srsearch=${encodeURIComponent(phrase)}`,
  );
  const cats: string[] = (search?.query?.search ?? [])
    .map((x) => String(x.title ?? ''))
    .filter((c) =>
      /character|item|location|episode|film|song|quest|boss|weapon|creature|species|planet|ship/i.test(c),
    );
  if (cats.length === 0) return null;
  let sum = 0;
  for (const c of cats.slice(0, 8)) {
    const info = await fetchJson<{ query?: { categorymembers?: unknown[] } }>(
      `https://${host}/api.php?action=query&list=categorymembers&cmlimit=500&format=json` +
        `&cmtitle=${encodeURIComponent(c)}`,
    );
    sum += info?.query?.categorymembers?.length ?? 0;
  }
  return sum > 0 ? sum : null;
}

// --- Haiku resolution (candidate-grounded disambiguation + routing) ---

interface Route {
  wikipediaTitle: string | null;
  wikidataQid: string | null;
  shape: DomainShape;
  fandomHost: string | null;
  confidence: ResolutionConfidence;
  /** A distinctive phrase for scoped fandom category lookup (defaults to the label). */
  phrase: string | null;
}

const RESOLVE_SYSTEM = `You route a trivia DOMAIN to its best knowledge-base anchor for estimating how many distinct quiz questions it can support. You are given the domain label plus candidate matches from Wikipedia and Wikidata. Choose the anchor that represents the FULL domain as a trivia player means it — NOT a coincidental name match (e.g. "Classical Symphonic Music" is NOT "Symphonic metal"; "Hamlet" the play is NOT the settlement type). Prefer null over a wrong match. Classify the shape. If a large dedicated Fandom wiki plausibly exists, give its host (e.g. starwars.fandom.com). Output STRICT JSON only, no prose.
Schema: {"wikipedia_title": string|null, "wikidata_qid": string|null, "shape": "person_creator"|"single_work"|"series_or_franchise"|"event"|"abstract_topic"|"bespoke", "fandom_host": string|null, "phrase": string|null, "confidence": "high"|"medium"|"low"}`;

const VALID_SHAPES: ReadonlySet<string> = new Set<DomainShape>([
  'person_creator',
  'single_work',
  'series_or_franchise',
  'event',
  'abstract_topic',
  'bespoke',
]);

async function resolveRoute(label: string): Promise<Route | null> {
  const client = getAnthropicClient();
  if (!client) return null;
  const [wp, wd] = await Promise.all([wikipediaCandidates(label), wikidataCandidates(label)]);
  const user = `DOMAIN: ${label}\n\nWIKIPEDIA_CANDIDATES: ${JSON.stringify(wp)}\n\nWIKIDATA_CANDIDATES: ${JSON.stringify(wd)}`;
  try {
    const response = await loggedMessagesCreate(client, 'domain-size-resolve', {
      model: HAIKU_MODEL,
      max_tokens: 300,
      temperature: 0,
      system: RESOLVE_SYSTEM,
      messages: [{ role: 'user', content: wrapUserInput('domain', user) }],
    });
    const parsed = parseJsonObject(extractTextContent(response.content));
    if (!parsed) return null;
    const shape = String(parsed.shape ?? '');
    if (!VALID_SHAPES.has(shape)) return null;
    const conf = String(parsed.confidence ?? 'low');
    return {
      wikipediaTitle: parsed.wikipedia_title ? String(parsed.wikipedia_title) : null,
      wikidataQid: parsed.wikidata_qid ? String(parsed.wikidata_qid) : null,
      shape: shape as DomainShape,
      fandomHost: parsed.fandom_host ? String(parsed.fandom_host) : null,
      confidence: (conf === 'high' || conf === 'medium' ? conf : 'low') as ResolutionConfidence,
      phrase: parsed.phrase ? String(parsed.phrase) : null,
    };
  } catch {
    return null;
  }
}

// --- Shape-aware counting: route → corpusCount + basis ---

async function countForRoute(
  label: string,
  route: Route,
): Promise<{ corpusCount: number | null; basis: string; fandomHost: string | null }> {
  const { shape } = route;

  if (shape === 'bespoke') return { corpusCount: null, basis: 'bespoke', fandomHost: null };

  if (shape === 'person_creator') {
    const qid = route.wikidataQid ?? (route.wikipediaTitle ? await resolveQidByTitle(route.wikipediaTitle) : null);
    const works = qid ? await worksAuthored(qid) : null;
    if (works && works > 0) return { corpusCount: works, basis: `wikidata:works(P50,${qid})`, fandomHost: null };
    const sections = route.wikipediaTitle ? await wikipediaSections(route.wikipediaTitle) : null;
    return { corpusCount: sections, basis: 'wp:sections(no-works)', fandomHost: null };
  }

  if (shape === 'series_or_franchise') {
    // Verify any proposed host (catches hallucinated hosts) and use the RELIABLE
    // whole-wiki article count — it clamps to the CEIL, so a franchise never
    // falsely reads as small/complete the way a flaky category search can.
    if (route.fandomHost) {
      const articles = await fandomArticles(route.fandomHost);
      if (articles && articles > 0) {
        return { corpusCount: articles, basis: 'fandom:articles', fandomHost: route.fandomHost };
      }
    }
    const qid = route.wikidataQid;
    if (qid) {
      const sparql = `SELECT (COUNT(DISTINCT ?x) AS ?c) WHERE { ?x ?p wd:${qid}. VALUES ?p { wdt:P1441 wdt:P179 wdt:P361 } }`;
      const n = sparqlCountValue(
        await fetchJson<SparqlCount>(
          `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
          25_000,
        ),
      );
      if (n != null && n > 0) return { corpusCount: n, basis: 'wikidata:appearances', fandomHost: null };
    }
    const sections = route.wikipediaTitle ? await wikipediaSections(route.wikipediaTitle) : null;
    return { corpusCount: sections, basis: 'wp:sections(franchise-fallback)', fandomHost: null };
  }

  if (shape === 'single_work') {
    // Rich works (a big game inside a fandom) → scoped category sum; text works
    // (a play/book) → sections. Take the larger so a content-rich work isn't
    // undercounted by its short encyclopedia article.
    let host: string | null = null;
    let scoped: number | null = null;
    if (route.fandomHost && (await fandomArticles(route.fandomHost))) {
      host = route.fandomHost;
      scoped = await fandomScopedEntities(route.fandomHost, route.phrase ?? label);
    }
    const sections = route.wikipediaTitle ? await wikipediaSections(route.wikipediaTitle) : null;
    const best = Math.max(scoped ?? 0, sections ?? 0) || null;
    const basis = (scoped ?? 0) >= (sections ?? 0) && scoped ? 'fandom:scoped-categories' : 'wp:sections';
    return { corpusCount: best, basis, fandomHost: host };
  }

  // event | abstract_topic
  const sections = route.wikipediaTitle ? await wikipediaSections(route.wikipediaTitle) : null;
  return { corpusCount: sections, basis: 'wp:sections', fandomHost: null };
}

/**
 * Orchestrator: resolve → count → normalize. Returns null on any failure so the
 * caller falls back to the Haiku depth estimate. A `low`-confidence resolution
 * still returns an estimate, but callers should NOT fire the discrepancy alarm
 * off it (confidence-gate the alarm, not the estimate).
 */
export async function estimateDomainSize(label: string): Promise<DomainSizeEstimate | null> {
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean) return null;

  const route = await resolveRoute(clean);
  if (!route) return null;

  const { corpusCount, basis, fandomHost } = await countForRoute(clean, route);
  const estimatedQuestions = normalizeToQuestionEstimate(route.shape, corpusCount);

  return {
    shape: route.shape,
    corpusCount,
    estimatedQuestions,
    confidence: route.confidence,
    basis,
    wikipediaTitle: route.wikipediaTitle,
    wikidataQid: route.wikidataQid,
    fandomHost: fandomHost ?? route.fandomHost,
  };
}
