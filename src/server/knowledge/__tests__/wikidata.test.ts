import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearWikidataCache,
  getWikidataParents,
  getWikidataStructure,
  isWikidataQid,
  resolveWikidataEntity,
} from '@/server/knowledge/wikidata';

// All HTTP is mocked — the resolver must work against fixtures (slate P3
// done-when) and degrade to null/empty on any network failure.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const SEARCH_FIXTURE = {
  search: [{ id: 'Q4692', label: 'Renaissance', description: 'European cultural period' }],
};

function sparqlFixture(rows: Array<{ qid: string; label: string; description?: string }>) {
  return {
    results: {
      bindings: rows.map((r) => ({
        item: { value: `http://www.wikidata.org/entity/${r.qid}` },
        itemLabel: { value: r.label },
        ...(r.description ? { itemDescription: { value: r.description } } : {}),
      })),
    },
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  clearWikidataCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isWikidataQid', () => {
  it('accepts Q-numbers and rejects everything else', () => {
    expect(isWikidataQid('Q42')).toBe(true);
    expect(isWikidataQid('P279')).toBe(false);
    expect(isWikidataQid('Q42; DROP TABLE')).toBe(false);
    expect(isWikidataQid('')).toBe(false);
  });
});

describe('resolveWikidataEntity', () => {
  it('resolves a known label to its QID via wbsearchentities', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE));
    const entity = await resolveWikidataEntity('Renaissance');
    expect(entity).toEqual({
      qid: 'Q4692',
      label: 'Renaissance',
      description: 'European cultural period',
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('wbsearchentities');
    expect(url).toContain('search=Renaissance');
    // Wikimedia etiquette: a descriptive User-Agent on every request.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['user-agent']).toContain('JoshingKnowledgeAdmin');
  });

  it('caches the resolution — a second call makes no HTTP request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE));
    await resolveWikidataEntity('Renaissance');
    const again = await resolveWikidataEntity('renaissance'); // fold-insensitive key
    expect(again?.qid).toBe('Q4692');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to null when the network fails or the payload is junk', async () => {
    fetchMock.mockRejectedValueOnce(new Error('egress blocked'));
    expect(await resolveWikidataEntity('Renaissance')).toBeNull();
    clearWikidataCache();
    fetchMock.mockResolvedValueOnce(jsonResponse({ search: [] }));
    expect(await resolveWikidataEntity('Spy School Books 1-6')).toBeNull();
  });
});

describe('getWikidataParents', () => {
  it('returns direct is-a parents and never uses a transitive path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        sparqlFixture([
          { qid: 'Q11042', label: 'culture', description: 'social behavior' },
          { qid: 'Q186509', label: 'period' },
        ]),
      ),
    );
    const parents = await getWikidataParents('Q4692');
    expect(parents.map((p) => p.qid)).toEqual(['Q11042', 'Q186509']);
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('wdt:P279|wdt:P31');
    // Depth cap of 1 — a transitive query would reintroduce deep garbage paths.
    expect(url).not.toMatch(/P279[*+]/);
  });

  it('drops entities with no English label (QID echoed as label) and rejects bad QIDs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        sparqlFixture([
          { qid: 'Q999', label: 'Q999' }, // label-service echo — useless as a proposal
          { qid: 'Q11042', label: 'culture' },
        ]),
      ),
    );
    const parents = await getWikidataParents('Q4692');
    expect(parents.map((p) => p.label)).toEqual(['culture']);
    // Malformed QID → no query at all.
    expect(await getWikidataParents('DROP TABLE')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to an empty list on SPARQL failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    expect(await getWikidataParents('Q4692')).toEqual([]);
  });
});

describe('getWikidataStructure', () => {
  it('resolves a label and returns parents, children, and siblings — one hop each', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE)) // resolve
      .mockResolvedValueOnce(jsonResponse(sparqlFixture([{ qid: 'Q11042', label: 'culture' }]))) // parents
      .mockResolvedValueOnce(
        jsonResponse(sparqlFixture([{ qid: 'Q1474884', label: 'Italian Renaissance' }])),
      ) // children
      .mockResolvedValueOnce(jsonResponse(sparqlFixture([{ qid: 'Q37853', label: 'Baroque' }]))); // siblings
    const structure = await getWikidataStructure('Renaissance');
    expect(structure?.entity.qid).toBe('Q4692');
    expect(structure?.parents.map((p) => p.label)).toEqual(['culture']);
    expect(structure?.children.map((c) => c.label)).toEqual(['Italian Renaissance']);
    expect(structure?.siblings.map((s) => s.label)).toEqual(['Baroque']);
  });

  it('is null when the label does not resolve — the LLM source covers those territories', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ search: [] }));
    expect(await getWikidataStructure('Spy School Books 1-6')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no SPARQL follow-up
  });
});
