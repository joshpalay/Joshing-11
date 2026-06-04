import { extractTextContent, getAnthropicClient, loggedMessagesCreate } from '@/lib/llm';

const BREADCRUMB_MODEL = 'claude-haiku-4-5-20251001';
const BREADCRUMB_TIMEOUT_MS = 3000;

type GenerateBreadcrumbParams = {
  questionId?: string;
  questionText: string;
  correctAnswer: string;
  submittedAnswer: string;
  isCorrect: boolean;
  domain: string;
};

const BREADCRUMB_CACHE_MAX = 500;
const breadcrumbCache = new Map<string, string | null>();

function cacheKey(params: GenerateBreadcrumbParams): string {
  const questionKey = params.questionId?.trim() || params.questionText.trim().toLowerCase();
  // Correct-answer breadcrumbs don't reference the submitted text, so they're
  // shareable per question. Wrong-answer breadcrumbs embed the exact guess
  // ("you answered X instead of Y"), so they MUST be keyed by that guess —
  // otherwise the first miss poisons the shared cache and every later user who
  // misses the same question sees the first user's answer.
  if (params.isCorrect) return `${questionKey}:correct`;
  const answerKey = params.submittedAnswer.trim().toLowerCase();
  return `${questionKey}:wrong:${answerKey}`;
}

function setCacheEntry(key: string, value: string | null): void {
  if (breadcrumbCache.has(key)) breadcrumbCache.delete(key);
  breadcrumbCache.set(key, value);
  while (breadcrumbCache.size > BREADCRUMB_CACHE_MAX) {
    const oldest = breadcrumbCache.keys().next().value;
    if (oldest === undefined) break;
    breadcrumbCache.delete(oldest);
  }
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
    setCacheEntry(key, null);
    return null;
  }

  const answerContext = params.isCorrect
    ? 'The user got it right.'
    : `The user answered "${params.submittedAnswer}" instead of the correct answer "${params.correctAnswer}".`;

  const request = loggedMessagesCreate(client, 'breadcrumb', {
    model: BREADCRUMB_MODEL,
    max_tokens: 120,
    temperature: 0.55,
    system: [{
      type: 'text',
      text: 'You write tiny contextual breadcrumbs for a warm trivia chat. Return plain text only, no markdown.',
      cache_control: { type: 'ephemeral' },
    }],
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
  setCacheEntry(key, text);
  return text;
}
