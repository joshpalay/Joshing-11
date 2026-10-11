export type Gate = 'quality' | 'factual';
export type GateCase = {
  id: string; gate: Gate; kind: 'development' | 'control'; body: string; question: string;
  expectedDecision: 'pass' | 'hold';
  expectedReason?: { allowedCodes?: string[]; allTerms?: string[]; anyTerms?: string[] };
};
export type GateManifest = {
  schemaVersion: 1; id: string; maxRunUsd: number; repeats: number;
  models: Record<Gate, string>;
  /** Offline model comparison: identical quality prompts, quality cases only. */
  qualityModels?: Record<'baseline' | 'candidate', string>;
  prompts: Record<Gate, Record<'baseline' | 'candidate', string>>;
  cases: GateCase[];
};
export function validateManifest(m: GateManifest): void {
  if (m.schemaVersion !== 1 || !/^cassian-[a-z0-9-]+$/.test(m.id) ||
    !Number.isFinite(m.maxRunUsd) || m.maxRunUsd <= 0 || m.maxRunUsd > 0.75 ||
    !Number.isInteger(m.repeats) || m.repeats < 1 || m.repeats > 2 ||
    !Array.isArray(m.cases) || !m.cases.length || m.cases.length > 16 ||
    new Set(m.cases.map(c => c.id)).size !== m.cases.length ||
    m.cases.some(c => !/^[a-z0-9-]+$/.test(c.id) || !['quality', 'factual'].includes(c.gate) ||
      !['development', 'control'].includes(c.kind) || !['pass', 'hold'].includes(c.expectedDecision) ||
      !c.body?.trim() || !c.question?.trim()) ||
    (['quality', 'factual'] as const).some(g => !m.models[g] ||
      !m.prompts[g]?.baseline || !m.prompts[g]?.candidate ||
      (!(m.qualityModels && g === 'quality') && m.prompts[g].baseline === m.prompts[g].candidate)) ||
    (m.qualityModels !== undefined && (!m.qualityModels.baseline?.trim() || !m.qualityModels.candidate?.trim() ||
      m.qualityModels.baseline === m.qualityModels.candidate || m.models.quality !== m.qualityModels.baseline ||
      m.prompts.quality.baseline !== m.prompts.quality.candidate || m.cases.some(c => c.gate !== 'quality')))) {
    throw new Error('Invalid frozen gate replay manifest.');
  }
}
export function modelForStep(m: GateManifest, gate: Gate, arm: 'baseline' | 'candidate'): string {
  return gate === 'quality' && m.qualityModels ? m.qualityModels[arm] : m.models[gate];
}
export function schedule(m: GateManifest): { key: string; case: GateCase; arm: 'baseline' | 'candidate'; repeat: number }[] {
  return m.cases.flatMap((c, i) => Array.from({ length: m.repeats }, (_, r) =>
    ((i + r) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
      .map(a => ({ key: `${c.gate}:${c.id}:${a}:${r + 1}`, case: c,
        arm: a as 'baseline' | 'candidate', repeat: r + 1 }))).flat());
}
export function scoreGate(raw: string, c: GateCase, parse?: (raw: string) => Record<string, unknown> | null): {
  valid: boolean; drop: boolean | null; reason: string | null;
  decisionCorrect: boolean; reasonCorrect: boolean | null; leakEvidenceInStem: boolean | null;
} {
  let parsed: { drop_indices?: unknown; reasons?: unknown };
  try {
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = parse ? (parse(raw) ?? {}) : JSON.parse(stripped);
  } catch { return { valid: false, drop: null, reason: null, decisionCorrect: false, reasonCorrect: null, leakEvidenceInStem: null }; }
  if (!parsed || !Array.isArray(parsed.drop_indices) || parsed.drop_indices.some(i => i !== 0) ||
    !parsed.reasons || typeof parsed.reasons !== 'object' || Array.isArray(parsed.reasons)) {
    return { valid: false, drop: null, reason: null, decisionCorrect: false, reasonCorrect: null, leakEvidenceInStem: null };
  }
  const drop = parsed.drop_indices.includes(0);
  const reason = (parsed.reasons as Record<string, unknown>)['0'];
  if (drop && (typeof reason !== 'string' || !reason.trim())) {
    return { valid: false, drop: null, reason: null, decisionCorrect: false, reasonCorrect: null, leakEvidenceInStem: null };
  }
  const text = typeof reason === 'string' ? reason : '';
  const code = text.split(':')[0];
  const isLeak = c.gate === 'quality' && ['SELF_ANSWERING', 'ANSWER_LEAKED'].includes(code);
  const quotes = [...text.matchAll(/["“]([^"”]+)["”]|[‘']([^’']+)[’']/g)].map(m => m[1] ?? m[2]);
  const evidence = isLeak ? quotes.some(q => q.length > 1 && c.question.includes(q)) : null;
  const expectedHold = c.expectedDecision === 'hold';
  const expectation = c.expectedReason;
  const reasonCorrect = !drop ? (expectedHold ? false : true) : (!expectation ? null :
    (!expectation.allowedCodes || expectation.allowedCodes.includes(code)) &&
    (!expectation.allTerms || expectation.allTerms.every(t => text.toLowerCase().includes(t.toLowerCase()))) &&
    (!expectation.anyTerms || expectation.anyTerms.some(t => text.toLowerCase().includes(t.toLowerCase()))) && evidence !== false);
  return { valid: true, drop, reason: text || null, decisionCorrect: drop === expectedHold,
    reasonCorrect: !expectedHold && drop ? false : reasonCorrect, leakEvidenceInStem: evidence };
}
