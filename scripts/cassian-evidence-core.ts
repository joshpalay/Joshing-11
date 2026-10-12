/** Offline frozen requests and writer evidence checks. No provider/database imports. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9-]+$/);
const text = z.string().min(1).refine(s => !!s.trim(), 'Text cannot be whitespace');
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const requestSchema = z.object({
  key: id, kind: z.enum(['writer', 'quality', 'factual']),
  model: z.enum(['claude-haiku-5-5', 'claude-sonnet-5-5']),
  system: text, body: text, maxTokens: z.number().int().min(100).max(3000),
  timeoutMs: z.literal(30000), maxRetries: z.literal(0),
  temperature: z.union([z.literal(0), z.literal(0.8)]),
  thinking: z.enum(['adaptive-low', 'native-lowest']), sha: fingerprint,
}).strict();
export type EvidenceRequest = z.infer<typeof requestSchema>;
export const evidenceManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^cassian-evidence-[a-z0-9-]+$/),
  maxRunUsd: z.number().positive().max(.75),
  files: z.array(z.object({ path: text, sha: fingerprint }).strict()).min(1).max(40),
  requests: z.array(requestSchema).min(1).max(16),
}).strict();
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const reviewId = z.string().regex(/^(case|card)-\d{2}$/);
const qualityInput = z.object({ id: reviewId, question: text, answer: text, variants: z.array(text), domain: text, tier: text }).strict();
const factualInput = z.object({ id: reviewId, question: text, answer: text, explanation: text,
  sources: z.array(z.object({ id, text }).strict()).min(1) }).strict();
function validateReviewerBody(r: EvidenceRequest): boolean {
  if (r.kind === 'writer') return true;
  try {
    const schema = r.kind === 'quality' ? qualityInput : factualInput;
    const parsed = z.object({ items: z.array(schema).min(1).max(6) }).strict().parse(JSON.parse(r.body));
    return new Set(parsed.items.map(i => i.id)).size === parsed.items.length;
  } catch { return false; }
}
export function requestSha(request: Omit<EvidenceRequest, 'sha'> | EvidenceRequest): string {
  const { sha: _sha, ...body } = request as EvidenceRequest;
  return sha256(JSON.stringify(body));
}
export function validateEvidenceManifest(raw: unknown): EvidenceManifest {
  const m = evidenceManifestSchema.parse(raw);
  if (new Set(m.requests.map(r => r.key)).size !== m.requests.length ||
    new Set(m.files.map(f => f.path)).size !== m.files.length ||
    m.files.some(f => !/^_scratch\/Cassian\//.test(f.path) && !/^(scripts|src)\//.test(f.path) ||
      f.path.includes('..') || f.path.includes('\\') || f.path.includes(':')) ||
    m.requests.some(r => r.sha !== requestSha(r) || r.system.length + r.body.length > 50000 || !validateReviewerBody(r) ||
      (r.kind === 'writer' ? r.model !== 'claude-haiku-5-5' || r.thinking !== 'adaptive-low' || r.temperature !== .8
        : r.model !== 'claude-sonnet-5-5' || r.thinking !== 'native-lowest' || r.temperature !== 0)))
    throw new Error('Frozen evidence requests or file identities are invalid.');
  return m;
}
export type EvidenceReply = {
  raw: string; rawSha: string; model: string; requestId: string | null; stopReason: string | null;
  usd: number; elapsedMs: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number };
};
export function validateEvidenceCheckpoint(m: EvidenceManifest, calls: Record<string, EvidenceReply>): void {
  if (!calls || typeof calls !== 'object' || Array.isArray(calls) || Object.entries(calls).some(([key,c]) => {
    const step = m.requests.find(r => r.key === key);
    return !step || !c || c.model !== step.model || typeof c.raw !== 'string' || c.rawSha !== sha256(c.raw) ||
      !Number.isFinite(c.usd) || c.usd < 0 || !Number.isFinite(c.elapsedMs) || c.elapsedMs < 0;
  })) throw new Error('Invalid evidence checkpoint; do not repeat completed calls.');
}
const field = z.enum(['question', 'answer', 'explanation', 'variants']);
const claim = z.object({ field, quote: text, assertion: text, factIds: z.array(id).min(1),
  evidence: z.array(z.object({ sourceId: id, quote: text }).strict()).min(1) }).strict();
const cardSchema = z.object({ status: z.literal('candidate'), question: text, answer: text,
  variants: z.array(text).max(8), explanation: text, factIds: z.array(id), claims: z.array(claim) }).strict();
const shortageSchema = z.object({ status: z.literal('insufficient_supported_facts'), reason: text }).strict();
export type EvidenceCard = z.infer<typeof cardSchema>;
export type WriterOutcome = { status: 'invalid'; issues: string[] } |
  { status: 'shortage'; reason: string; issues: string[] } | { status: 'candidate'; card: EvidenceCard; issues: string[] };
export type EvidenceContext = { facts: { id: string; evidence: { sourceId: string; quote: string }[] }[];
  sources: { id: string; text: string }[] };
export function assessWriter(raw: string, stopReason: string | null, mode: 'soft' | 'strict', context: EvidenceContext): WriterOutcome {
  if (stopReason !== 'end_turn') return { status: 'invalid', issues: ['nonfinal_writer_response'] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
  catch { return { status: 'invalid', issues: ['invalid_writer_json'] }; }
  const shortage = shortageSchema.safeParse(parsed);
  if (shortage.success) return { status: 'shortage', reason: shortage.data.reason, issues: [] };
  const result = cardSchema.safeParse(parsed);
  if (!result.success) return { status: 'invalid', issues: ['invalid_writer_schema'] };
  const c = result.data, issues: string[] = [];
  if (new Set(c.factIds).size !== c.factIds.length || c.factIds.some(f => !context.facts.some(x => x.id === f))) issues.push('invalid_fact_identity');
  if (mode === 'strict') {
    if (!c.factIds.length) issues.push('missing_fact_identity');
    const required = ['question', 'answer', 'explanation', ...(c.variants.length ? ['variants'] : [])];
    if (required.some(f => !c.claims.some(x => x.field === f))) issues.push('missing_field_claims');
    for (const a of c.claims) {
      const content = a.field === 'variants' ? c.variants : [c[a.field]];
      if (!content.some(t => t.includes(a.quote))) issues.push('claim_quote_not_in_card');
      if (a.factIds.some(f => !c.factIds.includes(f))) issues.push('claim_fact_not_selected');
      if (a.evidence.some(e => !context.sources.some(s => s.id === e.sourceId && s.text.includes(e.quote)))) issues.push('source_quote_not_in_packet');
    }
    // Union of claim substrings must cover letters/numbers of each field/variant.
    // This detects omitted text, but cannot prove a correct atomic claim inventory or entailment.
    for (const f of required) for (const content of f === 'variants' ? c.variants : [c[f as 'question'|'answer'|'explanation']]) {
      const covered = new Set<number>();
      for (const a of c.claims.filter(a => a.field === f)) {
        let start = content.indexOf(a.quote);
        while (start >= 0) { for (let n=start;n<start+a.quote.length;n++) covered.add(n); start=content.indexOf(a.quote,start+1); }
      }
      for (const match of content.matchAll(/[\p{L}\p{N}]/gu)) if (!covered.has(match.index!)) { issues.push('unmapped_card_text'); break; }
    }
  }
  return { status: 'candidate', card: c, issues: [...new Set(issues)] };
}
