/** Offline preparation only; no provider, database or serving imports. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readableSource, validateSourceV3, reconstructionInput, type SourceV3, type CardV3 } from './cassian-evidence-v3';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict();
export type Excerpt = { source: SourceV3; parentId: string; parentReadableSha: string; range: z.infer<typeof span> };
/** Each contiguous passage stays a separate source; never join distant prose into a fake quotation. */
export function excerptSource(parent: SourceV3, range: z.infer<typeof span>, id: string): Excerpt {
  validateSourceV3(parent); span.parse(range);
  if (range.end <= range.start || range.end > parent.readableText.length) throw Error('Invalid excerpt range');
  const rawText = parent.readableText.slice(range.start, range.end);
  return { parentId: parent.id, parentReadableSha: parent.readableSha, range,
    source: readableSource({ id, url: parent.url, title: parent.title, section: parent.section, edition: parent.edition,
      captureSha: parent.captureSha, extractionSha: sha(rawText), rawText, removed: [],
      locator: `${parent.locator}; parentReadableSha=${parent.readableSha}; UTF16=${range.start}:${range.end}` }) };
}
export function validateExcerpt(excerpt: Excerpt, parent: SourceV3): void {
  const expected = excerptSource(parent, excerpt.range, excerpt.source.id);
  if (JSON.stringify(excerpt) !== JSON.stringify(expected)) throw Error('Excerpt provenance drift');
}
export type PreparedFact = { id: string; assertion: string; evidence: { sourceId: string; start: number; end: number; quote: string }[];
  support: 'reviewed' | 'pending'; novelty: 'clear' | 'bank_duplicate' | 'player_repeat' | 'pending'; rationale: string };
export type PreparedPacket = { requestId: string; domain: string; tier: string; scope: 'accepted' | 'unresolved';
  sources: SourceV3[]; facts: PreparedFact[]; preparer: { role: 'prompt-author'; independent: false } };

/** Validates record mechanics, not entailment, semantic novelty, difficulty or source truth. */
export function packetWriterInput(packet: PreparedPacket): string {
  packet.sources.forEach(validateSourceV3);
  if (new Set(packet.sources.map(s => s.id)).size !== packet.sources.length ||
    new Set(packet.facts.map(f => f.id)).size !== packet.facts.length) throw Error('Duplicate packet identity');
  for (const f of packet.facts) {
    if (!f.id.trim() || !f.assertion.trim() || !f.rationale.trim() || !f.evidence.length ||
      !['reviewed','pending'].includes(f.support) || !['clear','bank_duplicate','player_repeat','pending'].includes(f.novelty)) throw Error('Incomplete fact record');
    for (const e of f.evidence) {
      const source = packet.sources.find(s => s.id === e.sourceId);
      if (!source || !Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end <= e.start ||
        source.readableText.slice(e.start, e.end) !== e.quote || e.end > source.readableText.length) throw Error('Invalid fact quotation');
    }
  }
  const eligible = packet.scope === 'accepted' ? packet.facts.filter(f => f.support === 'reviewed' && f.novelty === 'clear') : [];
  return JSON.stringify({ requestId: packet.requestId, domain: packet.domain, tier: packet.tier,
    scopeResolved: packet.scope === 'accepted', eligibleFacts: eligible.map(({ id, assertion, evidence }) => ({ id, assertion, evidence })),
    excludedFacts: packet.facts.filter(f => !eligible.includes(f)).map(f => ({ assertion: f.assertion })),
    sources: packet.sources.map(({ id, url, title, section, edition, locator, readableText, readableSha }) =>
      ({ id, url, title, section, edition, locator, text: readableText, sha: readableSha })) });
}

export type ControlGold = { id: string; card: CardV3; sources: SourceV3[]; cohort: 'sound' | 'challenge' | 'regression';
  domain: string; tier: string; expectedSource: 'pass' | 'hold' | 'review'; expectedQuality: 'pass' | 'hold'; categories: string[];
  allowedCategories?: string[]; rationale: string };
/** Opaque shuffled IDs and allowlisted payloads keep gold, cohorts, arm and writer inventories private. */
export function blindControls(controls: ControlGold[], seed: string) {
  if (!seed.trim() || new Set(controls.map(c => c.id)).size !== controls.length) throw Error('Invalid blind frame');
  const ordered = controls.map(c => ({ c, rank: sha(`${seed}:${c.id}`) })).sort((a, b) => a.rank.localeCompare(b.rank));
  return ordered.map(({ c }, n) => {
    const id = `case-${String(n + 1).padStart(2, '0')}`, card = { ...c.card, id };
    return { privateId: c.id, blindId: id, factual: reconstructionInput(card, c.sources),
      quality: JSON.stringify({ id, question: card.question, answer: card.answer, variants: card.variants, domain: c.domain, tier: c.tier }) };
  });
}

/** Sound retention and unsafe passes use the whole frozen cohort, including missing/invalid replies. */
export function scoreControls(gold: ControlGold[], observed: { id: string; source: 'pass' | 'hold' | 'review' | 'invalid';
  quality: 'pass' | 'hold' | 'invalid'; categories: string[] }[]) {
  if (new Set(gold.map(c => c.id)).size !== gold.length || new Set(observed.map(c => c.id)).size !== observed.length ||
    observed.some(o => !gold.some(c => c.id === o.id))) throw Error('Control result identity mismatch');
  const sound = gold.filter(c => c.cohort === 'sound'), challenges = gold.filter(c => c.cohort === 'challenge');
  const rows = gold.map(c => {
    const o = observed.find(o => o.id === c.id);
    return { id: c.id, cohort: c.cohort, expectedSource: c.expectedSource, expectedQuality: c.expectedQuality,
      source: o?.source ?? 'invalid', quality: o?.quality ?? 'invalid',
      correctSource: o?.source === c.expectedSource, correctQuality: o?.quality === c.expectedQuality,
      correctCategory: !!o && c.categories.every(category => o.categories.includes(category)) &&
        o.categories.every(category => (c.allowedCategories ?? c.categories).includes(category)),
      unsafePass: !!o && o.source === 'pass' && o.quality === 'pass' &&
        (c.expectedSource !== 'pass' || c.expectedQuality !== 'pass') };
  });
  return { rows, soundDenominator: sound.length, soundRetained: rows.filter(r => r.cohort === 'sound' && r.source === 'pass' && r.quality === 'pass').length,
    challengeDenominator: challenges.length, challengeUnsafePasses: rows.filter(r => r.cohort === 'challenge' && r.unsafePass).length,
    missingReplies: gold.length - observed.length, regressionEscapes: rows.filter(r => r.cohort === 'regression' && r.unsafePass).length,
    rightDecisionWrongCategory: rows.filter(r => r.correctSource && r.correctQuality && !r.correctCategory).length,
    regressionUnresolved: rows.filter(r => r.cohort === 'regression' && (!r.correctSource || !r.correctQuality || !r.correctCategory)).length };
}
