import { beforeAll, describe, expect, it } from 'vitest';

let mod: typeof import('@/server/knowledge/propose-structure');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/knowledge/propose-structure');
});

const CORPUS = new Map([
  ['medici family', { label: 'Medici Family', machineDepth: 9, humanAuthored: 0 }],
  ['renaissance florence', { label: 'Renaissance Florence', machineDepth: 12, humanAuthored: 1 }],
  ['florentine art', { label: 'Florentine Art', machineDepth: 4, humanAuthored: 0 }],
  ['tennis', { label: 'Tennis', machineDepth: 22, humanAuthored: 11 }],
]);

describe('parseProposedStructure — grounding guardrails', () => {
  it('keeps groups whose children are real corpus labels (fold-matched)', () => {
    const raw = JSON.stringify({
      groups: [
        {
          parent: 'Renaissance Italy',
          broad_category: 'History',
          suggested_threshold: 1200,
          // en-dash variant still folds onto the real label
          children: ['Medici Family', 'Renaissance – Florence', 'Florentine Art'],
        },
      ],
    });
    const groups = mod.parseProposedStructure(raw, CORPUS);
    expect(groups).toHaveLength(1);
    expect(groups[0].parentLabel).toBe('Renaissance Italy');
    expect(groups[0].children.map((c) => c.label)).toEqual([
      'Medici Family',
      'Renaissance Florence', // the REAL corpus label, not the LLM's variant
      'Florentine Art',
    ]);
    expect(groups[0].suggestedThreshold).toBe(1200);
  });

  it('drops invented children — and the group if fewer than 2 survive', () => {
    const raw = JSON.stringify({
      groups: [
        {
          parent: 'Italian History',
          suggested_threshold: 900,
          children: ['Medici Family', 'The Borgias', 'Papal States'], // 2 invented
        },
      ],
    });
    const groups = mod.parseProposedStructure(raw, CORPUS);
    expect(groups).toHaveLength(0); // only 1 real child survived → discarded
  });

  it('a bad threshold falls back to children × 300', () => {
    const raw = JSON.stringify({
      groups: [
        {
          parent: 'Renaissance Italy',
          suggested_threshold: -5,
          children: ['Medici Family', 'Florentine Art'],
        },
      ],
    });
    const groups = mod.parseProposedStructure(raw, CORPUS);
    expect(groups[0].suggestedThreshold).toBe(600);
  });

  it('rejects self-parenting, duplicate children, duplicate parents, and non-JSON', () => {
    const raw = JSON.stringify({
      groups: [
        {
          parent: 'Medici Family', // also a child below — self filtered out
          suggested_threshold: 800,
          children: ['Medici Family', 'Florentine Art', 'Florentine Art', 'Renaissance Florence'],
        },
        {
          parent: 'Medici – Family', // duplicate parent by fold
          suggested_threshold: 800,
          children: ['Tennis', 'Florentine Art'],
        },
      ],
    });
    const groups = mod.parseProposedStructure(raw, CORPUS);
    expect(groups).toHaveLength(1);
    expect(groups[0].children.map((c) => c.label)).toEqual(['Florentine Art', 'Renaissance Florence']);
    expect(mod.parseProposedStructure('not json', CORPUS)).toEqual([]);
  });
});
