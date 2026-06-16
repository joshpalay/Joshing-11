import { and, asc, desc, eq, gte, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { contentReports, db, generatedQuestions, questions, users } from '@/server/db';
import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { type QuestionSource, resolveAuthorDisplay } from '@/lib/questions-types';

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

// The generated-question equivalent of visibility='blocked': an upheld
// inappropriate report is the TERMINAL hard-block for LLM-origin content, which
// has no `visibility` column to set. Unconditional — there is no owner exception
// because generated questions carry a null creatorId. Kept DISTINCT from the
// authored blocked predicate (feed/visibility.ts) and from the reversible
// open|upheld suppression layer above: this matches only category='inappropriate'
// AND status='upheld', the irreversible state, so history/replay reads stay
// untouched by the (reversible, reporter-scoped) suppression machinery.
export function notBlockedGeneratedByContentReport(generatedIdColumn: AnyPgColumn) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.generatedQuestionId, generatedIdColumn),
          eq(contentReports.category, 'inappropriate'),
          eq(contentReports.status, 'upheld'),
        ),
      ),
  );
}

// Set form of the predicate above, for JS read paths that materialize a slot
// snapshot (archive's daily reader renders `slot.question_text` even when the
// row is filtered out of the query, so the block must be applied at the slot
// level). Of the given generated ids, returns those with an upheld-inappropriate
// report — the terminal hard-block to drop.
export async function getUpheldInappropriateGeneratedIds(
  generatedQuestionIds: string[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (generatedQuestionIds.length === 0) return blocked;

  const rows = await db
    .select({ generatedQuestionId: contentReports.generatedQuestionId })
    .from(contentReports)
    .where(
      and(
        inArray(contentReports.generatedQuestionId, generatedQuestionIds),
        eq(contentReports.category, 'inappropriate'),
        eq(contentReports.status, 'upheld'),
      ),
    );

  for (const row of rows) {
    if (row.generatedQuestionId) blocked.add(row.generatedQuestionId);
  }
  return blocked;
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

// ─── B-Report-6: blocked / actioned review + reversal ────────────────────────
//
// The review queue above shows only OPEN reports. This pair backs the
// already-removed view: list currently-blocked content and let an admin REVERSE
// a decision. Unlike getOpenReportsForReview, this list carries `source` +
// `creatorId` so the admin surface can badge a real author's question apart from
// house/LLM content. Reversal is content-only and gated by the same isAdminUser
// allowlist at the route.

export type BlockedReviewItem = {
  target: { table: 'question'; id: string } | { table: 'generated'; id: string };
  questionText: string | null;
  correctAnswer: string | null;
  // Provenance for the human-vs-house/LLM badge (the open-report query omits these).
  // Generated rows are LLM-origin by construction: source/creatorId are null.
  source: QuestionSource | null;
  creatorId: string | null;
  authorName: string | null; // null ⇒ client renders the LLM attribution
  authorIsHouse: boolean;
  // The upheld-inappropriate report behind the block. Always present for
  // generated; may be null for authored (a vet verdict or cron sweep can block
  // without a report).
  reportId: string | null;
  actionedAt: Date | null;
};

export async function getBlockedQuestionsForReview(): Promise<BlockedReviewItem[]> {
  const [authoredRows, generatedRows] = await Promise.all([
    db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        answer: questions.answerText,
        source: questions.source,
        creatorId: questions.creatorId,
        authorName: users.displayName,
      })
      .from(questions)
      .leftJoin(users, eq(questions.creatorId, users.id))
      .where(and(eq(questions.visibility, 'blocked'), isNull(questions.deletedAt))),
    db
      .select({
        id: generatedQuestions.id,
        questionText: generatedQuestions.questionText,
        answer: generatedQuestions.answer,
        reportId: contentReports.id,
        reviewedAt: contentReports.reviewedAt,
      })
      .from(generatedQuestions)
      .innerJoin(
        contentReports,
        and(
          eq(contentReports.generatedQuestionId, generatedQuestions.id),
          eq(contentReports.category, 'inappropriate'),
          eq(contentReports.status, 'upheld'),
        ),
      ),
  ]);

  // The upheld-inappropriate report behind each authored block, if any.
  const authoredIds = authoredRows.map((r) => r.id);
  const authoredReports = authoredIds.length
    ? await db
        .select({
          questionId: contentReports.questionId,
          id: contentReports.id,
          reviewedAt: contentReports.reviewedAt,
        })
        .from(contentReports)
        .where(
          and(
            inArray(contentReports.questionId, authoredIds),
            eq(contentReports.category, 'inappropriate'),
            eq(contentReports.status, 'upheld'),
          ),
        )
        .orderBy(desc(contentReports.reviewedAt))
    : [];
  const authoredReportByQuestion = new Map<string, { id: string; reviewedAt: Date | null }>();
  for (const r of authoredReports) {
    if (r.questionId && !authoredReportByQuestion.has(r.questionId)) {
      authoredReportByQuestion.set(r.questionId, { id: r.id, reviewedAt: r.reviewedAt });
    }
  }

  const items: BlockedReviewItem[] = [];

  for (const row of authoredRows) {
    const rep = authoredReportByQuestion.get(row.id) ?? null;
    items.push({
      target: { table: 'question', id: row.id },
      questionText: row.questionText,
      correctAnswer: row.answer,
      source: row.source,
      creatorId: row.creatorId,
      ...resolveAuthorDisplay(row.creatorId, row.source, row.authorName),
      reportId: rep?.id ?? null,
      actionedAt: rep?.reviewedAt ?? null,
    });
  }

  // One generated question can carry more than one upheld report; keep the most
  // recent as the representative row.
  const generatedById = new Map<
    string,
    { questionText: string; answer: string; reportId: string; reviewedAt: Date | null }
  >();
  for (const row of generatedRows) {
    const prev = generatedById.get(row.id);
    const newer =
      !prev ||
      (row.reviewedAt != null &&
        (prev.reviewedAt == null || row.reviewedAt > prev.reviewedAt));
    if (newer) {
      generatedById.set(row.id, {
        questionText: row.questionText,
        answer: row.answer,
        reportId: row.reportId,
        reviewedAt: row.reviewedAt,
      });
    }
  }
  for (const [id, g] of generatedById) {
    items.push({
      target: { table: 'generated', id },
      questionText: g.questionText,
      correctAnswer: g.answer,
      source: null,
      creatorId: null,
      authorName: null,
      authorIsHouse: false,
      reportId: g.reportId,
      actionedAt: g.reviewedAt,
    });
  }

  // Most-recently actioned first; vet/cron blocks (no report ⇒ null) sort last.
  items.sort((a, b) => (b.actionedAt?.getTime() ?? 0) - (a.actionedAt?.getTime() ?? 0));
  return items;
}

