/**
 * B-KNOWLEDGE-ADMIN follow-up — the structure suggester. The blank-form CRUD
 * surface asks a human to invent a taxonomy from nothing; this inverts it per
 * D-KNOWLEDGE-TAXONOMY-MODEL-01 §4: the machine DRAFTS a structure from the
 * corpus the players actually inhabit, and the human verifies group by group.
 * Nothing here writes anything — proposals exist only in the response; every
 * node and edge is minted by the human's Accept click on the normal rails.
 *
 * Grounding rule: proposed CHILDREN must be copied exactly from the real
 * corpus labels supplied (the LLM may not invent leaves — inventing labels is
 * the fragmentation failure mode this whole model kills). Proposed PARENTS may
 * be new labels; that's the taxonomy being born. Suggested thresholds are
 * prefills for the human to tune (§5 — the bar is a human judgment).
 */

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';
import { getCorpusLabelDepths } from '@/server/db/queries/crafter-demand';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
import { domainKey } from '@/lib/knowledge/domain-key';

export type ProposedChild = {
  label: string;
  machineDepth: number;
  humanAuthored: number;
};

export type ProposedGroup = {
  parentLabel: string;
  broadCategory: string | null;
  suggestedThreshold: number;
  children: ProposedChild[];
};

export type ProposeStructureResult =
  | { ok: true; groups: ProposedGroup[]; corpusSize: number; alreadyStructured: number }
  | { ok: false; reason: 'llm_unavailable' | 'nothing_parsed' | 'corpus_empty' };

const MAX_CORPUS_LABELS = 250;
const MAX_GROUPS = 24;
const PROPOSE_TIMEOUT_MS = Math.max(15_000, Number(process.env.KNOWLEDGE_PROPOSE_TIMEOUT_MS ?? 60_000));

const SYSTEM_PROMPT = `You are drafting a knowledge taxonomy for a trivia game. You are given the REAL domain labels players hold, each with its question depth. Group them under parent territories a curious person would recognize as coherent bodies of knowledge.

Rules:
- children arrays must contain labels COPIED EXACTLY from the provided list. Never invent, rename, or merge child labels.
- Each group needs 2–8 children that genuinely belong to the SAME body of knowledge (understanding the parent means understanding its children — e.g. "Renaissance Italy" over "Medici Family" + "Florentine Art"). Do NOT force groupings; a label that fits nowhere is simply omitted.
- Parent labels should be natural territory names (title case), specific enough to mean something ("Renaissance Italy", not "History").
- A provided label may itself serve as the parent of other provided labels when that is the true relationship.
- suggested_threshold: the mastery points bar for the parent — roughly 300 points per child, more for genuinely broad subjects, rounded to a clean number.
- broad_category: one of Literature, Music, Film & TV, History, Science, Sports, Technology, Philosophy, Pop Culture, Food, Architecture, Language — the parent's field.
- Reuse the ALREADY-STRUCTURED parents listed (if any) instead of proposing near-duplicates of them.

Return ONLY JSON:
{ "groups": [ { "parent": "...", "broad_category": "...", "suggested_threshold": 1200, "children": ["...", "..."] } ] }`;

/** Pure parse + validation — exported for unit tests. Children not present in
 *  the corpus (by domainKey fold) are dropped; groups left with <2 children are
 *  discarded; output capped. */
export function parseProposedStructure(
  raw: string,
  corpus: ReadonlyMap<string, ProposedChild>, // keyed by domainKey
): ProposedGroup[] {
  const parsed = parseJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.groups)) return [];

  const seenParents = new Set<string>();
  const groups: ProposedGroup[] = [];
  for (const item of parsed.groups) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const parentLabel = typeof rec.parent === 'string' ? rec.parent.trim() : '';
    if (!parentLabel || parentLabel.length > 120) continue;
    const parentKey = domainKey(parentLabel);
    if (seenParents.has(parentKey)) continue;

    const rawChildren = Array.isArray(rec.children) ? rec.children : [];
    const children: ProposedChild[] = [];
    const seenChildren = new Set<string>();
    for (const child of rawChildren) {
      if (typeof child !== 'string') continue;
      const key = domainKey(child);
      if (key === parentKey || seenChildren.has(key)) continue;
      const real = corpus.get(key);
      if (!real) continue; // invented label — the one unforgivable move
      seenChildren.add(key);
      children.push(real);
    }
    if (children.length < 2) continue;

    const threshold = Number(rec.suggested_threshold);
    seenParents.add(parentKey);
    groups.push({
      parentLabel,
      broadCategory:
        typeof rec.broad_category === 'string' && rec.broad_category.trim()
          ? rec.broad_category.trim()
          : null,
      suggestedThreshold:
        Number.isFinite(threshold) && threshold >= 100 && threshold <= 1_000_000
          ? Math.round(threshold)
          : children.length * 300,
      children,
    });
    if (groups.length >= MAX_GROUPS) break;
  }
  return groups;
}

export async function proposeKnowledgeStructure(): Promise<ProposeStructureResult> {
  const client = getAnthropicClient();
  if (!client) return { ok: false, reason: 'llm_unavailable' };

  const [labelDepths, graph] = await Promise.all([getCorpusLabelDepths(), listKnowledgeGraph()]);

  // Only labels not yet structured (no edge in either direction) need grouping.
  const edgedKeys = new Set(
    graph.edges.flatMap((e) => [e.childDomainKey, e.parentDomainKey]),
  );
  const candidates = labelDepths
    .filter((entry) => !edgedKeys.has(domainKey(entry.label)))
    .sort((a, b) => b.machineDepth + b.humanAuthored - (a.machineDepth + a.humanAuthored))
    .slice(0, MAX_CORPUS_LABELS);
  if (candidates.length === 0) return { ok: false, reason: 'corpus_empty' };

  const corpus = new Map<string, ProposedChild>(
    candidates.map((entry) => [
      domainKey(entry.label),
      { label: entry.label, machineDepth: entry.machineDepth, humanAuthored: entry.humanAuthored },
    ]),
  );

  const existingParents = graph.nodes
    .filter((n) => n.nodeKind !== 'leaf')
    .map((n) => n.label)
    .slice(0, 40);

  const userMessage = [
    wrapUserInput(
      'domain_labels',
      candidates.map((c) => `${c.label} (${c.machineDepth + c.humanAuthored} questions)`).join('\n'),
    ),
    existingParents.length > 0
      ? wrapUserInput('already_structured_parents', existingParents.join('\n'))
      : '',
    'Group these into parent territories. JSON only.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await loggedMessagesCreate(
    client,
    'knowledge-structure-proposal',
    {
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    },
    { timeoutMs: PROPOSE_TIMEOUT_MS },
  );

  const groups = parseProposedStructure(extractTextContent(response.content), corpus);
  if (groups.length === 0) return { ok: false, reason: 'nothing_parsed' };

  return {
    ok: true,
    groups,
    corpusSize: candidates.length,
    alreadyStructured: labelDepths.length - candidates.length,
  };
}
