import { extractTextContent, getAnthropicClient } from '@/lib/llm';

const BREADCRUMB_MODEL = 'claude-haiku-4-5';
const BREADCRUMB_TIMEOUT_MS = 3000;

type GenerateBreadcrumbParams = {
  questionId?: string;
  questionText: string;
  correctAnswer: string;
  submittedAnswer: string;
  isCorrect: boolean;
  domain: string;
};

const breadcrumbCache = new Map<string, string | null>();

function cacheKey(params: GenerateBreadcrumbParams): string {
  const questionKey = params.questionId?.trim() || params.questionText.trim().toLowerCase();
  return `${questionKey}:${params.isCorrect ? 'correct' : 'wrong'}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timeout));
  });
}

function cleanBreadcrumb(text: string): string | null {
  const cleaned = text
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 12) return null;
  return cleaned.slice(0, 420);
}

export async function generateBreadcrumb(params: GenerateBreadcrumbParams): Promise<string | null> {
  const key = cacheKey(params);
  if (breadcrumbCache.has(key)) return breadcrumbCache.get(key) ?? null;

  const client = getAnthropicClient();
  if (!client) {
    breadcrumbCache.set(key, null);
    return null;
  }

  const answerContext = params.isCorrect
    ? 'The user got it right.'
    : `The user answered "${params.submittedAnswer}" instead of the correct answer "${params.correctAnswer}".`;

  const request = client.messages.create({
    model: BREADCRUMB_MODEL,
    max_tokens: 120,
    temperature: 0.55,
    system: 'You write tiny contextual breadcrumbs for a warm trivia chat. Return plain text only, no markdown.',
    messages: [
      {
        role: 'user',
        content: `Generate a 1-2 sentence breadcrumb that adds context or a connecting fact for this trivia question.
${answerContext}
Keep the tone warm, brief, and informative.
Domain: ${params.domain}
Question: ${params.questionText}
Correct answer: ${params.correctAnswer}`,
      },
    ],
  });

  const response = await withTimeout(request, BREADCRUMB_TIMEOUT_MS);
  const text = response ? cleanBreadcrumb(extractTextContent(response.content)) : null;
  breadcrumbCache.set(key, text);
  return text;
}
