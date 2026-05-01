import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { proposeInterests } from '@/server/llm/interests';

type ProposeInterestsBody = {
  warmupAnswers?: unknown;
};

function parseWarmupAnswers(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const answers = value
    .map((answer) => (typeof answer === 'string' ? answer.trim() : ''))
    .filter((answer) => answer.length > 0)
    .slice(0, 6);

  return answers.length > 0 ? answers : null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ProposeInterestsBody | null;
  const warmupAnswers = parseWarmupAnswers(body?.warmupAnswers);

  if (!warmupAnswers) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'warmupAnswers must include at least one answer.' },
      { status: 400 },
    );
  }

  const interests = await proposeInterests(warmupAnswers);

  return NextResponse.json({ interests });
}
