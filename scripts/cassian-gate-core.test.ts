import { describe, expect, it } from 'vitest';
import { schedule, scoreGate, validateManifest, type GateCase, type GateManifest } from './cassian-gate-core';
import { qualityChallenger } from './cassian-gate-prompts';
const c: GateCase = { id: 'case-a', gate: 'quality', kind: 'development', body: 'q=Which player?',
  question: 'Which player?', expectedDecision: 'hold', expectedReason: { allowedCodes: ['FALSE_PREMISE'] } };
const manifest: GateManifest = { schemaVersion: 1, id: 'cassian-test', maxRunUsd: 0.75, repeats: 2,
  models: { quality: 'a', factual: 'b' }, prompts: { quality: { baseline: 'a', candidate: 'b' }, factual: { baseline: 'a', candidate: 'b' } }, cases: [c] };
describe('offline gate replay safeguards and scoring', () => {
  it('alternates order without repeating call identities', () => {
    validateManifest(manifest); const rows = schedule(manifest);
    expect(rows.map(r => r.arm)).toEqual(['baseline', 'candidate', 'candidate', 'baseline']);
    expect(new Set(rows.map(r => r.key)).size).toBe(4);
  });
  it('rejects raised caps, duplicate identities and extra repeats', () => {
    expect(() => validateManifest({ ...manifest, maxRunUsd: 0.76 })).toThrow();
    expect(() => validateManifest({ ...manifest, repeats: 3 })).toThrow();
    expect(() => validateManifest({ ...manifest, cases: [c, c] })).toThrow();
  });
  it('scores a right hold with an invented leak as a wrong reason', () => {
    const result = scoreGate(JSON.stringify({ drop_indices: [0], reasons: { '0': 'SELF_ANSWERING: names "Hidden Answer".' } }), c);
    expect(result.decisionCorrect).toBe(true); expect(result.reasonCorrect).toBe(false);
    expect(result.leakEvidenceInStem).toBe(false);
  });
  it('accepts genuine single-quoted evidence but keeps false holds separate', () => {
    const leak = { ...c, question: 'Who wrote Named Answer?', expectedReason: { allowedCodes: ['SELF_ANSWERING'] } };
    expect(scoreGate(JSON.stringify({ drop_indices: [0], reasons: { '0': "SELF_ANSWERING: contains 'Named Answer'." } }), leak).reasonCorrect).toBe(true);
    expect(scoreGate(JSON.stringify({ drop_indices: [0], reasons: { '0': "SELF_ANSWERING: contains 'Named Answer'." } }), { ...leak, expectedDecision: 'pass' }).decisionCorrect).toBe(false);
  });
  it('does not score malformed or out-of-range output as a pass', () => {
    expect(scoreGate('not json', { ...c, expectedDecision: 'pass' }).valid).toBe(false);
    expect(scoreGate('{"drop_indices":[1],"reasons":{}}', c).valid).toBe(false);
    expect(scoreGate('{"drop_indices":[0],"reasons":{}}', c).valid).toBe(false);
  });
  it('uses the production JSON extractor when provided', () => {
    const result = scoreGate('preamble then JSON', { ...c, expectedDecision: 'pass' }, () => ({ drop_indices: [], reasons: {} }));
    expect(result.valid).toBe(true); expect(result.decisionCorrect).toBe(true);
  });
  it('refuses a challenger when the original rubric anchor changed', () => {
    expect(() => qualityChallenger('different rubric')).toThrow('anchor changed');
  });
});
