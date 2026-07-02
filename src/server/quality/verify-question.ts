/**
 * Phase 3 of B-QUESTION-QUALITY-AGENTS-01 — the verifier core.
 *
 * Fact-checks ONE already-published question along the dimension(s) the pure
 * pre-filter routed it to (Phase 2). Resolves from model knowledge first and only
 * falls back to the Anthropic web-search tool when knowledge can't settle a claim
 * (Decision B, web-as-fallback). The web tool is load-bearing: a prior experiment
 * proved prompt-posture and even Opus both miss confidently-wrong niche canon, so
 * grounding against real sources is the only thing that catches that class.
 *
 * Returns null on ANY failure (no client, request error, unparseable verdict) so
 * the caller leaves the row UNSTAMPED and the next sweep retries it (fail-open,
 * matching the existing gates). Usage is logged automatically by
 * loggedMessagesCreate under scope 'batch-verify' (Decision F). Anthropic only —
 * the web tool is provider-specific; provider-swap is out of scope for v1.
 */

import type Anthropic from '@anthropic-ai/sdk';

import {
  ANTHROPIC_MODEL,
  INSTRUCTION_SCOPING_QUALIFIER,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';
import type { VerificationDimension } from '@/server/quality/verification-prefilter';

/** Mirrors the QuestionVerificationVerdict DB enum (0096). 'skipped' is set by the
 *  caller from the pre-filter, never by this module. */
export type VerificationVerdict = 'ok' | 'demoted' | 'unverifiable' | 'skipped';

export type VerifyInput = {
  questionText: string;
  answer: string;
  explanation?: string | null;
  canonicalSubcategory?: string | null;
  broadCategory?: string | null;
  dimensions: VerificationDimension[];
};

export type VerifyResult = {
  /** Never 'skipped' — that's the pre-filter's outcome, not the verifier's. */
  outcome: 'ok' | 'demoted' | 'unverifiable';
  reason: string;
  usedWeb: boolean;
};

// Web search is the grounding mechanism; default ON. Disable with
// VERIFY_WEB_SEARCH_ENABLED=false if the account lacks the tool — the verifier
// still runs knowledge-only (and returns 'unverifiable' for what it can't settle
// rather than a false 'ok'), it just won't catch the confidently-wrong niche class.
function isWebSearchEnabled(): boolean {
  const raw = process.env.VERIFY_WEB_SEARCH_ENABLED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
}

const WEB_SEARCH_MAX_USES = Math.max(1, Number(process.env.VERIFY_WEB_SEARCH_MAX_USES ?? 3));
const VERIFY_TIMEOUT_MS = Math.max(5_000, Number(process.env.VERIFY_TIMEOUT_MS ?? 35_000));

const SYSTEM_PROMPT = `You are fact-checking ONE already-published trivia question to decide whether it should stay in circulation. You are given the question, the answer the game marks correct, optionally its explanation, and which dimension(s) to scrutinise.

Dimensions:
- false_premise: a factual claim in the question's SETUP is untrue — a wrong count, date, attribution, relationship, recurrence, or which book/film/episode — EVEN IF the stated answer is correct.
- extra_fact: the answer or the explanation carries an unasked / adjacent claim that is wrong, even when the headline answer is right.

Method — web search is a FALLBACK, not the default:
1. First resolve from well-established knowledge.
2. ONLY if you cannot CONFIDENTLY confirm or refute a load-bearing claim from knowledge, use the web_search tool to check it. Do not search for things you already know.
3. If you still cannot settle a load-bearing claim after searching, treat it as unverifiable.

Return ONE verdict for the whole question, as a single JSON object AFTER any searching:
{ "verdict": "ok" | "demoted" | "unverifiable", "reason": "<short: name the specific error, or 'verified', or what could not be settled>" }
- "demoted" — a false premise, a wrong adjacent fact, OR a wrong stated answer (name it).
- "unverifiable" — a load-bearing claim could not be confirmed or refuted even after searching.
- "ok" — the stated answer is correct AND every factual claim in the setup/explanation checks out.

Output JSON only — no prose outside the object.${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

/** Pure: parse the verifier's JSON verdict. Exported for unit tests. */
export function parseVerifyVerdict(raw: string): { outcome: 'ok' | 'demoted' | 'unverifiable'; reason: string } | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const v = parsed.verdict;
  if (v !== 'ok' && v !== 'demoted' && v !== 'unverifiable') return null;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '';
  return { outcome: v, reason: reason || v };
}

function buildUserMessage(input: VerifyInput): string {
  return [
    wrapUserInput('question', input.questionText),
    wrapUserInput('stated_answer', input.answer),
    input.explanation ? wrapUserInput('explanation', input.explanation) : '',
    input.canonicalSubcategory
      ? wrapUserInput(
          'subject',
          `${input.canonicalSubcategory}${input.broadCategory ? ` (${input.broadCategory})` : ''}`,
        )
      : '',
    wrapUserInput('check_dimensions', input.dimensions.join(', ') || 'false_premise, extra_fact'),
    'Fact-check it. Use web_search only when knowledge cannot settle a claim. Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function verifyQuestion(input: VerifyInput): Promise<VerifyResult | null> {
  const client = getAnthropicClient();
  if (!client) return null; // fail-open: leave unstamped, retry next sweep

  const tools: Anthropic.MessageCreateParamsNonStreaming['tools'] = isWebSearchEnabled()
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES }]
    : undefined;

  let response: Anthropic.Message;
  try {
    response = await loggedMessagesCreate(
      client,
      'batch-verify',
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
        ...(tools ? { tools } : {}),
      },
      { timeoutMs: VERIFY_TIMEOUT_MS },
    );
  } catch (error) {
    console.warn('[verifyQuestion] request_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null; // fail-open
  }

  const parsed = parseVerifyVerdict(extractTextContent(response.content));
  if (!parsed) {
    console.warn('[verifyQuestion] invalid_verdict_json');
    return null; // fail-open: unparseable → leave unstamped for the next sweep
  }

  const usedWeb =
    Array.isArray(response.content) &&
    response.content.some((block) => {
      const type = (block as { type?: string }).type;
      return type === 'server_tool_use' || type === 'web_search_tool_result';
    });

  return { ...parsed, usedWeb };
}

/**
 * Pure: the column patch for a Question, given the final verdict. Demote-only
 * (Decision A) — sets publicStatus = 'needs_review' but NEVER touches answerText.
 * Always stamps verifiedAt + verificationVerdict so the row is not re-swept.
 * `reason` (0100) is the verifier's short verdict reason, surfaced on the admin
 * review queue's machine-demotion cards; omitted for pre-filter 'skipped' rows.
 */
export function verdictToQuestionPatch(
  verdict: VerificationVerdict,
  now: Date,
  reason?: string,
): {
  verificationVerdict: VerificationVerdict;
  verifiedAt: Date;
  updatedAt: Date;
  publicStatus?: 'needs_review';
  verificationReason?: string;
} {
  const base = {
    verificationVerdict: verdict,
    verifiedAt: now,
    updatedAt: now,
    ...(reason?.trim() ? { verificationReason: reason.trim() } : {}),
  };
  return verdict === 'demoted' ? { ...base, publicStatus: 'needs_review' as const } : base;
}

/**
 * Pure: the column patch for a GeneratedQuestion. Demote suppresses via the one
 * flag the bank honors (is_duplicate); ok/unverifiable/skipped just stamp.
 * `reason` mirrors the Question patch (0100).
 */
export function verdictToGeneratedPatch(
  verdict: VerificationVerdict,
  now: Date,
  reason?: string,
): {
  verificationVerdict: VerificationVerdict;
  verifiedAt: Date;
  isDuplicate?: true;
  verificationReason?: string;
} {
  const base = {
    verificationVerdict: verdict,
    verifiedAt: now,
    ...(reason?.trim() ? { verificationReason: reason.trim() } : {}),
  };
  return verdict === 'demoted' ? { ...base, isDuplicate: true as const } : base;
}
