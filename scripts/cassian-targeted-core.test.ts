import { describe, expect, it } from 'vitest';
import { assertReviewBudgetClear, codeFindings, factualDecision, planTargetedReview, qualityDecision,
  scoreTargetedReview, targetedRequestHashes, validateTargetedManifest, type ReviewReply, type TargetedItem, type TargetedManifest } from './cassian-targeted-core';
import { targetedQualityPrompt } from './cassian-targeted-prompts';

const item = (id: string, overrides: Partial<TargetedItem> = {}): TargetedItem => ({
  id, question: `The Rowan gauge (${id}) bears its inventor's surname. What was the inventor's given name?`,
  answer: 'Alex', variants: ['Alex'], explanation: 'EXPLANATION_ONLY_SENTINEL: Alex Rowan invented the gauge.',
  domain: 'Invented test instruments', tier: 'accessible', factKey: id, novelty: 'eligible',
  sources: [{ id: 'source-a', text: 'Alex Rowan invented the gauge. Its handle is red.' }],
  screen: { quality: { decision: 'hold', reason: 'FIRST_REVIEW_SENTINEL: name absent but hold.' }, factual: { decision: 'pass' } },
  writer: 'haiku', expectedUsable: true, ownerGood: true, policySensitive: false,
  historical: { writerUsd: 0.001, qualityUsd: 0.005, factualUsd: 0.01, writerMs: 500, qualityMs: 1000, factualMs: 2000 }, ...overrides,
});
const manifest = (items: TargetedItem[], fraction = 0): TargetedManifest => { const m: TargetedManifest = { schemaVersion: 1,
  id: 'cassian-targeted-test', maxRunUsd: 0.75, seed: 'fixed-seed', passAuditFraction: fraction,
  models: { quality: 'claude-sonnet-5-5', factual: 'claude-sonnet-5-5' }, prompts: { quality: 'quality', factual: 'factual' },
  requestSettings: { maxTokens: 3000, timeoutMs: 30000, maxRetries: 0 }, requestHashes: [],
  batches: [{ id: 'batch-a', items }] }; m.requestHashes = targetedRequestHashes(m); return m; };
const quality = (i: TargetedItem) => ({ id: i.id, requestedFact: 'inventor given name', uncertain: false,
  disclosure: null, requestGroups: [{ quote: "What was the inventor's given name?", attribute: 'given name' }], otherDefects: [] });
const field = () => ({ status: 'supported' as const, evidence: [{ sourceId: 'source-a', quote: 'Alex Rowan invented the gauge.' }], explanation: 'Source supports the claim.' });
const factual = (i: TargetedItem) => ({ id: i.id, question: field(), answer: field(), explanation: field() });
const reply = (items: unknown[]): ReviewReply => ({ raw: JSON.stringify({ items }), usd: 0.02, elapsedMs: 1500, model: 'claude-sonnet-5-5', stopReason: 'end_turn' });

