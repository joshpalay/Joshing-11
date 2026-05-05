import { NextResponse } from 'next/server';

import { VALID_ISO_CODES } from '@/lib/onboarding/countries';
import { getSession } from '@/server/auth/session';
import { updateUser } from '@/server/db/queries/users';
import { proposeInterests, type CulturalAnchor, type WarmupAnswers } from '@/server/llm/interests';

type ProposeInterestsBody = {
  warmupAnswers?: unknown;
  culturalAnchor?: unknown;
};

const WARMUP_FIELDS = [
  'deepDive',
  'hourLongTopic',
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

function parseCulturalAnchor(value: unknown): CulturalAnchor | null | 'invalid' {
  if (!value) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'invalid';

  const record = value as Record<string, unknown>;

  const birthYearRaw = record.birthYear;
  if (birthYearRaw === undefined || birthYearRaw === null) return 'invalid';
  if (typeof birthYearRaw !== 'number' || !Number.isInteger(birthYearRaw)) return 'invalid';
  const currentYear = new Date().getFullYear();
  if (birthYearRaw < 1920 || birthYearRaw > currentYear - 13) return 'invalid';

  const grewUpCountryRaw = record.grewUpCountry;
  if (typeof grewUpCountryRaw !== 'string') return 'invalid';
  const grewUpCountry = grewUpCountryRaw.trim().toUpperCase();
  if (!VALID_ISO_CODES.has(grewUpCountry) && grewUpCountry !== 'OTHER') return 'invalid';

  const grewUpRegionRaw = record.grewUpRegion;
  let grewUpRegion: string | undefined;
  if (grewUpRegionRaw !== undefined && grewUpRegionRaw !== null) {
    if (typeof grewUpRegionRaw !== 'string') return 'invalid';
    const trimmed = grewUpRegionRaw.trim();
    if (trimmed.length > 100) return 'invalid';
    if (trimmed.length > 0) grewUpRegion = trimmed;
  }

  return {
    birthYear: birthYearRaw,
    grewUpCountry,
    grewUpRegion,
  };
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

  const culturalAnchorResult = parseCulturalAnchor(body?.culturalAnchor);
  if (culturalAnchorResult === 'invalid') {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Invalid cultural anchor: birthYear must be between 1920 and current year minus 13, grewUpCountry must be a valid ISO 3166-1 alpha-2 code, grewUpRegion max 100 chars.' },
      { status: 400 },
    );
  }
  const culturalAnchor = culturalAnchorResult ?? undefined;

  if (culturalAnchor) {
    await updateUser(session.userId, {
      birthYear: culturalAnchor.birthYear,
      grewUpCountry: culturalAnchor.grewUpCountry,
      grewUpRegion: culturalAnchor.grewUpRegion ?? null,
    });
  }

  try {
    const proposedInterests = await proposeInterests({ warmupAnswers, culturalAnchor });
    return NextResponse.json({ proposedInterests });
  } catch {
    return NextResponse.json(
      { error: "We couldn't generate suggestions. Please try again." },
      { status: 500 },
    );
  }
}
