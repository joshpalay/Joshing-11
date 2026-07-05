/**
 * Answer suggestion for the "Write a question" form. When a user types a
 * question, the form auto-fills a suggested correct answer, alternate answers,
 * and an explanation from this module.
 *
 * Two layers guard against the model answering a *different* attribute than the
 * one asked (the "surrey ... dashboard?" → "isinglass" failure: isinglass is the
 * surrey's curtains, not its dashboard):
 *   1. A Sonnet generation prompt that forces the model to first name the exact
 *      entity + attribute being asked about (in a `reasoning` field we discard)
 *      before committing to an answer.
 *   2. A verification pass (Sonnet by default — see VERIFIER_MODEL) that catches
 *      an answer aimed at the wrong attribute OR a confident misattribution (right
 *      topic, wrong entity/person — the "Balthazar Getty → Keanu Reeves" class),
 *      and when confident hands back the correct one so we can regenerate once.
 *
 * The verifier is strictly fail-open: any error/timeout/invalid output leaves the
 * original suggestion untouched, so an LLM hiccup never blocks the suggestion.
 *
 * This verification is what lets the form treat the suggestion as a VERIFIED
 * answer the author can adopt as-is. If the author instead says it's wrong and
 * supplies their own answer, that answer is fact-checked on demand (verifyAnswer,
 * exposed at /api/questions/verify-answer) before it earns "verified". See
 * QuestionForm's isVerifiedAnswer.
 */

