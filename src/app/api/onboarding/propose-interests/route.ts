import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { proposeInterests, type WarmupAnswers } from '@/server/llm/interests';

type ProposeInterestsBody = {
  warmupAnswers?: unknown;
};

const WARMUP_FIELDS = [
  'reReadBook',
  'musicianOrComposer',
  'hourLongTopic',
  'studied',
  'filmOrShow',
  'anythingElse',
] as const satisfies ReadonlyArray<keyof WarmupAnswers>;

function parseWarmupAnswers(value: unknown): WarmupAnswers | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const answers: WarmupAnswers = {};
  let nonEmptyCount = 0;

  for (const field of WARMUP_FIELDS) {
    const raw = record[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') return null;

    const answer = raw.trim().replace(/\s+/g, ' ');
    if (answer.length > 200) return null;
    if (answer.length > 0) {
      answers[field] = answer;
      nonEmptyCount += 1;
    }
  }

  return nonEmptyCount >= 2 ? answers : null;
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
      { error: 'invalid_request', message: 'Answer at least 2 warm-up questions, 200 characters max each.' },
      { status: 400 },
    );
  }

  try {
    const proposedInterests = await proposeInterests(warmupAnswers);
    return NextResponse.json({ proposedInterests });
  } catch {
    return NextResponse.json(
      { error: "We couldn't generate suggestions. Please try again." },
      { status: 500 },
    );
  }
}
