import { beforeAll, describe, expect, it } from 'vitest';

// source-reputation imports generate-questions → @/server/db, which throws at
// module load without a connection string. The functions under test are pure;
// dummy URL + dynamic import (repo convention) keeps the units pure.
let rep: typeof import('@/server/daily/source-reputation');

const lists = () => rep.getReputationLists();

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  rep = await import('@/server/daily/source-reputation');
});

describe('classifySource', () => {
  it('treats allow-listed references and their subdomains as reputable', () => {
    expect(rep.classifySource('https://en.wikipedia.org/wiki/x', lists())).toBe('reputable');
    expect(rep.classifySource('https://www.britannica.com/y', lists())).toBe('reputable');
  });

  it('treats .edu / .gov / .ac.* TLDs as reputable', () => {
    expect(rep.classifySource('https://plato.stanford.edu/entries/z', lists())).toBe('reputable');
    expect(rep.classifySource('https://www.nasa.gov/mission', lists())).toBe('reputable');
    expect(rep.classifySource('https://www.ox.ac.uk/page', lists())).toBe('reputable');
  });

  it('treats forums / Q&A / content farms as denied', () => {
    expect(rep.classifySource('https://www.reddit.com/r/x', lists())).toBe('denied');
    expect(rep.classifySource('https://www.quora.com/q', lists())).toBe('denied');
    expect(rep.classifySource('https://somegame.fandom.com/wiki/x', lists())).toBe('denied');
  });

  it('treats unknown sites as neutral', () => {
    expect(rep.classifySource('https://some-random-blog.example/post', lists())).toBe('neutral');
  });
});

describe('assessCorroboration', () => {
  const opts = () => ({ minTotal: 2, minReputable: 1, lists: lists() });

  it('passes with two distinct reputable hosts', () => {
    const a = rep.assessCorroboration(
      ['https://en.wikipedia.org/a', 'https://www.britannica.com/b'],
      opts(),
    );
    expect(a.corroborated).toBe(true);
    expect(a.distinctReputableHosts).toBe(2);
  });

  it('passes with one reputable + one neutral (default minReputable=1)', () => {
    const a = rep.assessCorroboration(
      ['https://www.britannica.com/b', 'https://unknown-ref.example/c'],
      opts(),
    );
    expect(a.corroborated).toBe(true);
  });

  it('fails with two neutral sources (no editorially-accountable anchor)', () => {
    const a = rep.assessCorroboration(
      ['https://blog-one.example/a', 'https://blog-two.example/b'],
      opts(),
    );
    expect(a.corroborated).toBe(false);
  });

  it('does not count mirrors of the same host (the corroboration trap)', () => {
    const a = rep.assessCorroboration(
      ['https://en.wikipedia.org/page1', 'https://en.wikipedia.org/page2'],
      opts(),
    );
    expect(a.distinctReputableHosts).toBe(1);
    expect(a.corroborated).toBe(false);
  });

  it('strips denied sources and they never count toward corroboration', () => {
    const a = rep.assessCorroboration(
      ['https://www.britannica.com/b', 'https://www.reddit.com/r/x'],
      opts(),
    );
    // Only one non-denied host remains → below minTotal.
    expect(a.corroborated).toBe(false);
    expect(a.deniedRefs).toContain('https://www.reddit.com/r/x');
    expect(a.orderedRefs).not.toContain('https://www.reddit.com/r/x');
  });

  it('orders surviving refs reputable-first', () => {
    const a = rep.assessCorroboration(
      ['https://unknown-ref.example/c', 'https://www.britannica.com/b'],
      opts(),
    );
    expect(a.orderedRefs[0]).toBe('https://www.britannica.com/b');
  });

  it('honors the strict reading when minReputable equals minTotal', () => {
    const strict = { minTotal: 2, minReputable: 2, lists: lists() };
    const oneReputable = rep.assessCorroboration(
      ['https://www.britannica.com/b', 'https://unknown-ref.example/c'],
      strict,
    );
    expect(oneReputable.corroborated).toBe(false);
  });

  it('thin-domain degrade: an uncorroborated batch yields nothing to persist', () => {
    // The checkpoint guarantee: when sources are junk-only, NOTHING qualifies, so
    // the batch persists no fresh question and the per-user path keeps serving
    // from the durable bank — never an uncorroborated fresh question.
    const junkBatch = [
      ['https://www.reddit.com/r/a'],
      ['https://www.quora.com/q', 'https://random.example/x'],
      [],
    ];
    const survivors = junkBatch.filter((refs) => rep.assessCorroboration(refs, opts()).corroborated);
    expect(survivors).toHaveLength(0);
  });
});
