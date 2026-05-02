import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import {
  getArchiveFacetsForUser,
  getArchiveForUser,
  type ArchiveResultFilter,
  type ArchiveSource,
} from '@/server/db/queries/archive';

export const dynamic = 'force-dynamic';

const SOURCES = new Set<ArchiveSource>(['daily', 'feed', 'joshing_game', 'sent_to_me', 'written_by_me']);
const RESULTS = new Set<ArchiveResultFilter>(['correct', 'incorrect', 'skipped']);

function parseSource(value: string | null): ArchiveSource | undefined {
  return value && SOURCES.has(value as ArchiveSource) ? value as ArchiveSource : undefined;
}

function parseResult(value: string | null): ArchiveResultFilter | undefined {
  return value && RESULTS.has(value as ArchiveResultFilter) ? value as ArchiveResultFilter : undefined;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const source = parseSource(params.get('source'));
  const result = parseResult(params.get('result'));
  const domain = params.get('domain')?.trim() || undefined;
  const limit = parseLimit(params.get('limit'));
  const cursor = params.get('cursor') ?? undefined;

  const [archive, facets] = await Promise.all([
    getArchiveForUser({
      userId: session.userId,
      source,
      domain,
      result,
      limit,
      cursor,
    }),
    getArchiveFacetsForUser({
      userId: session.userId,
      source,
      domain,
      result,
    }),
  ]);

  return NextResponse.json({ ...archive, ...facets });
}
