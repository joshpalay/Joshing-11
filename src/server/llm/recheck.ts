import {
  ANTHROPIC_MODEL,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export type AnswerRecheckDecision = 'accept' | 'reject' | 'canonical_disputed' | 'needs_human';

export type AnswerRecheckResult = {
  decision: AnswerRecheckDecision;
  confidence: number;
  reason: string;
  acceptedAlternative: string | null;
};

const FALLBACK_RECHECK: AnswerRecheckResult = {
  decision: 'needs_human',
  confidence: 0,
  reason: 'The recheck service could not confidently review this answer.',
  acceptedAlternative: null,
};

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAnswerRecheck(rawText: string): AnswerRecheckResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed) return FALLBACK_RECHECK;

  const decision =
    parsed.decision === 'accept' ||
    parsed.decision === 'reject' ||
    parsed.decision === 'canonical_disputed' ||
    parsed.decision === 'needs_human'
      ? parsed.decision
      : null;
  if (!decision) return FALLBACK_RECHECK;

  return {
    decision,
    confidence: clampConfidence(parsed.confidence),
    reason: trimmedString(parsed.reason) ?? FALLBACK_RECHECK.reason,
    acceptedAlternative: decision === 'accept' ? trimmedString(parsed.accepted_alternative) : null,
  };
}

export async function recheckAnswerWithLLM(params: {
  questionText: string;
  canonicalAnswer: string;
  submittedAnswer: string;
  questionType: string;
  acceptedAlternatives?: string[];
}): Promise<AnswerRecheckResult> {
  const client = getAnthropicClient();
  if (!client) return FALLBACK_RECHECK;

  const systemPrompt = `You are the answer-appeal reviewer for Joshing, a social trivia game.

A player was marked wrong and is asking for a second look. Be fair, careful, and slightly more deliberative than the first-pass grader.

Return "accept" only when the submitted answer should count as correct under at least one of these rules:
- It is equivalent to the canonical answer.
- It is a clearly valid alternate name, spelling, abbreviation, title, translation, or transliteration.
- It is more specific than the canonical answer without changing the meaning.
- The question is ambiguous and the submitted answer is a reasonable correct answer to that wording.
- For personal questions, it is a reasonable match to the creator's intended answer.

Return "reject" when the submitted answer is factually different, too vague, missing the key required fact, or only in the same general topic — AND the canonical answer is itself correct for the question.

Return "canonical_disputed" when the submitted answer is not acceptable, BUT the canonical answer provided to you is itself factually wrong for the question (for example, the question and the canonical answer come from mismatched subjects, or the canonical answer names the wrong person, work, date, or thing). This is the case where rejecting the player would mean defending a wrong answer key. Use a high bar: only choose this when you are confident the canonical answer is wrong, not merely when you are unsure. Do not use it just because the question is hard or niche. When you do choose it, name the answer you believe is actually correct in "reason". (If the submitted answer is in fact the correct one and the canonical is the wrong one, return "accept" — give the player credit.)

Return "needs_human" when the question wording or factual dispute requires outside context you cannot confidently resolve.

Do not be generous just because the answer is close; do be generous when the answer demonstrates the same knowledge.

Return JSON only with exactly these keys:
{
  "decision": "accept" | "reject" | "canonical_disputed" | "needs_human",
  "confidence": 0.0,
  "reason": "one concise sentence for the player",
  "accepted_alternative": "the submitted answer normalized for future accepted alternatives, or null"
}${INSTRUCTION_USER_INPUT_GUIDANCE}`;

  const userMessage = `${wrapUserInput('question', params.questionText)}
${wrapUserInput('canonical_answer', params.canonicalAnswer)}
${wrapUserInput('accepted_alternatives', (params.acceptedAlternatives ?? []).join(' | ') || '(none)')}
${wrapUserInput('submitted_answer', params.submittedAnswer)}
${wrapUserInput('question_type', params.questionType)}

Should this challenged answer count? Return JSON only.`;

  try {
    // ~600 tokens — below Sonnet's 1024 cache threshold; plain string.
    const response = await loggedMessagesCreate(client, 'recheck', {
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    return parseAnswerRecheck(extractTextContent(response.content));
  } catch (error) {
    console.warn('[llm/recheck] request_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return FALLBACK_RECHECK;
  }
}
