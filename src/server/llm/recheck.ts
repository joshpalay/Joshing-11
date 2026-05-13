import { ANTHROPIC_MODEL, extractTextContent, getAnthropicClient, parseJsonObject } from '@/lib/llm';

export type AnswerRecheckDecision = 'accept' | 'reject' | 'needs_human';

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

  const decision = parsed.decision === 'accept' || parsed.decision === 'reject' || parsed.decision === 'needs_human'
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

Return "reject" when the answer is factually different, too vague, missing the key required fact, or only in the same general topic.

Return "needs_human" when the question wording or factual dispute requires outside context you cannot confidently resolve.

Do not be generous just because the answer is close; do be generous when the answer demonstrates the same knowledge.

Return JSON only with exactly these keys:
{
  "decision": "accept" | "reject" | "needs_human",
  "confidence": 0.0,
  "reason": "one concise sentence for the player",
  "accepted_alternative": "the submitted answer normalized for future accepted alternatives, or null"
}`;

  const userMessage = `Question: ${params.questionText}
Canonical answer: ${params.canonicalAnswer}
Already accepted alternatives: ${(params.acceptedAlternatives ?? []).join(' | ') || '(none)'}
Submitted answer to recheck: ${params.submittedAnswer}
Question type: ${params.questionType}

Should this challenged answer count? Return JSON only.`;

  try {
    const response = await client.messages.create({
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
