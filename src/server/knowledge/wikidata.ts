/**
 * B-KNOWLEDGE-ADMIN-01 P3 — the Wikidata structure proposer (the PREFERRED
 * source: a cleaned is-a ontology, unlike Wikipedia's cyclic category graph,
 * which must NOT be scraped). Resolves a node label to a QID via
 * wbsearchentities, then queries DIRECT structure over SPARQL:
 *
 *   parents  — one hop of `subclass of` (P279) / `instance of` (P31)
 *   children — entities one P279 hop below
 *   siblings — children of the node's parents, minus self
 *
 * Depth is HARD-CAPPED at 1: no transitive P279 paths, ever — transitivity
 * reintroduces the deep-garbage-path problem ("Chicago Stags coaches" 17 hops
 * under Natural Sciences) this design exists to avoid.
 *
 * Nothing here writes anything. Proposals carry their QID so the human sees
 * provenance and the ratified node can store it (KnowledgeNode.wikidata_qid).
 * Every failure — network, egress-blocked, rate-limit, junk response —
 * degrades to null/empty: the admin page never hard-fails on Wikidata.
 */

const SEARCH_ENDPOINT = 'https://www.wikidata.org/w/api.php';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
// Wikimedia asks for a descriptive UA with contact info on API traffic.
const USER_AGENT = 'JoshingKnowledgeAdmin/1.0 (admin taxonomy authoring; joshuapalay@gmail.com)';
const REQUEST_TIMEOUT_MS = 8_000;
// Authoring-time queries against a slow-moving ontology — cache aggressively.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 25;

export type WikidataEntity = {
  qid: string;
  label: string;
  description: string | null;
};

export type WikidataStructure = {
  entity: WikidataEntity;
  /** Direct P279/P31 targets — candidate SUBSTANTIVE parents (a hint: the human still picks the edge type). */
  parents: WikidataEntity[];
  /** Direct P279 children — candidate leaves under this node. */
  children: WikidataEntity[];
  /** Children of this node's parents, minus self. */
  siblings: WikidataEntity[];
};

const QID_RE = /^Q\d+$/;

export function isWikidataQid(value: string): boolean {
  return QID_RE.test(value);
}

const cache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test hook — the module-level cache would otherwise leak between cases. */
export function clearWikidataCache(): void {
  cache.clear();
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null; // egress-blocked / timeout / junk — degrade, never throw
  }
}

/** Label → QID via the MediaWiki wbsearchentities API. Null when nothing matches. */
export async function resolveWikidataEntity(label: string): Promise<WikidataEntity | null> {
  const term = label.trim();
  if (!term) return null;
  const cacheKey = `resolve:${term.toLowerCase()}`;
  const cached = cacheGet<WikidataEntity | null>(cacheKey);
  if (cached !== undefined) return cached;

  const url =
    `${SEARCH_ENDPOINT}?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=1` +
    `&search=${encodeURIComponent(term)}`;
  const body = (await fetchJson(url)) as {
    search?: Array<{ id?: string; label?: string; description?: string }>;
  } | null;

  const hit = body?.search?.[0];
  const entity: WikidataEntity | null =
    hit?.id && isWikidataQid(hit.id) && hit.label
      ? { qid: hit.id, label: hit.label, description: hit.description ?? null }
      : null;
  cacheSet(cacheKey, entity);
  return entity;
}

// SPARQL result rows via the label service. Entities Wikidata has no English
// label for come back with the QID as their label — useless as a proposal,
// dropped.
function parseSparqlEntities(body: unknown): WikidataEntity[] {
  const bindings = (
    body as {
      results?: { bindings?: Array<Record<string, { value?: string } | undefined>> };
    } | null
  )?.results?.bindings;
  if (!Array.isArray(bindings)) return [];

  const out: WikidataEntity[] = [];
  const seen = new Set<string>();
  for (const row of bindings) {
    const uri = row.item?.value ?? '';
    const qid = uri.slice(uri.lastIndexOf('/') + 1);
    const label = row.itemLabel?.value?.trim() ?? '';
    if (!isWikidataQid(qid) || !label || isWikidataQid(label) || seen.has(qid)) continue;
    seen.add(qid);
    out.push({ qid, label, description: row.itemDescription?.value ?? null });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

async function sparqlEntities(query: string, cacheKey: string): Promise<WikidataEntity[]> {
  const cached = cacheGet<WikidataEntity[]>(cacheKey);
  if (cached !== undefined) return cached;
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const body = await fetchJson(url);
  const entities = body ? parseSparqlEntities(body) : [];
  cacheSet(cacheKey, entities);
  return entities;
}

const LABEL_SERVICE = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }';

/** Direct (one-hop) is-a parents: P279 `subclass of` union P31 `instance of`. */
export async function getWikidataParents(qid: string): Promise<WikidataEntity[]> {
  if (!isWikidataQid(qid)) return [];
  const query = `SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
  wd:${qid} wdt:P279|wdt:P31 ?item .
  ${LABEL_SERVICE}
} LIMIT ${MAX_RESULTS}`;
  return sparqlEntities(query, `parents:${qid}`);
}

/** Direct (one-hop) P279 children. */
export async function getWikidataChildren(qid: string): Promise<WikidataEntity[]> {
  if (!isWikidataQid(qid)) return [];
  const query = `SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
  ?item wdt:P279 wd:${qid} .
  ${LABEL_SERVICE}
} LIMIT ${MAX_RESULTS}`;
  return sparqlEntities(query, `children:${qid}`);
}

/** Siblings per the slate's definition: children of the node's parent, minus self. */
export async function getWikidataSiblings(qid: string): Promise<WikidataEntity[]> {
  if (!isWikidataQid(qid)) return [];
  const query = `SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
  wd:${qid} wdt:P279 ?parent .
  ?item wdt:P279 ?parent .
  FILTER(?item != wd:${qid})
  ${LABEL_SERVICE}
} LIMIT ${MAX_RESULTS}`;
  return sparqlEntities(query, `siblings:${qid}`);
}

/**
 * The authoring-time entry point: resolve a node's label and pull its direct
 * structure. Null when the label doesn't resolve (hyper-specific Joshing
 * territories — "Spy School Books 1-6" — won't; the LLM source covers those).
 */
export async function getWikidataStructure(label: string): Promise<WikidataStructure | null> {
  const entity = await resolveWikidataEntity(label);
  if (!entity) return null;
  const [parents, children, siblings] = await Promise.all([
    getWikidataParents(entity.qid),
    getWikidataChildren(entity.qid),
    getWikidataSiblings(entity.qid),
  ]);
  return { entity, parents, children, siblings };
}