export type ReverseActionResult =
  | { ok: true; action: 'reversed'; table: 'question' | 'generated'; restoredVisibility: 'public' | null }
  | { ok: false; reason: 'not_found' | 'not_blocked' };

// Reverse a terminal block (content-only; mirrors the uphold/dismiss audit
// fields: reviewDecision='admin_reversed', reviewReason, reviewedAt).
//   - authored: visibility 'blocked' → 'public' AND dismiss the upheld
//     inappropriate report(s), so B-Report-3 suppression (open|upheld) also lifts.
//     NOTE: the pre-block visibility is not persisted anywhere (the block write
//     overwrites it), so we restore to the column default 'public'. Re-scoping to
//     a tighter audience is a manual follow-up.
//   - generated: there is no visibility column — the upheld report IS the
//     terminal state, so dismissing it reverses the block.
export async function reverseBlock(
  target: { table: 'question' | 'generated'; id: string },
  reviewReason?: string,
): Promise<ReverseActionResult> {
  const reason = reviewReason?.trim() || null;

  if (target.table === 'question') {
    const [q] = await db
      .select({ visibility: questions.visibility })
      .from(questions)
      .where(eq(questions.id, target.id))
      .limit(1);
    if (!q) return { ok: false, reason: 'not_found' };
    if (q.visibility !== 'blocked') return { ok: false, reason: 'not_blocked' };

    await db
      .update(questions)
      .set({ visibility: 'public', updatedAt: new Date() })
      .where(eq(questions.id, target.id));

    await db
      .update(contentReports)
      .set({
        status: 'dismissed',
        reviewDecision: 'admin_reversed',
        reviewReason: reason,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(contentReports.questionId, target.id),
          eq(contentReports.category, 'inappropriate'),
          eq(contentReports.status, 'upheld'),
        ),
      );

    return { ok: true, action: 'reversed', table: 'question', restoredVisibility: 'public' };
  }

  const updated = await db
    .update(contentReports)
    .set({
      status: 'dismissed',
      reviewDecision: 'admin_reversed',
      reviewReason: reason,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(contentReports.generatedQuestionId, target.id),
        eq(contentReports.category, 'inappropriate'),
        eq(contentReports.status, 'upheld'),
      ),
    )
    .returning({ id: contentReports.id });

  if (updated.length === 0) return { ok: false, reason: 'not_found' };
  return { ok: true, action: 'reversed', table: 'generated', restoredVisibility: null };
}
