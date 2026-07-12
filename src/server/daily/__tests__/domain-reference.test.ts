import { describe, expect, it } from 'vitest';

import {
  buildRetrievalUserMessage,
  parseReferenceResponse,
  questionLeaksPassageText,
  resolveReferenceSourcePreference,
} from '@/server/daily/domain-reference';
import { buildUserPrompt } from '@/server/daily/generate-questions';

// Pure parts of D-FANDOM-GROUNDING-01: the retrieval reply parser, the
// decision-C leak guard, and the B2 prompt block. Retrieval orchestration
// (cache + web search) is network+DB and is exercised in preview behind
// GENERATION_WIKI_ANCHOR_ENABLED.

describe('parseReferenceResponse', () => {
  it('parses a found wikipedia passage', () => {
    const parsed = parseReferenceResponse(
      JSON.stringify({
        found: true,
        source: 'wikipedia',
        source_url: 'https://en.wikipedia.org/wiki/The_Well-Tempered_Clavier',
        passage: 'The Well-Tempered Clavier is two sets of preludes and fugues by J.S. Bach.',
      }),
    );
    expect(parsed).toMatchObject({ found: true, source: 'wikipedia' });
    if (parsed?.found) expect(parsed.passage).toContain('preludes and fugues');
  });

  it('parses a not-found reply (negative cache path)', () => {
    expect(parseReferenceResponse('{"found": false}')).toEqual({ found: false });
  });

  it('rejects an unknown source rather than trusting it', () => {
    const parsed = parseReferenceResponse(
      JSON.stringify({ found: true, source: 'reddit', passage: 'x'.repeat(80) }),
    );
    expect(parsed).toBeNull();
  });

  it('rejects found-with-empty-passage and non-JSON', () => {
    expect(parseReferenceResponse(JSON.stringify({ found: true, source: 'fandom', passage: ' ' }))).toBeNull();
    expect(parseReferenceResponse('no json here')).toBeNull();
  });

  it('caps an over-long passage', () => {
    const parsed = parseReferenceResponse(
      JSON.stringify({ found: true, source: 'fandom', passage: 'a'.repeat(5000) }),
    );
    if (parsed?.found) expect(parsed.passage.length).toBeLessThanOrEqual(1200);
  });
});

describe('questionLeaksPassageText (decision C guard)', () => {
  const passage =
    'The Well-Tempered Clavier is a collection of two sets of preludes and fugues in all 24 major and minor keys, composed for solo keyboard by Johann Sebastian Bach.';

  it('flags a question that is a verbatim lift from the passage', () => {
    expect(
      questionLeaksPassageText(
        'a collection of two sets of preludes and fugues in all 24 major and minor keys',
        passage,
      ),
    ).toBe(true);
  });

  it('does not flag an original question about the same facts', () => {
    expect(
      questionLeaksPassageText(
        'How many major and minor keys does each book of the Well-Tempered Clavier cover?',
        passage,
      ),
    ).toBe(false);
  });

  it('ignores short common-phrase overlaps', () => {
    expect(questionLeaksPassageText('preludes and fugues', passage)).toBe(false);
  });

  it('normalizes whitespace and case before matching', () => {
    expect(
      questionLeaksPassageText(
        '  A Collection of TWO sets   of preludes and fugues in all 24 major and minor keys ',
        passage,
      ),
    ).toBe(true);
  });
});

describe('resolveReferenceSourcePreference (Layer 3 source routing)', () => {
  it('routes a Fandom-sized domain (basis fandom:*) to fandom', () => {
    expect(
      resolveReferenceSourcePreference({ basis: 'fandom:scoped-categories', fandomHost: null, wikipediaTitle: null }),
    ).toBe('fandom');
  });

  it('routes a domain with a resolved fandom_host to fandom even without a fandom basis', () => {
    expect(
      resolveReferenceSourcePreference({ basis: 'wp:sections', fandomHost: 'zelda.fandom.com', wikipediaTitle: null }),
    ).toBe('fandom');
  });

  it('keeps a Wikipedia-sectioned real-world domain on wikipedia', () => {
    expect(
      resolveReferenceSourcePreference({ basis: 'wp:sections', fandomHost: null, wikipediaTitle: 'Hamlet' }),
    ).toBe('wikipedia');
  });

  it('defaults an unsized/hint-less domain to wikipedia (unchanged behavior)', () => {
    expect(resolveReferenceSourcePreference(undefined)).toBe('wikipedia');
    expect(resolveReferenceSourcePreference({ basis: null, fandomHost: '  ', wikipediaTitle: null })).toBe('wikipedia');
  });
});

describe('buildRetrievalUserMessage (Layer 3 search scoping)', () => {
  it('scopes a fandom fetch to the resolved wiki host', () => {
    const msg = buildRetrievalUserMessage(
      'The Legend of Zelda: Tears of the Kingdom',
      { basis: 'fandom:scoped-categories', fandomHost: 'zelda.fandom.com', wikipediaTitle: null },
      'fandom',
    );
    expect(msg).toContain('zelda.fandom.com');
    expect(msg).toContain('search there first');
  });

  it('scopes a wikipedia fetch to the resolved article title', () => {
    const msg = buildRetrievalUserMessage(
      'Hamlet',
      { basis: 'wp:sections', fandomHost: null, wikipediaTitle: 'Hamlet' },
      'wikipedia',
    );
    expect(msg).toContain('"Hamlet"');
  });

  it('degrades to a bare domain line when no scoping hint is present', () => {
    const msg = buildRetrievalUserMessage('Tennis', undefined, 'wikipedia');
    expect(msg).toContain('Domain: Tennis');
    expect(msg).not.toContain('fandom.com');
  });
});

describe('buildUserPrompt — reference anchor block (A2 + B2)', () => {
  it('renders a provenance-labeled block with the A2 soft-preference line', () => {
    const prompt = buildUserPrompt(
      ['The Well-Tempered Clavier'],
      1,
      [],
      [],
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      new Map([
        ['The Well-Tempered Clavier', { source: 'wikipedia' as const, passage: 'Bach composed two books, each with 24 preludes and fugues.' }],
      ]),
    );
    expect(prompt).toContain('REFERENCE PASSAGES');
    expect(prompt).toContain('(source: wikipedia)');
    expect(prompt).toContain('prefer facts present in the passage');
    expect(prompt).toContain('UNVETTED');
    expect(prompt).toContain('Bach composed two books');
  });

  it('renders nothing when no domain in the round has a passage', () => {
    const prompt = buildUserPrompt(
      ['Tennis'],
      1,
      [],
      [],
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      new Map([['Some Other Domain', { source: 'fandom' as const, passage: 'irrelevant' }]]),
    );
    expect(prompt).not.toContain('REFERENCE PASSAGES');
  });
});