import {
  ANTHROPIC_MODEL,
  HAIKU_MODEL,
  HAIKU_GATE_TIMEOUT_MS,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  INSTRUCTION_SCOPING_QUALIFIER,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  modelRejectsSamplingParams,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

// Verifier model. The verifier's whole job is to catch a confidently-wrong
// suggestion before it reaches the author, and model tier is the dominant factor
// in factual recall on obscure facts — the same finding that moved the daily
// factual gate to Sonnet (see generate-questions.ts). Haiku silently passed the
// "Balthazar Getty → Keanu Reeves" DFW miss because it does not know that fact
// either; Sonnet catches that class. The verifier runs once per authored
// question, so a stronger model here is a small cost on a high-leverage check.
// Override SUGGEST_VERIFY_MODEL=claude-haiku-4-5-20251001 to revert without a deploy.
const VERIFIER_MODEL = process.env.SUGGEST_VERIFY_MODEL?.trim() || ANTHROPIC_MODEL;
// Haiku's 12s timeout is tuned for Haiku's speed; a heavier verifier needs more
// headroom or it times out and fails open (silently disabling the check).
const VERIFIER_TIMEOUT_MS = VERIFIER_MODEL === HAIKU_MODEL ? HAIKU_GATE_TIMEOUT_MS : 20_000;

export type QuestionSuggestion = {
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string;
};

const GENERATION_SYSTEM_PROMPT = `You are helping someone write a trivia question. Given a question, you supply the single correct answer, a few accepted alternate phrasings, and a short educational explanation.

The most important rule: answer the EXACT thing the question asks about. A question names an entity and asks about one specific attribute or property of it. Identify that attribute precisely and answer THAT — never substitute a different, more famous, or adjacent fact about the same entity.
  Example: "The surrey with the fringe on top has what kind of dashboard?" asks about the surrey's DASHBOARD (genuine leather), not its windows/curtains (isinglass). Answering "isinglass" would be wrong because it answers a different attribute.

Work in this order and return JSON only:
1. reasoning: one or two sentences naming (a) the entity and (b) the exact attribute the question asks about, then the answer that fits that attribute. This field is internal and is discarded.
2. correctAnswer: the single best correct answer, concise (1-5 words where possible), answering the attribute named in reasoning.
3. alternateAnswers: up to 3 alternate accepted answers (common variations, abbreviations, or alternate phrasings that should also be marked correct). Use [] if none apply.
4. explanation: a brief educational explanation (2-3 sentences) that would help someone learn if they got it wrong.

Respond with valid JSON only, no prose outside the object:
{ "reasoning": "...", "correctAnswer": "...", "alternateAnswers": ["...", "..."], "explanation": "..." }${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

const VERIFIER_SYSTEM_PROMPT = `You are fact-checking a single proposed answer to a trivia question before it is shown to the question's author. You are given the question and the proposed answer.

Decide one verdict:
- "OK" — the proposed answer correctly and directly answers the SPECIFIC thing the question asks about.
- "WRONG" — the answer is factually incorrect, OR it names the wrong entity/person (a plausible but incorrect name — the question is about the right topic but the proposed answer is simply the wrong one, e.g. attributing a quote or role to the wrong celebrity), OR it answers a different attribute than the one asked (e.g. the question asks about an entity's dashboard but the answer describes its windows). When you are confident, supply the correct answer in corrected_answer.
- "UNVERIFIABLE" — you genuinely cannot verify the fact (niche, recent, or personal). Treat as acceptable; do not flag.

Flag "WRONG" only when you are confident. A high bar applies — when in doubt, return "OK".

Return valid JSON only: { "verdict": "OK" | "WRONG" | "UNVERIFIABLE", "corrected_answer": "..." | null }${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

export function asSuggestion(value: Record<string, unknown> | null): QuestionSuggestion | null {
  const correctAnswer = typeof value?.correctAnswer === 'string' ? value.correctAnswer.trim() : '';
  const alternateAnswers = Array.isArray(value?.alternateAnswers)
    ? value.alternateAnswers
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
    : [];
  const explanation = typeof value?.explanation === 'string' ? value.explanation.trim() : '';

  if (!correctAnswer || !explanation) return null;
  return { correctAnswer, alternateAnswers, explanation };
}

export type VerifierVerdict = {
  verdict: 'OK' | 'WRONG' | 'UNVERIFIABLE';
  correctedAnswer: string | null;
};

/** Pure parse of the verifier's raw output. Unknown/malformed → fail-open OK. */
export function parseVerifierResponse(rawText: string): VerifierVerdict {
  const parsed = parseJsonObject(rawText);
  const verdict = parsed?.verdict;
  if (verdict !== 'WRONG' && verdict !== 'UNVERIFIABLE' && verdict !== 'OK') {
    return { verdict: 'UNVERIFIABLE', correctedAnswer: null };
  }
  const corrected = typeof parsed?.corrected_answer === 'string' ? parsed.corrected_answer.trim() : '';
  return { verdict, correctedAnswer: corrected ? corrected.slice(0, 240) : null };
}

type AnthropicClient = NonNullable<ReturnType<typeof getAnthropicClient>>;

async function generateSuggestion(
  client: AnthropicClient,
  questionText: string,
  correctionHint?: string,
): Promise<QuestionSuggestion | null> {
  const userMessage = [
    wrapUserInput('question', questionText),
    correctionHint
      ? `A reviewer believes the correct answer is "${correctionHint}". Re-read the question, verify which attribute it asks about, and use that answer if the reviewer is right.`
      : null,
    'Suggest the answer. Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await loggedMessagesCreate(client, 'questions-suggest', {
    model: ANTHROPIC_MODEL,
    max_tokens: 500,
    temperature: 0,
    system: GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  return asSuggestion(parseJsonObject(extractTextContent(response.content)));
}

async function verifySuggestion(
  client: AnthropicClient,
  questionText: string,
  suggestion: QuestionSuggestion,
): Promise<VerifierVerdict> {
  try {
    const userMessage = [
      wrapUserInput('question', questionText),
      wrapUserInput('proposed_answer', suggestion.correctAnswer),
      'Verify the proposed answer. Return JSON only.',
    ].join('\n');

    const response = await loggedMessagesCreate(
      client,
      'questions-suggest-verify',
      {
        model: VERIFIER_MODEL,
        max_tokens: 300,
        // Opus 4.7/4.8 / Sonnet-5 / Fable reject sampling params (HTTP 400);
        // Haiku 4.5 and Sonnet 4.6 accept temperature. Guard so a stronger
        // verifier override does not 400.
        ...(modelRejectsSamplingParams(VERIFIER_MODEL) ? {} : { temperature: 0 }),
        system: VERIFIER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      },
      { timeoutMs: VERIFIER_TIMEOUT_MS },
    );

    return parseVerifierResponse(extractTextContent(response.content));
  } catch (error) {
    // Fail open: never block the suggestion on a verifier hiccup.
    console.warn('[suggestQuestionAnswer] verify_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { verdict: 'UNVERIFIABLE', correctedAnswer: null };
  }
}

export async function suggestQuestionAnswer(questionText: string): Promise<QuestionSuggestion> {
  const client = getAnthropicClient();
  if (!client) throw new Error('LLM unavailable');

  const suggestion = await generateSuggestion(client, questionText);
  if (!suggestion) throw new Error('Invalid suggestion response');

  const verdict = await verifySuggestion(client, questionText, suggestion);
  if (verdict.verdict !== 'WRONG' || !verdict.correctedAnswer) {
    return suggestion;
  }

  // The verifier caught an answer aimed at the wrong attribute and gave us the
  // correct one. Regenerate once, seeded with the correction; keep the original
  // only if the retry fails to produce a usable suggestion.
  const corrected = await generateSuggestion(client, questionText, verdict.correctedAnswer);
  return corrected ?? suggestion;
}

/**
 * Fact-check a single proposed answer against a question and return the verifier's
 * verdict (plus a correction when it is confident the answer is wrong). This is the
 * same verification pass suggestQuestionAnswer runs internally, exposed for surfaces
 * where a human edits an answer and wants an on-demand "is this right?" check (e.g.
 * the crafter keep/kill cards). Fail-open: with no client or on any verifier hiccup
 * it returns UNVERIFIABLE rather than throwing, so the caller never blocks on it.
 */
export async function verifyAnswer(
  questionText: string,
  proposedAnswer: string,
): Promise<VerifierVerdict> {
  const client = getAnthropicClient();
  if (!client) return { verdict: 'UNVERIFIABLE', correctedAnswer: null };
  return verifySuggestion(client, questionText, {
    correctAnswer: proposedAnswer,
    alternateAnswers: [],
    explanation: '',
  });
}
