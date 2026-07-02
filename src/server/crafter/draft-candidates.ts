/**
 * B-CRAFTER-LIFECYCLE-01 Phase 2 — the crafter draft path.
 *
 * Drafts N candidate questions for ONE domain at a chosen tier, WITHOUT
 * persisting anything: this mirrors callLlmOnce in generate-questions.ts (same
 * SYSTEM_PROMPT, same buildUserPrompt, same parse contract) but drops the
 * gate-and-insert machinery. The daily pipeline's gates run here too — only as
 * FLAGS, never as drops: the whole point of the creation surface is that the
 * HUMAN judges each candidate, with the machine's own doubts shown honestly
 * (a fabrication-suspect candidate is surfaced for the crafter to catch, not
 * silently discarded).
 *
 * Nothing drafted here reaches a player: a candidate only becomes real when the
 * crafter keeps it, at which point it enters through createQuestion with
 * verifiedAt=NULL — the batch-verify sweep re-checks every kept question.
 */

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
} from '@/lib/llm';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  findAnswerLeaks,
  findFactualFailures,
  findQualityFailures,
  parseQuestions,
  type LlmQuestion,
} from '@/server/daily/generate-questions';
import { getDomainPoolAvoidLists } from '@/server/db/queries/retrieval-demand';
import { getAuthoredQuestionEntriesForDomain } from '@/server/db/queries/crafter-demand';

// The crafter surface's two tiers map onto the generation prompt's fixed
// difficulty vocabulary: shallow = 'normal' (accessible — everyone who plays
// knows), deep = 'challenging' (specialist — only a real fan knows). The
// layering is load-bearing (machine fine for shallow, human for deep) — do not
// collapse it.
export type DraftTier = 'shallow' | 'deep';

const TIER_TO_PREFERENCE: Record<DraftTier, string> = {
  shallow: 'normal',
  deep: 'challenging',
};

const AVOID_LIST_LIMIT = 60;
const DRAFT_TIMEOUT_MS = Math.max(10_000, Number(process.env.CRAFTER_DRAFT_TIMEOUT_MS ?? 45_000));

export type DraftFlag =
  | { kind: 'factual_suspect'; note: string }
  | { kind: 'quality'; note: string }
  | { kind: 'answer_leak'; note: string }
  | { kind: 'tier_mismatch'; note: string };

export type DraftCandidate = {
  questionText: string;
  answer: string;
  explainer: string;
  difficultyEstimate: LlmQuestion['difficulty_estimate'];
  factKey: string | null;
  broadCategory: string;
  canonicalSubcategory: string;
  // The machine's own doubts, surfaced for the human — never used to drop.
  flags: DraftFlag[];
};

export type DraftResult =
  | { ok: true; candidates: DraftCandidate[] }
  | { ok: false; reason: 'llm_unavailable' | 'nothing_parsed' };

export async function draftCandidatesForDomain(opts: {
  domain: string;
  tier: DraftTier;
  count: number;
}): Promise<DraftResult> {
  const client = getAnthropicClient();
  if (!client) return { ok: false, reason: 'llm_unavailable' };

  // Avoid both pools: the machine bank's texts/fact-keys AND the human-authored
  // canonical questions in this domain (which carry no fact_key, so text is the
  // only channel that catches them).
  const [{ questionTexts, factKeys }, authoredEntries] = await Promise.all([
    getDomainPoolAvoidLists(opts.domain, AVOID_LIST_LIMIT),
    getAuthoredQuestionEntriesForDomain(opts.domain, AVOID_LIST_LIMIT),
  ]);

  const userPrompt = buildUserPrompt(
    [opts.domain],
    opts.count,
    [...questionTexts, ...authoredEntries],
    factKeys,
    undefined,
    TIER_TO_PREFERENCE[opts.tier],
  );

  // Mirrors callLlmOnce's Anthropic branch (generate-questions.ts:1396) —
  // same model, sampling, and cacheable system prefix; distinct usage scope.
  const response = await loggedMessagesCreate(
    client,
    'crafter-draft',
    {
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      temperature: 0.8,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    },
    { timeoutMs: DRAFT_TIMEOUT_MS },
  );

  const parsed = parseQuestions(extractTextContent(response.content));
  if (parsed.length === 0) return { ok: false, reason: 'nothing_parsed' };

  // Only the PURE flags run here (answer leak, tier mismatch) so candidates
  // render immediately. The two LLM gates run separately via
  // flagDraftCandidates — the client streams those doubts in a beat later
  // rather than holding every card hostage to a second model call.
  const leaks = findAnswerLeaks(parsed);

  const candidates: DraftCandidate[] = parsed.map((q, i) => {
    const flags: DraftFlag[] = [];
    if (leaks.toDrop.has(i)) {
      flags.push({ kind: 'answer_leak', note: leaks.reasons[i] ?? 'answer appears in the question' });
    }
    // Hard tier mismatches only: an 'accessible' answer to a deep request (or a
    // 'specialist' one to a shallow request). 'moderate' passes either way.
    if (opts.tier === 'deep' && q.difficulty_estimate === 'accessible') {
      flags.push({ kind: 'tier_mismatch', note: 'reads as accessible, not a deep cut' });
    } else if (opts.tier === 'shallow' && q.difficulty_estimate === 'specialist') {
      flags.push({ kind: 'tier_mismatch', note: 'reads as a deep cut, not accessible' });
    }
    return {
      questionText: q.question_text,
      answer: q.answer,
      explainer: q.explainer,
      difficultyEstimate: q.difficulty_estimate,
      factKey: q.fact_key,
      broadCategory: q.broad_category,
      canonicalSubcategory: q.canonical_subcategory,
      flags,
    };
  });

  return { ok: true, candidates };
}

export type FlagCandidateInput = {
  questionText: string;
  answer: string;
  difficultyEstimate: 'accessible' | 'moderate' | 'specialist';
};

// The deferred LLM doubt pass: factual + quality gates over already-rendered
// candidates, returned per-index. Both gates fail open (empty sets) exactly as
// in the daily path — an outage means fewer machine doubts shown, never an
// error surfaced to the human.
export async function flagDraftCandidates(
  domain: string,
  candidates: FlagCandidateInput[],
): Promise<Array<{ index: number; flags: DraftFlag[] }>> {
  if (candidates.length === 0) return [];

  // Reconstruct the minimal LlmQuestion shape the gates read (domain, tier,
  // question, answer). Unused fields are stubbed — the gates never touch them.
  const asLlmQuestions: LlmQuestion[] = candidates.map((c) => ({
    canonical_subcategory: domain,
    broad_category: '',
    question_text: c.questionText,
    answer: c.answer,
    explainer: '',
    difficulty_estimate: c.difficultyEstimate,
    fact_key: null,
    subject_entity: null,
    sub_angles: [],
    question_shape: null,
  }));

  const [factual, quality] = await Promise.all([
    findFactualFailures(asLlmQuestions),
    findQualityFailures(asLlmQuestions),
  ]);

  const out: Array<{ index: number; flags: DraftFlag[] }> = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const flags: DraftFlag[] = [];
    if (factual.toDrop.has(i)) {
      flags.push({
        kind: 'factual_suspect',
        note: factual.reasons[i] ?? 'the factual gate doubts this one — verify before keeping',
      });
    }
    if (quality.toDrop.has(i)) {
      flags.push({ kind: 'quality', note: quality.reasons[i] ?? 'flagged by the quality gate' });
    }
    if (flags.length > 0) out.push({ index: i, flags });
  }
  return out;
}
