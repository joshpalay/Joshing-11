import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '@/lib/llm';
import { DIFFICULTY_COPY, type QuestionDifficultyTier } from '@/lib/questions/difficulty-copy';

export { DIFFICULTY_COPY };

export type QuestionDifficultyAssessment = {
  tier: QuestionDifficultyTier;
  difficulty: 1 | 3 | 4 | 5;
};

const TIER_TO_DIFFICULTY: Record<
  QuestionDifficultyTier,
  QuestionDifficultyAssessment['difficulty']
> = {
  establishing: 1,
  solid: 3,
  skilled: 4,
  master: 5,
};

function asDifficultyTier(value: unknown): QuestionDifficultyTier | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'establishing') return 'establishing';
  if (normalized === 'solid') return 'solid';
  if (normalized === 'skilled') return 'skilled';
  if (normalized === 'master' || normalized === 'mastery') return 'master';
  return null;
}

export function parseQuestionDifficultyAssessment(
  rawText: string,
): QuestionDifficultyAssessment | null {
  const parsed = parseJsonObject(rawText);
  const tier = asDifficultyTier(parsed?.tier ?? parsed?.difficultyTier ?? parsed?.difficulty);
  if (!tier) return null;
  return { tier, difficulty: TIER_TO_DIFFICULTY[tier] };
}

export function fallbackQuestionDifficulty(): QuestionDifficultyAssessment {
  return { tier: 'solid', difficulty: TIER_TO_DIFFICULTY.solid };
}

export async function assessQuestionDifficulty(params: {
  questionText: string;
  correctAnswer: string;
  broadCategory: string | null;
  canonicalSubcategory: string;
  explanation?: string | null;
}): Promise<QuestionDifficultyAssessment> {
  const questionText = params.questionText.trim();
  const correctAnswer = params.correctAnswer.trim();
  const canonicalSubcategory = params.canonicalSubcategory.trim();
  if (!questionText || !correctAnswer || !canonicalSubcategory) return fallbackQuestionDifficulty();

  const client = getAnthropicClient();
  if (!client) return fallbackQuestionDifficulty();

  const prompt = `Rate the difficulty of this trivia question relative to its specific domain, not by the author's opinion.

Domain: ${canonicalSubcategory}
Broad category: ${params.broadCategory ?? 'Unknown'}
Question: ${questionText}
Correct answer: ${correctAnswer}
Explanation: ${params.explanation?.trim() || 'None provided'}

Use this domain-relative scale:
- establishing: a newcomer to the domain could reasonably answer it, or it checks core recognition.
- solid: a generally knowledgeable person in the domain should know it.
- skilled: requires deeper domain fluency, specific context, or non-obvious recall.
- master: a specialist-level deep cut even within the domain.

Respond in JSON only: { "tier": "establishing" | "solid" | "skilled" | "master" }`;

  try {
    const response = await loggedMessagesCreate(client, 'difficulty', {
      model: ANTHROPIC_MODEL,
      max_tokens: 120,
      temperature: 0,
      system: 'Return only valid JSON. No markdown or prose outside JSON.',
      messages: [{ role: 'user', content: prompt }],
    });

    return (
      parseQuestionDifficultyAssessment(extractTextContent(response.content)) ??
      fallbackQuestionDifficulty()
    );
  } catch (error) {
    console.warn('[questions/difficulty] LLM assessment unavailable; using fallback', {
      domain: canonicalSubcategory,
      message: error instanceof Error ? error.message : String(error),
    });
    return fallbackQuestionDifficulty();
  }
}
