import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import { hash } from './cassian-fresh-dispatch-core';
import { assessArm, buildJobs, compactToV4, params, validateDesign, scoreCase, COMPACT_PROMPT, REFERENCE_PROMPT, SCOPE_RELATION_RULES, type Design } from './cassian-compact-review-core';
import { RECONSTRUCTION_PROMPT_V4, type CardV4 } from './cassian-evidence-v4';

const rawText = 'The Example Bridge was designed by Ada Stone in 1901. It opened in 1904.';
const source = readableSource({ id: 'src-1', url: 'https://example.org/bridge', title: 'Example Bridge', section: 'Lead', edition: null,
  captureSha: hash('capture'), extractionSha: hash(rawText), rawText, locator: 'fixture', removed: [] });
const card: CardV4 = { schemaVersion: 4, id: 'case-1', question: 'Who designed the Example Bridge?', answer: 'Ada Stone', explanation: 'Ada Stone designed it in 1901.',
  variants: ['Stone'], claims: [], scaffolding: [] };
const ok = (field: string, cardQuote: string) => ({ field, cardQuote, assertion: 'Ada Stone designed the bridge', status: 'supported',
  evidence: [{ sourceId: 'src-1', quote: 'designed by Ada Stone in 1901' }], why: '' });
const compact = (over: Record<string, unknown> = {}) => JSON.stringify({ id: 'case-1',
  coverage: ['question', 'answer', 'explanation', 'variant:0'].map(field => ({ field, complete: true })),
  claims: [ok('question', 'designed the Example Bridge'), ok('answer', 'Ada Stone'), ok('explanation', 'designed it in 1901'), ok('variant:0', 'Stone')],
  answers: ['answer', 'variant:0'].map(field => ({ field, entity: 'match', answerType: 'match', language: 'match', specificity: 'match', why: '' })), ...over });
const design = (): Design => ({ schemaVersion: 1, id: 'cassian-compact-claude-test', stage: 'eval', arms: ['reference', 'compact'], maxRunUsd: 1.5,
  labelsSha: hash('labels'), files: [{ path: 'scripts/x.ts', sha: hash('x') }], cases: [{ caseId: 'case-1', group: 'g1', card, sources: [source], inputTokens: 2000 }] });

describe('compact source-review format', () => {
  it('keeps every semantic sentence of the reference and changes only format instructions', () => {
    expect(REFERENCE_PROMPT.startsWith(RECONSTRUCTION_PROMPT_V4)).toBe(true);
    expect(COMPACT_PROMPT.endsWith(SCOPE_RELATION_RULES)).toBe(true);
    const semantic = RECONSTRUCTION_PROMPT_V4.split('\n')[0];
    expect(COMPACT_PROMPT.startsWith(semantic)).toBe(true);
    for (const rule of ['Entity mismatch needs a contradicted claim with supporting source quotation; absence is unknown.',
      'Explicit full-name, language or missing-word mismatches are mismatch, not absent policy.', 'Accept compatible unambiguous short forms only when the ask permits them.',
      'A fully matching answer requires supported relationship evidence in that field\'s claims.']) {
      expect(RECONSTRUCTION_PROMPT_V4).toContain(rule); expect(COMPACT_PROMPT).toContain(rule);
    }
  });
  it('sends identical model, thinking, body and output ceiling for both arms', () => {
    const [a, b] = buildJobs(design()).map(params);
    const strip = ({ system: _s, output_config: _o, ...rest }: typeof a) => rest;
    expect(strip(a)).toEqual(strip(b));
    expect(a.system).not.toEqual(b.system);
  });
  it('passes a sound compact review through the identical v4 verifier', () => {
    expect(assessArm('compact', compact(), 'end_turn', card, [source]).decision).toBe('pass');
  });
  it('rejects compact replies that hide reasons, omit answers or invent fields', () => {
    const unknown = compact({ claims: [ok('question', 'designed the Example Bridge'), ok('answer', 'Ada Stone'), { ...ok('explanation', 'in 1901'), status: 'unknown', evidence: [] }, ok('variant:0', 'Stone')] });
    expect(compactToV4(unknown)).toBeNull();
    expect(assessArm('compact', compact({ answers: [] }), 'end_turn', card, [source]).protocolValid).toBe(false);
    expect(compactToV4(compact({ claims: [{ ...ok('variant:1', 'Stone') }] }))).toBeNull();
    expect(assessArm('compact', '{not json', 'end_turn', card, [source]).protocolValid).toBe(false);
    expect(assessArm('compact', compact(), 'max_tokens', card, [source]).protocolValid).toBe(false);
  });
  it('keeps a missing-evidence finding visible as unresolved', () => {
    const raw = compact({ claims: [ok('question', 'designed the Example Bridge'), ok('answer', 'Ada Stone'), { ...ok('explanation', 'in 1901'), status: 'unknown', evidence: [], why: 'date not checked' }, ok('variant:0', 'Stone')] });
    const out = assessArm('compact', raw, 'end_turn', card, [source]);
    expect(out.decision).toBe('review'); expect(out.findings.map(f => f.category)).toContain('missing_evidence');
  });
  it('scores unsafe passes and false rejections against frozen labels', () => {
    const d = design(), c = d.cases[0];
    const r = (raw: string) => ({ designSha: hash('d'), key: 'compact-case-1', requestSha: hash('r'), raw, rawSha: hash(raw), model: 'claude-sonnet-5-5' as const, requestId: null,
      stopReason: 'end_turn', usd: 0.01, elapsedMs: 1, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 }, blocks: [{ type: 'text', chars: raw.length }], providerUsage: {} });
    const unsafe = scoreCase('compact', c, { caseId: 'case-1', expected: 'nonpass', defectFields: ['explanation'], allowedCategories: ['factual_error'], defect: 'x', rationale: 'x' }, r(compact()));
    expect(unsafe).toMatchObject({ unsafePass: true, falseRejection: false });
    const fine = scoreCase('compact', c, { caseId: 'case-1', expected: 'pass', defectFields: [], allowedCategories: [], defect: 'none', rationale: 'x' }, r(compact()));
    expect(fine).toMatchObject({ unsafePass: false, falseRejection: false, decision: 'pass' });
  });
  it('refuses a design whose worst case exceeds its run cap', () => {
    expect(() => validateDesign({ ...design(), maxRunUsd: 0.01 })).toThrow(/exceeds run cap/);
    expect(validateDesign(design()).cases).toHaveLength(1);
  });
});
