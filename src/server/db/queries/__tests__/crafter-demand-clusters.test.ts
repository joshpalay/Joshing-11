import { describe, expect, it, vi } from 'vitest';

// buildLabelClusters is pure; mock the db module so importing the queries file
// doesn't evaluate a live connection.
vi.mock('@/server/db', () => ({
  db: {},
  generatedQuestions: {},
  masteryEvents: {},
  questions: {},
}));
vi.mock('@/server/db/queries/declared-interests', () => ({
  getActiveDeclaredInterests: vi.fn(),
}));
vi.mock('@/server/db/queries/retrieval-demand', () => ({
  getDurablePoolDepthForDomains: vi.fn(),
}));
// converge-domain transitively evaluates table columns via queries/knowledge —
// only the threshold knob is needed here.
vi.mock('@/server/knowledge/converge-domain', () => ({
  getConvergeTrgmThreshold: () => 0.55,
}));

import { buildLabelClusters, type ClusterLabel } from '@/server/db/queries/crafter-demand';

const THRESHOLD = 0.55;

const corpus: ClusterLabel[] = [
  { label: 'Renaissance & Medieval Polyphony', machineDepth: 0, humanAuthored: 1 },
  { label: 'Medieval & Renaissance Polyphony', machineDepth: 0, humanAuthored: 1 },
  { label: 'Renaissance Polyphony & Imitation', machineDepth: 0, humanAuthored: 1 },
  { label: 'Renaissance Florence', machineDepth: 9, humanAuthored: 8 },
  { label: 'Italian Renaissance Painting', machineDepth: 0, humanAuthored: 6 },
  { label: 'Hamlet', machineDepth: 12, humanAuthored: 2 },
];

describe('buildLabelClusters', () => {
  it('clusters lexical variants and excludes the domain itself', () => {
    const clusters = buildLabelClusters(['Renaissance & Medieval Polyphony'], corpus, THRESHOLD);
    const labels = clusters.get('Renaissance & Medieval Polyphony')!.map((c) => c.label);
    expect(labels).toContain('Medieval & Renaissance Polyphony');
    expect(labels).toContain('Renaissance Polyphony & Imitation');
    expect(labels).not.toContain('Renaissance & Medieval Polyphony');
  });

  it('does NOT cluster semantic-only siblings (near-ness tree territory)', () => {
    const clusters = buildLabelClusters(['Renaissance Florence'], corpus, THRESHOLD);
    expect(clusters.get('Renaissance Florence')).toEqual([]);
  });

  it('clusters domainKey-equal spellings even below trigram threshold', () => {
    const withVariant: ClusterLabel[] = [
      ...corpus,
      { label: 'HAMLET', machineDepth: 3, humanAuthored: 0 },
    ];
    const clusters = buildLabelClusters(['Hamlet'], withVariant, THRESHOLD);
    expect(clusters.get('Hamlet')!.map((c) => c.label)).toEqual(['HAMLET']);
  });

  it('never clusters generic bucket labels', () => {
    const withGeneric: ClusterLabel[] = [
      ...corpus,
      { label: 'General Knowledge', machineDepth: 40, humanAuthored: 0 },
    ];
    const clusters = buildLabelClusters(['General  Knowledge'], withGeneric, THRESHOLD);
    expect(clusters.get('General  Knowledge')).toEqual([]);
  });
});
