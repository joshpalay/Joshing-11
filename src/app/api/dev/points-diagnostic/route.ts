import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  CATEGORY_VALUES,
  DIFFICULTY_VALUES,
  MAX_LIMIT,
  SOURCE_TYPE_VALUES,
  loadPointsDiagnostic,
  resolveUserByQuery,
  summarize,
  type PointsDiagnosticRow,
} from '@/server/db/queries/points-diagnostic';

export const dynamic = 'force-dynamic';

export function isDevDiagnosticEnabled(): boolean {
  if (process.env.FEED_DEBUG_ENABLED === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  // Vercel preview deploys run with NODE_ENV='production' but VERCEL_ENV='preview'.
  return process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== 'production';
}

const querySchema = z.object({
  user: z.string().trim().min(1).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  difficulty: z.enum(DIFFICULTY_VALUES).optional(),
  sourceType: z.enum(SOURCE_TYPE_VALUES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_COLUMNS: Array<{ key: keyof PointsDiagnosticRow; label: string }> = [
  { key: 'createdAt', label: 'created_at' },
  { key: 'sourceType', label: 'source_type' },
  { key: 'answerState', label: 'answer_state' },
  { key: 'sessionContext', label: 'session_context' },
  { key: 'questionId', label: 'question_id' },
  { key: 'questionTextSnippet', label: 'question_text' },
  { key: 'category', label: 'category' },
  { key: 'broadCategory', label: 'broad_category' },
  { key: 'canonicalSubcategory', label: 'question_canonical_subcategory' },
  { key: 'eventCanonicalSubcategory', label: 'event_canonical_subcategory' },
  { key: 'difficulty', label: 'difficulty' },
  { key: 'correctRate', label: 'correct_rate' },
  { key: 'basePoints', label: 'base_points' },
  { key: 'weight', label: 'weight' },
  { key: 'awardedPoints', label: 'awarded_points' },
  { key: 'answeredByUserId', label: 'answered_by_user_id' },
  { key: 'answeredByDisplayName', label: 'answered_by_display_name' },
  { key: 'masteryEventId', label: 'mastery_event_id' },
];

function rowsToCsv(rows: PointsDiagnosticRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.label)).join(',');
  const body = rows
    .map((row) => CSV_COLUMNS.map((c) => csvEscape(row[c.key])).join(','))
    .join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isDevDiagnosticEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params', issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;

  if (!q.user) {
    return NextResponse.json({ error: 'missing_user' }, { status: 400 });
  }

  const resolution = await resolveUserByQuery(q.user);
  if (!resolution.match) {
    return NextResponse.json(
      { error: 'user_not_found', nearMatches: resolution.nearMatches },
      { status: 404 },
    );
  }

  const rows = await loadPointsDiagnostic(resolution.match.id, {
    category: q.category,
    difficulty: q.difficulty,
    sourceType: q.sourceType,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    limit: q.limit,
  });

  if (q.format === 'csv') {
    const filename = `points-diagnostic-${resolution.match.id}.csv`;
    return new NextResponse(rowsToCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    user: resolution.match,
    summary: summarize(rows),
    rows,
  });
}
