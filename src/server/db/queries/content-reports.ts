import { and, asc, desc, eq, gte, inArray, ne, notExists, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { contentReports, db, generatedQuestions, questions, users } from '@/server/db';
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

// ─── B-Report-3: suppression ────────────────────────────────────────────────
//
// A question is "suppressed" while it has an open OR upheld report from anyone —
// it stops entering NEW surfaces (daily queues, feed propagation, sends). This is
// the reversible, pre-review layer: a `dismissed` report does NOT suppress, so a
// resolution that clears the report automatically lifts suppression. (The terminal
// hard-block — visibility='blocked' on upheld-offensive — is admin action in
// B-Report-5 and is intentionally separate.) Existing copies on other players are
// never touched; these helpers only gate entry into new surfaces.

const SUPPRESSING_STATUSES = ['open', 'upheld'] as const;

// A correlated NOT EXISTS predicate for SQL selection paths, mirroring the
// `exists` style of questionVisibilityPredicate. Pass the candidate table's id
// column and which ContentReport FK targets it. Add it to an existing `and(...)`
// where-clause so suppressed rows are never drawn into a new queue.
export function notSuppressedByContentReport(
  targetIdColumn: AnyPgColumn,
  kind: 'question' | 'generated',
) {
  const reportColumn =
    kind === 'question' ? contentReports.questionId : contentReports.generatedQuestionId;
  return notExists(
    db
      .select({ one: sql`1` })
      .from(contentReports)
      .where(
        and(
          eq(reportColumn, targetIdColumn),
          inArray(contentReports.status, [...SUPPRESSING_STATUSES]),
        ),
      ),
  );
}

// Runtime check for JS paths (feed propagation, direct send) where we hold a raw
// id whose table may be either. Matches the id against both FK columns so a report
// on a GeneratedQuestion still blocks a send that would mint it into a curated
// Question.
export async function isQuestionReportSuppressed(targetId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contentReports.id })
    .from(contentReports)
    .where(
      and(
        or(
          eq(contentReports.questionId, targetId),
          eq(contentReports.generatedQuestionId, targetId),
        ),
        inArray(contentReports.status, [...SUPPRESSING_STATUSES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// Durable self-hide (inappropriate only). Of the given candidate ids, returns the
// subset the viewer has personally reported as inappropriate and that is still
// open|upheld — so their recap / Lately render can drop those cards on refresh by
// reading the existing ContentReport row (no new state). Incorrect reports never
// self-hide.
export async function getViewerHiddenQuestionIds(
  viewerUserId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (candidateIds.length === 0) return hidden;

  const rows = await db
    .select({
      questionId: contentReports.questionId,
      generatedQuestionId: contentReports.generatedQuestionId,
    })
    .from(contentReports)
    .where(
      and(
        eq(contentReports.reporterUserId, viewerUserId),
        eq(contentReports.category, 'inappropriate'),
        inArray(contentReports.status, [...SUPPRESSING_STATUSES]),
        or(
          inArray(contentReports.questionId, candidateIds),
          inArray(contentReports.generatedQuestionId, candidateIds),
        ),
      ),
    );

  const candidateSet = new Set(candidateIds);
  for (const row of rows) {
    if (row.questionId && candidateSet.has(row.questionId)) hidden.add(row.questionId);
    if (row.generatedQuestionId && candidateSet.has(row.generatedQuestionId)) {
      hidden.add(row.generatedQuestionId);
    }
  }
  return hidden;
}

// ─── B-Report-4: author-facing state ────────────────────────────────────────
//
// The author of a curated Question can see report state on their own bank rows,
// per the rule "a correction reaches the author immediately; an accusation only
// after a human validates it":
//   * open incorrect       → quiet "needs attention" (the note, never the reporter)
//   * upheld inappropriate → read-only "this was removed" + category
//   * open/dismissed inappropriate → invisible to the author
// HOUSE/machine content is NEVER author-facing: every read below joins Question
// and filters `creator_id = author AND source <> 'house_authored'`, so a house
// question can never surface an author-facing state (the load-bearing honesty
// guard, enforced server-side).

export type AuthorIncorrectReport = {
  questionId: string;
  note: string;
  incorrectKind: ContentReportIncorrectKind | null;
  suggestedAnswer: string | null;
};

// Reporter identity is intentionally NOT selected here — the author must never see
// who reported. Returns the most recent active (open|upheld) incorrect report per
// question. Upheld is included so an admin upholding "this answer is wrong" leaves
// the author's "needs attention" in place until they fix it (B-Report-5 §6.4).
export async function getActiveIncorrectReportsForAuthor(
  authorUserId: string,
  questionIds: string[],
): Promise<Map<string, AuthorIncorrectReport>> {
  const byQuestion = new Map<string, AuthorIncorrectReport>();
  if (questionIds.length === 0) return byQuestion;

  const rows = await db
    .select({
      questionId: contentReports.questionId,
      note: contentReports.note,
      incorrectKind: contentReports.incorrectKind,
      suggestedAnswer: contentReports.suggestedAnswer,
    })
    .from(contentReports)
    .innerJoin(questions, eq(contentReports.questionId, questions.id))
    .where(
      and(
        inArray(contentReports.questionId, questionIds),
        eq(contentReports.category, 'incorrect'),
        inArray(contentReports.status, ['open', 'upheld']),
        eq(questions.creatorId, authorUserId),
        ne(questions.source, 'house_authored'),
      ),
    )
    .orderBy(desc(contentReports.createdAt));

  for (const row of rows) {
    if (!row.questionId || byQuestion.has(row.questionId)) continue; // most recent wins
    byQuestion.set(row.questionId, {
      questionId: row.questionId,
      note: row.note,
      incorrectKind: row.incorrectKind,
      suggestedAnswer: row.suggestedAnswer,
    });
  }
  return byQuestion;
}

// Upheld inappropriate only — an accusation reaches the author solely after a human
// validates it. open/dismissed inappropriate are never read, so they stay invisible.
export async function getUpheldInappropriateForAuthor(
  authorUserId: string,
  questionIds: string[],
): Promise<Set<string>> {
  const removed = new Set<string>();
  if (questionIds.length === 0) return removed;

  const rows = await db
    .select({ questionId: contentReports.questionId })
    .from(contentReports)
    .innerJoin(questions, eq(contentReports.questionId, questions.id))
    .where(
      and(
        inArray(contentReports.questionId, questionIds),
        eq(contentReports.category, 'inappropriate'),
        eq(contentReports.status, 'upheld'),
        eq(questions.creatorId, authorUserId),
        ne(questions.source, 'house_authored'),
      ),
    );

  for (const row of rows) {
    if (row.questionId) removed.add(row.questionId);
  }
  return removed;
}

// B-Report-4 / B-Report-3 bridge: an author fixing the answer key resolves their
// active incorrect reports (open OR upheld — an admin-upheld "wrong answer" is also
// cleared by the fix). status → 'dismissed' lifts B-Report-3 suppression (which reads
// open|upheld); reviewDecision='author_edited' distinguishes this from a moderator
// dismissal. Returns the number of reports resolved.
export async function resolveActiveIncorrectReportsForQuestion(questionId: string): Promise<number> {
  const updated = await db
    .update(contentReports)
    .set({
      status: 'dismissed',
      reviewDecision: 'author_edited',
      reviewReason: 'Author edited the answer key',
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(contentReports.questionId, questionId),
        eq(contentReports.category, 'incorrect'),
        inArray(contentReports.status, ['open', 'upheld']),
      ),
    )
    .returning({ id: contentReports.id });
  return updated.length;
}

// ─── B-Report-5: admin review queue ─────────────────────────────────────────
//
// Admin-only (ADMIN_USER_IDS allowlist, enforced at the route/page). The review list
// is the ONLY place reporter identity is exposed. Uphold/dismiss are the only two
// actions. Uphold-inappropriate on an authored question is the ONLY place
// visibility='blocked' is set; for a generated question the upheld report itself is
// the terminal suppression (B-Report-3 reads open|upheld), so no column is written.

export type AdminReviewReport = {
  id: string;
  category: ContentReportCategory;
  incorrectKind: ContentReportIncorrectKind | null;
  note: string;
  suggestedAnswer: string | null;
  surface: string | null;
  createdAt: Date;
  target: { table: 'question' | 'generated'; id: string };
  questionText: string | null;
  correctAnswer: string | null;
  // Admin-only — never exposed on any author/player surface.
  reporterUserId: string;
  reporterName: string | null;
};

// Open reports for review: inappropriate (high-priority) first, then oldest-first.
export async function getOpenReportsForReview(): Promise<AdminReviewReport[]> {
  const rows = await db
    .select({
      id: contentReports.id,
      category: contentReports.category,
      incorrectKind: contentReports.incorrectKind,
      note: contentReports.note,
      suggestedAnswer: contentReports.suggestedAnswer,
      surface: contentReports.surface,
      createdAt: contentReports.createdAt,
      questionId: contentReports.questionId,
      generatedQuestionId: contentReports.generatedQuestionId,
      questionText: questions.questionText,
      questionAnswer: questions.answerText,
      generatedText: generatedQuestions.questionText,
      generatedAnswer: generatedQuestions.answer,
      reporterUserId: contentReports.reporterUserId,
      reporterName: users.displayName,
    })
    .from(contentReports)
    .leftJoin(questions, eq(contentReports.questionId, questions.id))
    .leftJoin(generatedQuestions, eq(contentReports.generatedQuestionId, generatedQuestions.id))
    .leftJoin(users, eq(contentReports.reporterUserId, users.id))
    .where(eq(contentReports.status, 'open'))
    .orderBy(
      desc(sql`(${contentReports.category} = 'inappropriate')`),
      asc(contentReports.createdAt),
    );

  return rows.map((row) => {
    const isGenerated = row.generatedQuestionId != null;
    return {
      id: row.id,
      category: row.category,
      incorrectKind: row.incorrectKind,
      note: row.note,
      suggestedAnswer: row.suggestedAnswer,
      surface: row.surface,
      createdAt: row.createdAt,
      target: isGenerated
        ? { table: 'generated' as const, id: row.generatedQuestionId! }
        : { table: 'question' as const, id: row.questionId! },
      questionText: isGenerated ? row.generatedText : row.questionText,
      correctAnswer: isGenerated ? row.generatedAnswer : row.questionAnswer,
      reporterUserId: row.reporterUserId,
      reporterName: row.reporterName,
    };
  });
}

export type AdminActionResult =
  | { ok: true; action: 'upheld' | 'dismissed'; category: ContentReportCategory; hardRemoved: boolean }
  | { ok: false; reason: 'not_found' | 'already_resolved' };

// Uphold: status='upheld'. For inappropriate, hard-remove — authored →
// visibility='blocked' (the ONLY place set); generated → the upheld report is itself
// terminal (no column write). Incorrect uphold marks it actioned and leaves the
// author's "needs attention" for them to clear by editing the key (B-Report-4).
export async function upholdReport(reportId: string, reviewReason?: string): Promise<AdminActionResult> {
  const [report] = await db
    .select({
      category: contentReports.category,
      questionId: contentReports.questionId,
      generatedQuestionId: contentReports.generatedQuestionId,
      status: contentReports.status,
    })
    .from(contentReports)
    .where(eq(contentReports.id, reportId))
    .limit(1);

  if (!report) return { ok: false, reason: 'not_found' };
  if (report.status !== 'open') return { ok: false, reason: 'already_resolved' };

  await db
    .update(contentReports)
    .set({
      status: 'upheld',
      reviewDecision: 'admin_upheld',
      reviewReason: reviewReason?.trim() || null,
      reviewedAt: new Date(),
    })
    .where(and(eq(contentReports.id, reportId), eq(contentReports.status, 'open')));

  let hardRemoved = false;
  if (report.category === 'inappropriate' && report.questionId) {
    // One of three visibility='blocked' writes (with the create route's
    // safety-fail vet and the vet-questions cron sweep). Excluded by
    // feedItemVisibilityPredicate — including for direct_sent recipients —
    // and every bank/send/game read path.
    await db.update(questions).set({ visibility: 'blocked' }).where(eq(questions.id, report.questionId));
    hardRemoved = true;
  } else if (report.category === 'inappropriate' && report.generatedQuestionId) {
    // Generated has no terminal column; the upheld report is the terminal state
    // (B-Report-3 suppression reads open|upheld). Nothing else to write.
    hardRemoved = true;
  }

  return { ok: true, action: 'upheld', category: report.category, hardRemoved };
}

// Dismiss: status='dismissed'. Lifts B-Report-3 suppression automatically (predicate
// is open|upheld); for inappropriate, the author never learns it happened.
export async function dismissReport(reportId: string, reviewReason?: string): Promise<AdminActionResult> {
  const [report] = await db
    .select({ category: contentReports.category, status: contentReports.status })
    .from(contentReports)
    .where(eq(contentReports.id, reportId))
    .limit(1);

  if (!report) return { ok: false, reason: 'not_found' };
  if (report.status !== 'open') return { ok: false, reason: 'already_resolved' };

  await db
    .update(contentReports)
    .set({
      status: 'dismissed',
      reviewDecision: 'admin_dismissed',
      reviewReason: reviewReason?.trim() || null,
      reviewedAt: new Date(),
    })
    .where(and(eq(contentReports.id, reportId), eq(contentReports.status, 'open')));

  return { ok: true, action: 'dismissed', category: report.category, hardRemoved: false };
}
