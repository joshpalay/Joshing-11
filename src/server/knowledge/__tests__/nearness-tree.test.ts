import { beforeAll, describe, expect, it } from 'vitest';

// nearness-tree imports @/server/db, which throws at module load without a
// connection string. parseNearnessTree / shapeDomainRungs are pure; a dummy URL +
// dynamic import (repo convention) keeps the units pure without a DB.
let mod: typeof import('@/server/knowledge/nearness-tree');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/knowledge/nearness-tree');
});

describe('parseNearnessTree', () => {
  it('parses a well-formed four-rung object', () => {
    const raw = JSON.stringify({
      siblings: [{ label: 'Breath of the Wild', broadCategory: 'Video Games' }],
      cousins: [{ label: 'Metroid Dread', broadCategory: 'Video Games' }],
      parents: [{ label: 'The Legend of Zelda series', broadCategory: 'Video Games' }],
      grandparents: [{ label: 'Nintendo franchises', broadCategory: 'Video Games' }],
    });
    const t = mod.parseNearnessTree(raw);
    expect(t.sibling).toEqual([{ label: 'Breath of the Wild', broadCategory: 'Video Games' }]);
    expect(t.cousin[0].label).toBe('Metroid Dread');
    expect(t.parent[0].label).toBe('The Legend of Zelda series');
    expect(t.grandparent[0].label).toBe('Nintendo franchises');
  });

  it('tolerates markdown fences / surrounding prose (parseJsonObject extracts the object)', () => {
    const raw = 'Here you go:\n```json\n{ "siblings": [{ "label": "X", "broadCategory": "History" }] }\n```';
    const t = mod.parseNearnessTree(raw);
    expect(t.sibling).toEqual([{ label: 'X', broadCategory: 'History' }]);
    expect(t.parent).toEqual([]);
  });

  it('drops malformed items and missing rungs without throwing', () => {
    const raw = JSON.stringify({
      siblings: [{ label: '  ' }, { label: 'Valid' }, { nope: 1 }, 'string', null],
      parents: 'not-an-array',
    });
    const t = mod.parseNearnessTree(raw);
    expect(t.sibling).toEqual([{ label: 'Valid', broadCategory: null }]);
    expect(t.cousin).toEqual([]);
    expect(t.parent).toEqual([]);
  });

  it('returns all-empty rungs for non-JSON / non-object input', () => {
    expect(mod.parseNearnessTree('total garbage')).toEqual({ sibling: [], cousin: [], parent: [], grandparent: [] });
    expect(mod.parseNearnessTree('[1,2,3]')).toEqual({ sibling: [], cousin: [], parent: [], grandparent: [] });
  });
});

describe('shapeDomainRungs', () => {
  const tree = (over: Partial<Record<'sibling' | 'cousin' | 'parent' | 'grandparent', { label: string; broadCategory: string | null }[]>>) => ({
    sibling: [], cousin: [], parent: [], grandparent: [], ...over,
  });

  it('drops a suggestion equal to the child domain (folded key)', () => {
    const out = mod.shapeDomainRungs(
      'Tears of the Kingdom',
      tree({ sibling: [{ label: 'tears of the kingdom', broadCategory: 'Video Games' }, { label: 'Breath of the Wild', broadCategory: 'Video Games' }] }),
      'llm',
    );
    expect(out.map((r) => r.domain)).toEqual(['Breath of the Wild']);
  });

  it('dedupes across rungs keeping the NEAREST rung', () => {
    const out = mod.shapeDomainRungs(
      'A',
      tree({
        sibling: [{ label: 'Zelda', broadCategory: null }],
        parent: [{ label: 'Zelda', broadCategory: null }], // same, farther rung → dropped
      }),
      'llm',
    );
    expect(out).toEqual([{ domain: 'Zelda', broadCategory: null, rung: 'sibling', source: 'llm' }]);
  });

  it('caps each rung at four', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `S${i}`, broadCategory: null }));
    const out = mod.shapeDomainRungs('A', tree({ sibling: six }), 'llm');
    expect(out).toHaveLength(4);
    expect(out.every((r) => r.rung === 'sibling' && r.source === 'llm')).toBe(true);
  });

  it('stamps the given source', () => {
    const out = mod.shapeDomainRungs('A', tree({ parent: [{ label: 'P', broadCategory: 'Philosophy' }] }), 'curated');
    expect(out[0]).toEqual({ domain: 'P', broadCategory: 'Philosophy', rung: 'parent', source: 'curated' });
  });
});
