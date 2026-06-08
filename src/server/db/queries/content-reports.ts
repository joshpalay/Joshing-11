import { and, eq, gte, sql } from 'drizzle-orm';

import { contentReports, db } from '@/server/db';
import { getDailyAssignmentBounds } from '@/lib/games/timezone';

// B-Report-2: write + read helpers for ContentReport. Mirrors the house style in
// ratings.ts — db + schema imports from '@/server/db', explicit field assignment,
// count(*)::int for aggregates. Suppression/author-surfacing/admin-queue are out
// of scope here (B-Report-3..5); this module only captures the report row and the
// per-day volume the flood-stop reads.

export type ContentReportCategory = 'incorrect' | 'inappropriate';
export type ContentReportIncorrectKind = 'answer_key' | 'premise';

export type InsertContentReportInput = {
  reporterUserId: string;
  // Exactly one of these is non-null (enforced by the caller's Zod schema and the
  // ContentReport_one_target CHECK). Do not coerce a generated id into questionId.
  questionId: string | null;
  generatedQuestionId: string | null;
  category: ContentReportCategory;
  // Only set when category === 'incorrect' (ContentReport_incorrect_kind_scope CHECK).
  incorrectKind: ContentReportIncorrectKind | null;
  note: string;
  suggestedAnswer: string | null;
  surface: string | null;
};

// 'duplicate' means the one-open-report partial unique index (B-Report-1) already
// has an open report from this reporter for this target. The re-report is a no-op
// the caller treats as success (idempotent), not an error.
export type InsertContentReportResult = 'inserted' | 'duplicate';

// Postgres unique_violation. The ContentReport_one_open_per_{question,generated_question}
// partial unique indexes raise this when an open report already exists.
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

export async function insertContentReport(
  input: InsertContentReportInput,
): Promise<InsertContentReportResult> {
  try {
    await db.insert(contentReports).values({
      reporterUserId: input.reporterUserId,
      questionId: input.questionId,
      generatedQuestionId: input.generatedQuestionId,
      category: input.category,
      incorrectKind: input.incorrectKind,
      note: input.note,
      suggestedAnswer: input.suggestedAnswer,
      surface: input.surface,
      status: 'open',
    });
    return 'inserted';
  } catch (err) {
    if (isUniqueViolation(err)) return 'duplicate';
    throw err;
  }
}

// Reports created in the current daily window for this reporter — the input to the
// 10/day flood-stop. Reuses getDailyAssignmentBounds() so "today" matches the rest
// of the app's daily reset rather than inventing a separate calendar boundary.
export async function countContentReportsToday(reporterUserId: string): Promise<number> {
  const { assignmentDate } = getDailyAssignmentBounds();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentReports)
    .where(
      and(
        eq(contentReports.reporterUserId, reporterUserId),
        gte(contentReports.createdAt, assignmentDate),
      ),
    );
  return row?.count ?? 0;
}
