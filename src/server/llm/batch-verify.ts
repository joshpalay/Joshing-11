/**
 * Batch verification pass for the nightly sweep
 * (D-QUESTION-QUALITY-AGENTS-01, Decision A demote-only).
 *
 * Two concerns:
 *   1. prefilterQuestion — pure deterministic classification, zero LLM cost.
 *      Decides whether to skip (personal), treat as stable (verify from model
 *      knowledge), or flag as volatile (would benefit from web search in a
 *      future iteration; for now treated identically to stable but tracked
 *      separately so the split is measurable).
 *
 *   2. batchVerifyQuestion — Haiku pass checking for (B-i) false/incorrect
 *      premises and (B-ii) wrong-attribute answers. Returns a structured verdict
 *      the cron route maps onto Question.verificationVerdict and, on a demote,
 *      Question.publicStatus = 'needs_review' (Decision A).
 *
 * Usage telemetry: loggedMessagesCreate records every call to LlmUsageEvent
 * automatically under the scope 'batch-verify', which the cost-report surface
 * map folds into the 'quality' bucket.
 */

import {
  HAIKU_MODEL,
  HAIKU_GATE_TIMEOUT_MS,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  INSTRUCTION_SCOPING_QUALIFIER,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

// ─── Pre-filter ───────────────────────────────────────────────────────────────

/**
 * Prefilter classification:
 *   'skip'     — personal or non-factual question; model cannot be the arbiter.
 *   'stable'   — canonical historical/scientific fact; verify from model knowledge.
 *   'volatile' — contains temporal/superlative language that may require web
 *                search in a future iteration (treated as stable for v1; tracked
 *                separately so coverage is measurable).
 */
export type PrefilterResult = 'skip' | 'stable' | 'volatile';

// Temporal/superlative markers that suggest a claim might have changed since
// training. Anchored to word boundaries to avoid false matches (e.g., "current
// account" should not trigger). A question explicitly anchored to a past year
// (e.g. "in 1987", "during the 19th century") overrides these patterns.
const VOLATILE_PATTERNS: RegExp[] = [
  /\bcurrently\b/i,
  /\bright now\b/i,
  /\bas of (today|now|this year|this month)\b/i,
  /\b(the )?latest\b/i,
  /\bmost recent(ly)?\b/i,
  /\bnewest\b/i,
  /\bat present\b/i,
  /\bworld record\b/i,
  /\ball[- ]time (high|low|best|worst|record)\b/i,
  // "who currently holds", "who is the current X" etc.
  /\b(who|what) (is|are) (the )?current(ly)?\b/i,
];

// A question anchored to a specific past year is stable even if it contains
// superlatives like "first" or "best of the decade".
const PAST_YEAR_ANCHOR = /\b(in|during|of|from)\s+(the\s+)?(1[0-9]{3}|20[0-1][0-9])\b/i;

/**
 * Pure, deterministic pre-filter — no LLM call, no I/O.
 * Used by the nightly sweep to decide whether to call batchVerifyQuestion and,
 * when called, whether the question is a candidate for future web-search
 * escalation.
 */
export function prefilterQuestion(params: {
  questionText: string;
  questionType?: string | null;
}): PrefilterResult {
  // Personal questions are author-defined truths — LLM knowledge cannot
  // verify them and we have no claim to override the author's answer.
  if (params.questionType === 'personal') return 'skip';

  // Past-year anchor overrides volatile patterns: "Who set the world 100m
  // record in 1988?" has a stable answer even though "world record" matches.
  if (PAST_YEAR_ANCHOR.test(params.questionText)) return 'stable';

  if (VOLATILE_PATTERNS.some((p) => p.test(params.questionText))) return 'volatile';

  return 'stable';
}

// ─── Batch LLM verifier ──────────────────────────────────────────────────────

export type BatchVerifyVerdict =
  | { verdict: 'ok'; reason: string }
  | { verdict: 'demote'; reason: string }
  | { verdict: 'unverifiable'; reason: string }
  | { verdict: 'error'; reason: string };

const SYSTEM_PROMPT = `You are fact-checking trivia questions that will be played by real users. For each question you receive, check two things:

1. PREMISE — Is the question's premise factually accurate? A false premise is one where the question assumes something untrue as a given (e.g., "What colour was Einstein's famous red hat?" — Einstein had no famous red hat).

2. ANSWER — Does the stated answer directly address the SPECIFIC attribute the question asks about, rather than a neighboring or adjacent fact? (e.g., "The surrey with the fringe on top has what kind of dashboard?" → the answer should be about the *dashboard*, not the curtains/windows.)

Return only valid JSON:
{
  "verdict": "ok" | "demote" | "unverifiable",
  "reason": "<explanation, ≤120 chars, human-readable, no markdown>"
}

Verdict rules:
- "ok": both the premise and the answer look factually correct and well-targeted.
- "demote": you are CONFIDENT the premise is false OR the answer targets the wrong attribute. High bar — only demote when clearly wrong.
- "unverifiable": you cannot assess the premise or answer from your training knowledge (niche subject, too recent, or personal knowledge required).

Tie-break rule: when in doubt, return "ok" or "unverifiable", never "demote". A false positive (demoting a good question) is worse than a false negative. The goal is to catch clear errors that would confuse players, not to second-guess every nuance.${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

function buildUserMessage(params: {
  questionText: string;
  answerText: string;
  alternateAnswers?: string[];
  explanation?: string | null;
  broadCategory?: string | null;
  canonicalSubcategory?: string | null;
}): string {
  const lines = [
    wrapUserInput('question', params.questionText),
    wrapUserInput('stated_answer', params.answerText),
  ];
  if (params.alternateAnswers && params.alternateAnswers.length > 0) {
    lines.push(wrapUserInput('accepted_alternates', params.alternateAnswers.join(' | ')));
  }
  if (params.explanation) {
    lines.push(wrapUserInput('explanation', params.explanation));
  }
  if (params.canonicalSubcategory) {
    lines.push(wrapUserInput('category', `${params.canonicalSubcategory}${params.broadCategory ? ` (${params.broadCategory})` : ''}`));
  }
  lines.push('Verify this question. Return JSON only.');
  return lines.join('\n');
}

function parseVerdict(rawText: string): BatchVerifyVerdict {
  const parsed = parseJsonObject(rawText);
  if (!parsed) return { verdict: 'error', reason: 'invalid_llm_json' };

  const v = parsed.verdict;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 240) : '';

  if (v === 'ok') return { verdict: 'ok', reason: reason || 'verified clean' };
  if (v === 'demote') return { verdict: 'demote', reason: reason || 'flagged for review' };
  if (v === 'unverifiable') return { verdict: 'unverifiable', reason: reason || 'cannot verify from training data' };

  return { verdict: 'error', reason: 'unrecognised_verdict' };
}

export type BatchVerifyInput = {
  questionText: string;
  answerText: string;
  alternateAnswers?: string[];
  explanation?: string | null;
  broadCategory?: string | null;
  canonicalSubcategory?: string | null;
};

/**
 * Single-question LLM verification pass for the nightly batch sweep.
 * Checks for false premises and wrong-attribute answers (Decision B-i and B-ii).
 * On LLM error returns { verdict: 'error' } so the caller can mark the row
 * and skip without disrupting the rest of the batch.
 */
export async function batchVerifyQuestion(input: BatchVerifyInput): Promise<BatchVerifyVerdict> {
  const client = getAnthropicClient();
  if (!client) return { verdict: 'error', reason: 'llm_disabled' };

  try {
    const response = await loggedMessagesCreate(client, 'batch-verify', {
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(input) }],
    }, { timeoutMs: HAIKU_GATE_TIMEOUT_MS });

    return parseVerdict(extractTextContent(response.content));
  } catch (error) {
    console.warn('[llm/batch-verify] request_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { verdict: 'error', reason: 'llm_error' };
  }
}
