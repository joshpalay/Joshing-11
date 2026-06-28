import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { createQuestion } from '@/server/db/queries/questions';
import { MAX_BULK_UPLOAD_ROWS, parseBulkUploadCsv } from '@/server/questions/bulk-upload';

export const dynamic = 'force-dynamic';

// Upper bound on the raw payload to keep a single request bounded even before
// we count rows. ~5MB of CSV comfortably holds MAX_BULK_UPLOAD_ROWS rows.
const MAX_CSV_BYTES = 5 * 1024 * 1024;

const optionsSchema = z.object({
  // dryRun validates + reports without writing anything — lets an admin preview
  // the parse result before committing.
  dryRun: z.boolean().optional().default(false),
});

type ReadCsvResult = { csv: string; dryRun: boolean; authorId?: string } | { error: string };

function asOptionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readCsv(request: NextRequest): Promise<ReadCsvResult> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return { error: 'invalid_form' };
    const file = form.get('file');
    if (!(file instanceof File)) return { error: 'no_file' };
    if (file.size > MAX_CSV_BYTES) return { error: 'file_too_large' };
    const dryRunRaw = form.get('dryRun');
    const dryRun = dryRunRaw === 'true' || dryRunRaw === '1';
    return { csv: await file.text(), dryRun, authorId: asOptionalId(form.get('authorId')) };
  }

  // JSON fallback: { csv: string, dryRun?: boolean, authorId?: string }
  const body = (await request.json().catch(() => null)) as
    | { csv?: unknown; authorId?: unknown }
    | null;
  if (!body || typeof body.csv !== 'string') return { error: 'invalid_request' };
  if (Buffer.byteLength(body.csv, 'utf8') > MAX_CSV_BYTES) return { error: 'file_too_large' };
  const opts = optionsSchema.safeParse(body);
  return {
    csv: body.csv,
    dryRun: opts.success ? opts.data.dryRun : false,
    authorId: asOptionalId(body.authorId),
  };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  // Non-admins (and the unauthenticated) get 404 — never reveal the route exists.
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const read = await readCsv(request);
  if ('error' in read) {
    return NextResponse.json({ error: read.error }, { status: 400 });
  }

  // Author defaults to the uploader; an explicit choice must itself be an admin
  // (the picker only lists admins, but never trust the client) — otherwise an
  // admin could attribute questions to any arbitrary user id.
  const authorId = read.authorId ?? session.userId;
  if (!isAdminUser(authorId)) {
    return NextResponse.json({ error: 'invalid_author' }, { status: 400 });
  }

  const parsed = parseBulkUploadCsv(read.csv);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'parse_failed', message: parsed.error }, { status: 400 });
  }

  if (read.dryRun) {
    return NextResponse.json({
      dryRun: true,
      total: parsed.rows.length + parsed.errors.length,
      valid: parsed.rows.length,
      invalid: parsed.errors.length,
      created: 0,
      rowErrors: parsed.errors,
    });
  }

  const created: { line: number; id: string }[] = [];
  const insertErrors: { line: number; message: string }[] = [];

  // Sequential inserts: createQuestion does an embedding/dedup pass per row and
  // the DB pool is capped (max 5), so a bounded sequential loop is the safe
  // shape. MAX_BULK_UPLOAD_ROWS keeps total work in check.
  for (const row of parsed.rows) {
    try {
      const result = await createQuestion({
        authorId,
        text: row.text,
        correctAnswer: row.correctAnswer,
        alternateAnswers: row.alternateAnswers,
        explanation: row.explanation,
        category: row.category,
        broadCategory: row.broadCategory,
        subcategory: row.canonicalSubcategory,
        canonicalSubcategory: row.canonicalSubcategory,
        domain: row.canonicalSubcategory,
        difficulty: row.difficulty,
        // Admin-uploaded questions are trusted: verified + creator-written.
        verified: true,
        critiqueIterations: 0,
        visibility: 'public',
      });
      created.push({ line: row.line, id: result.id });
    } catch (error) {
      console.error('[admin/bulk-upload] row insert failed', {
        line: row.line,
        adminId: session.userId,
        message: error instanceof Error ? error.message : String(error),
      });
      insertErrors.push({
        line: row.line,
        message: error instanceof Error ? error.message : 'insert failed',
      });
    }
  }

  const rowErrors = [...parsed.errors, ...insertErrors].sort((a, b) => a.line - b.line);

  console.info('[admin/bulk-upload] complete', {
    adminId: session.userId,
    authorId,
    created: created.length,
    skipped: rowErrors.length,
  });

  return NextResponse.json({
    dryRun: false,
    total: parsed.rows.length + parsed.errors.length,
    created: created.length,
    skipped: rowErrors.length,
    createdIds: created.map((c) => c.id),
    rowErrors,
    limit: MAX_BULK_UPLOAD_ROWS,
  });
}
