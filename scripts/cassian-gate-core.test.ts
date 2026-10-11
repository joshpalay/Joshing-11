import { describe, expect, it } from 'vitest';
import { schedule, scoreGate, scoreCase, qualityOutputSchema, validateManifest, modelForStep, type GateCase, type GateManifest } from './cassian-gate-core';
import { qualityChallenger, qualityRecallChallenger, qualityComponentChallenger } from './cassian-gate-prompts';
const c: GateCase = { id: 'case-a', gate: 'quality', kind: 'development', body: 'q=Which player?',
  question: 'Which player?', expectedDecision: 'hold', expectedReason: { allowedCodes: ['FALSE_PREMISE'] } };
const manifest: GateManifest = { schemaVersion: 1, id: 'cassian-test', maxRunUsd: 0.75, repeats: 2,
  models: { quality: 'a', factual: 'b' }, prompts: { quality: { baseline: 'a', candidate: 'b' }, factual: { baseline: 'a', candidate: 'b' } }, cases: [c] };
describe('offline gate replay safeguards and scoring', () => {
  it('selects arm-specific models only with an identical quality prompt', () => {
    const comparison: GateManifest = { ...manifest, qualityModels: { baseline: 'a', candidate: 'c' },
      prompts: { ...manifest.prompts, quality: { baseline: 'same', candidate: 'same' } } };
    validateManifest(comparison);
    expect(schedule(comparison).map(s => modelForStep(comparison, s.case.gate, s.arm))).toEqual(['a', 'c', 'c', 'a']);
    expect(modelForStep(manifest, 'quality', 'candidate')).toBe('a');
    expect(modelForStep(manifest, 'factual', 'candidate')).toBe('b');
    expect(() => validateManifest({ ...comparison, prompts: manifest.prompts })).toThrow();
    expect(() => validateManifest({ ...comparison, cases: [{ ...c, gate: 'factual' }] })).toThrow();
    expect(() => validateManifest({ ...comparison, qualityModels: { baseline: 'a', candidate: 'a' } })).toThrow();
    expect(() => validateManifest({ ...comparison, qualityModels: { baseline: 'b', candidate: 'c' } })).toThrow();
  });
  it('alternates order without repeating call identities', () => {
    validateManifest(manifest); const rows = schedule(manifest);
    expect(rows.map(r => r.arm)).toEqual(['baseline', 'candidate', 'candidate', 'baseline']);
    expect(new Set(rows.map(r => r.key)).size).toBe(4);
  });
  it('rejects raised caps, duplicate identities and extra repeats', () => {
    expect(() => validateManifest({ ...manifest, maxRunUsd: 0.76 })).toThrow();
    expect(() => validateManifest({ ...manifest, repeats: 3 })).toThrow();
    expect(() => validateManifest({ ...manifest, qualityTimeoutMs: 120001 })).toThrow();
    expect(() => validateManifest({ ...manifest, qualityTimeoutMs: 29999 })).toThrow();
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
  it('retains tier/domain policies and refuses to silently lose them', () => {
    const policy = '5. GENERIC_AT_TIER — preserve tier\n6. MULTI_PART\n8. OFF_DOMAIN — preserve containment\n\n9. DEFINITION_SUPPLIED';
    for (const build of [qualityRecallChallenger, qualityComponentChallenger]) {
      const revised = build(policy);
      expect(revised).toContain('5. GENERIC_AT_TIER — preserve tier');
      expect(revised).toContain('8. OFF_DOMAIN — preserve containment');
      expect(() => build(policy.replace('8. OFF_DOMAIN', '8. RENAMED'))).toThrow('anchors changed');
      expect(() => build(policy.replace('5. GENERIC_AT_TIER', '5. RENAMED'))).toThrow('anchors changed');
    }
  });
  const batch: GateCase = { id: 'batch-a', gate: 'quality', kind: 'control',
    body: '[0] domain=Example tier=accessible fact=a\n    q=Which player?\n    a=One\n\n[1] domain=Example tier=accessible fact=b\n    q=Which year?\n    a=Two',
    items: [{ id: 'player', question: 'Which player?', expectedDecision: 'pass' },
      { id: 'year', question: 'Which year?', expectedDecision: 'hold', expectedReason: { allowedCodes: ['FALSE_PREMISE'] } }] };
  it('maps batch indices to the right item and never marks malformed batches as passes', () => {
    const raw = JSON.stringify({ drop_indices: [1], reasons: { '1': 'FALSE_PREMISE: wrong date.' } });
    const scores = scoreCase(raw, batch);
    expect(scores.map(s => [s.itemId, s.drop, s.decisionCorrect])).toEqual([['player', false, true], ['year', true, true]]);
    for (const bad of [
      { drop_indices: [2], reasons: { '2': 'wrong' } }, { drop_indices: [1, 1], reasons: { '1': 'wrong' } },
      { drop_indices: [1], reasons: {} }, { drop_indices: [], reasons: { '1': 'orphan' } },
      { drop_indices: [1], reasons: { '01': 'wrong key' } }, { drop_indices: [1], reasons: { '1': 5 } },
    ]) expect(scoreCase(JSON.stringify(bad), batch).every(s => !s.valid && !s.decisionCorrect)).toBe(true);
  });
  it('requires labels to match indexed batch text and rejects unsupported batch gates', () => {
    validateManifest({ ...manifest, cases: [batch] });
    expect(() => validateManifest({ ...manifest, cases: [{ ...batch, gate: 'factual' }] })).toThrow();
    expect(() => validateManifest({ ...manifest, cases: [{ ...batch, body: batch.body.replace('[1]', '[0]') }] })).toThrow();
    expect(() => validateManifest({ ...manifest, cases: [{ ...batch, body: batch.body.replace('Which year?', 'Other question?') }] })).toThrow();
  });
  it('isolates format comparisons from prompt/model changes and bounds JSON schemas', () => {
    const comparison: GateManifest = { ...manifest, models: { quality: 'claude-haiku-4-5-20251001', factual: 'b' },
      qualityFormats: { baseline: 'text', candidate: 'json' },
      qualitySchemas: { [batch.id]: qualityOutputSchema(2) },
      prompts: { ...manifest.prompts, quality: { baseline: 'same', candidate: 'same' } }, cases: [batch] };
    validateManifest(comparison);
    expect(() => validateManifest({ ...comparison, prompts: manifest.prompts })).toThrow();
    expect(() => validateManifest({ ...comparison, models: { quality: 'unmeasured', factual: 'b' } })).toThrow();
    expect(() => validateManifest({ ...comparison, qualityModels: { baseline: 'a', candidate: 'c' } })).toThrow();
    expect(() => validateManifest({ ...comparison, qualitySchemas: undefined })).toThrow();
    expect(() => validateManifest({ ...comparison, qualitySchemas: { [batch.id]: qualityOutputSchema(1) } })).toThrow();
    expect(qualityOutputSchema(2)).toMatchObject({ additionalProperties: false,
      properties: { drop_indices: { items: { enum: [0, 1] } }, reasons: { additionalProperties: false, properties: { '0': {}, '1': {} } } } });
    expect(() => qualityOutputSchema(7)).toThrow();
    expect(() => qualityOutputSchema(0)).toThrow();
  });
});