describe('offline targeted pipeline', () => {
  it('rescues a quality false hold only when separate source verification also passes', () => {
    const i = item('clean'); const m = manifest([i]);
    const completed = scoreTargetedReview(m, { 'quality:batch-a': reply([quality(i)]), 'factual:batch-a': reply([factual(i)]) });
    expect(completed.rows[0]).toMatchObject({ baseline: 'hold', candidate: 'pass' });
    const partial = scoreTargetedReview(m, { 'quality:batch-a': reply([quality(i)]) });
    expect(partial.rows[0].candidate).toBe('review');
    expect(partial.groups.find(g => g.pipeline === 'candidate')?.usdPerVerifiedUsable).toBeNull();
  });
  it('keeps source contradictions and unsupported explanations separate from quality approval', () => {
    const i = item('false-premise'); const m = manifest([i]);
    const assessed = { ...factual(i), question: { status: 'contradicted' as const, evidence: [{ sourceId: 'source-a', quote: 'Its handle is red.' }], explanation: 'Question calls it green.' } };
    expect(scoreTargetedReview(m, { 'quality:batch-a': reply([quality(i)]), 'factual:batch-a': reply([assessed]) }).rows[0].candidate).toBe('hold');
    const unknown = { ...factual(i), explanation: { status: 'unknown' as const, evidence: [], explanation: 'The excerpt omits this claim.' } };
    expect(scoreTargetedReview(m, { 'quality:batch-a': reply([quality(i)]), 'factual:batch-a': reply([unknown]) }).rows[0].candidate).toBe('review');
  });
  it('requires actual stem evidence and a printed reference answer for literal disclosure', () => {
    const i = item('clean');
    const a = { ...quality(i), disclosure: { kind: 'literal' as const, quote: 'Rowan gauge', explanation: 'This prints Alex.' } };
    expect(qualityDecision(i, a)).toMatchObject({ decision: 'review', issues: ['literal_evidence_does_not_print_answer'] });
    expect(qualityDecision(i, { ...a, disclosure: { ...a.disclosure, quote: 'Alex Rowan' } }).issues).toContain('evidence_not_in_question');
    const printed = item('leak', { question: 'Alex Rowan invented the gauge. What was the inventor\'s given name?' });
    expect(qualityDecision(printed, { ...quality(printed), disclosure: { kind: 'literal', quote: 'Alex Rowan', explanation: 'The given name is printed.' } }).decision).toBe('hold');
  });
  it('does not treat partial words or same-kind answer items as literal or multipart proof', () => {
    const i = item('same-kind', { question: 'Name two gauge makers: Alexson and Rowan.', answer: 'Alex' });
    const a = { ...quality(i), requestGroups: [{ quote: 'Name two gauge makers', attribute: 'names' }],
      disclosure: { kind: 'literal' as const, quote: 'Alexson', explanation: 'Name match.' } };
    expect(qualityDecision(i, a).decision).toBe('review');
    const multi = { ...a, disclosure: null, requestGroups: [{ quote: 'Alexson', attribute: 'names' }, { quote: 'Rowan', attribute: 'names' }],
      otherDefects: [{ code: 'MULTI_PART' as const, quote: 'Name two gauge makers', explanation: 'Two names.' }] };
    expect(qualityDecision(i, multi).issues).toContain('multipart_groups_not_distinct');
  });
  it('routes every hold/invalid screen, samples passes reproducibly and excludes known duplicates', () => {
    const held = item('held'); const invalid = item('invalid', { screen: { quality: { decision: 'invalid' }, factual: { decision: 'pass' } } });
    const pass = item('pass', { screen: { quality: { decision: 'pass' }, factual: { decision: 'pass' } } });
    const excluded = item('excluded', { novelty: 'excluded' }); const duplicate = item('duplicate', { factKey: 'held' });
    const items = [held, invalid, pass, excluded, duplicate];
    const plan = planTargetedReview(manifest(items, 0.25));
    expect(plan[0].ids).toEqual(['held', 'invalid', 'pass']);
    expect(plan[1].ids).toEqual(['held', 'invalid', 'pass']);
    expect(planTargetedReview(manifest([held, invalid, pass], 0.25))).toEqual(plan);
    expect(codeFindings(items).get('duplicate')).toContain('duplicate');
    expect(planTargetedReview(manifest([pass], 0))[0].kind).toBe('factual');
  });
  it('keeps pass sampling stable under reordering and does not send labels or prior reasons', () => {
    const items = Array.from({ length: 6 }, (_, n) => item(`pass-${n}`, { screen: { quality: { decision: 'pass' }, factual: { decision: 'pass' } } }));
    const ids = planTargetedReview(manifest(items, 0.25))[0].ids;
    expect(planTargetedReview(manifest([...items].reverse(), 0.25))[0].ids.sort()).toEqual([...ids].sort());
    const body = planTargetedReview(manifest([item('held')]))[0].body;
    for (const forbidden of ['FIRST_REVIEW_SENTINEL', 'EXPLANATION_ONLY_SENTINEL', 'expectedUsable', 'ownerGood', 'writer', 'screen', 'sources', 'factKey'])
      expect(body).not.toContain(forbidden);
  });
  it('never passes malformed, omitted, duplicate, invented-ID or truncated reviews', () => {
    const items = [item('one'), item('two')]; const m = manifest(items);
    for (const raw of ['not JSON', JSON.stringify({ items: [quality(items[0])] }),
      JSON.stringify({ items: [quality(items[0]), quality(items[0])] }),
      JSON.stringify({ items: [quality(items[0]), { ...quality(items[1]), id: 'other' }] })]) {
      const result = scoreTargetedReview(m, { 'quality:batch-a': { ...reply([]), raw }, 'factual:batch-a': reply(items.map(factual)) });
      expect(result.rows.every(r => r.candidate === 'review')).toBe(true);
    }
    for (const stopReason of ['max_tokens', 'refusal', 'pause_turn']) {
      const stopped = scoreTargetedReview(m, { 'quality:batch-a': { ...reply(items.map(quality)), stopReason }, 'factual:batch-a': reply(items.map(factual)) });
      expect(stopped.rows.every(r => r.candidate === 'review')).toBe(true);
    }
  });
  it('does not accept invented source quotes, cross-item sources or unsupported positive claims', () => {
    const i = item('one'); const a = factual(i);
    expect(factualDecision(i, { ...a, answer: { ...field(), evidence: [] } }).decision).toBe('review');
    expect(factualDecision(i, { ...a, answer: { ...field(), evidence: [{ sourceId: 'other-item-source', quote: 'Alex' }] } }).decision).toBe('review');
    expect(factualDecision(i, { ...a, answer: { ...field(), evidence: [{ sourceId: 'source-a', quote: 'invented statement' }] } }).decision).toBe('review');
    expect(factualDecision(i, a).decision).toBe('pass');
  });
  it('retains unresolved novelty and uncertain quality even when other checks approve', () => {
    const i = item('unknown', { novelty: 'unknown' });
    expect(scoreTargetedReview(manifest([i]), { 'quality:batch-a': reply([quality(i)]), 'factual:batch-a': reply([factual(i)]) }).rows[0].candidate).toBe('review');
    const known = item('known');
    expect(scoreTargetedReview(manifest([known]), { 'quality:batch-a': reply([{ ...quality(known), uncertain: true }]), 'factual:batch-a': reply([factual(known)]) }).rows[0].candidate).toBe('review');
  });
  it('rejects empty evidence rather than treating whitespace as source support', () => {
    const i = item('one'); const a = { ...factual(i), answer: { ...field(), evidence: [{ sourceId: 'source-a', quote: ' ' }] } };
    expect(scoreTargetedReview(manifest([i]), { 'quality:batch-a': reply([quality(i)]), 'factual:batch-a': reply([a]) }).rows[0].candidate).toBe('review');
  });
  it('preserves all writer costs, splits mixed review costs and leaves incomplete economics unknown', () => {
    const h = item('haiku'); const s = item('sonnet', { writer: 'sonnet' }); const excluded = item('excluded', { writer: 'sonnet', novelty: 'excluded', expectedUsable: false, ownerGood: null });
    const m = manifest([h, s, excluded]);
    const scored = scoreTargetedReview(m, { 'quality:batch-a': reply([quality(h), quality(s)]), 'factual:batch-a': reply([factual(h), factual(s)]) });
    expect(scored.groups.find(g => g.pipeline === 'candidate' && g.writer === 'haiku')?.attributedUsd).toBeCloseTo(0.026);
    expect(scored.groups.find(g => g.pipeline === 'candidate' && g.writer === 'sonnet')?.attributedUsd).toBeCloseTo(0.032);
    expect(scored.rows[0].modeledCandidateMs).toBe(3000);
    expect(scoreTargetedReview(m, {}).groups.filter(g => g.pipeline === 'candidate').every(g => g.attributedUsd === null)).toBe(true);
    expect(() => scoreTargetedReview(m, { unknown: reply([]) })).toThrow('unknown call');
  });
  it('bounds frozen identities, model configuration, run cost and request size', () => {
    const m = manifest([item('one')]); validateTargetedManifest(m);
    expect(() => validateTargetedManifest({ ...m, maxRunUsd: 0.76 })).toThrow();
    expect(() => validateTargetedManifest({ ...m, models: { ...m.models, quality: 'unmeasured' } })).toThrow();
    expect(() => validateTargetedManifest(manifest([item('one'), item('one')]))).toThrow('identity');
    const tooLarge = { ...m, prompts: { ...m.prompts, factual: 'x'.repeat(50001) } };
    tooLarge.requestHashes = targetedRequestHashes(tooLarge);
    expect(() => validateTargetedManifest(tooLarge)).toThrow('input-size');
    expect(() => validateTargetedManifest({ ...m, prompts: { ...m.prompts, factual: 'changed' } })).toThrow('requests changed');
  });
  it('retains tier/domain policies and refuses missing anchors', () => {
    const policy = '5. GENERIC_AT_TIER — retained\n6. MULTI_PART\n8. OFF_DOMAIN — retained\n\n9. DEFINITION_SUPPLIED';
    expect(targetedQualityPrompt(policy)).toContain('5. GENERIC_AT_TIER — retained');
    expect(targetedQualityPrompt(policy)).toContain('8. OFF_DOMAIN — retained');
    expect(() => targetedQualityPrompt('changed policy')).toThrow('anchors');
  });
  it('blocks paid dispatch on uncertainty or malformed accounting without needing a client', () => {
    assertReviewBudgetClear(0);
    for (const value of [0.02, -0.01, NaN, Infinity]) expect(() => assertReviewBudgetClear(value)).toThrow('stop before dispatch');
  });
});
