import { NextRequest, NextResponse } from 'next/server';

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '@/lib/llm';
import { getSession } from '@/server/auth/session';

function asSuggestion(value: Record<string, unknown> | null) {
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

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as { questionText?: unknown } | null;
  const questionText = typeof body?.questionText === 'string' ? body.questionText.trim() : '';
  if (!questionText) return NextResponse.json({ error: 'questionText is required' }, { status: 400 });

  try {
    const client = getAnthropicClient();
    if (!client) throw new Error('LLM unavailable');

    const prompt = `You are helping someone write a trivia question answer. Given this question: ${questionText} Provide:

The single best correct answer (concise, 1-5 words if possible)
Up to 3 alternate accepted answers (common variations, abbreviations, or alternate phrasings that should also be marked correct)
A brief educational explanation (2-3 sentences) that would help someone learn if they got it wrong.
Respond in JSON only: { "correctAnswer": "...", "alternateAnswers": ["...", "..."], "explanation": "..." }`;

    const response = await loggedMessagesCreate(client, 'questions-suggest', {
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = asSuggestion(parseJsonObject(extractTextContent(response.content)));
    if (!parsed) throw new Error('Invalid suggestion response');

    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: 'Suggestion unavailable.' }, { status: 500 });
  }
}
