import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import { db, questions, users } from '@/server/db';
import { resolveAuthorDisplay, parseQuestionSource } from '@/lib/questions-types';

// B-ADMIN-QUESTIONS-OVERVIEW-01 — the admin-only "what's actually in the pool"
// audit surface. UNLIKE every player-facing read path, this query is deliberately
// unscoped: ALL creators, house + LLM rows, AND soft-deleted rows. The only gate
// is the isAdminUser check on the calling route/action — never call this from a
// player surface.

// Sort keys the admin table exposes. Whitelisted so a client-supplied value can
// never reach the ORDER BY as raw SQL (the map below is the trust boundary).
export type AdminQuestionSortKey = 'createdAt' | 'askedCount' | 'correctRate' | 'category';
export type AdminQuestionSortDir = 'asc' | 'desc';

const SORT_COLUMNS = {
  createdAt: questions.createdAt,
  askedCount: questions.askedCount,
  correctRate: questions.correctRate,
  category: questions.category,
} as const;

export type AdminQuestionFilters = {
  // Free text — matches question_text OR answer_text (case-insensitive contains).
  search?: string;
  category?: string;
  trustTier?: string;
  visibility?: string;
  verificationVerdict?: string;
  // Boolean flag filters — when set to true, narrow to rows where the flag holds.
  // Omitted / false ⇒ no narrowing on that flag (they are includes, not toggles).
  nobodyCorrectFlag?: boolean;
  isDuplicate?: boolean;
  authorDeleted?: boolean;
  perishable?: boolean;
};

export type AdminQuestionsQuery = {
  page?: number;
  pageSize?: number;
  // Whether to INCLUDE soft-deleted rows. Defaults false (deleted hidden) — the
  // client's show-deleted toggle flips this. Canon: deleted rows are never
  // silently dropped from the audit, only hidden behind the toggle.
  showDeleted?: boolean;
  sortKey?: AdminQuestionSortKey;
  sortDir?: AdminQuestionSortDir;
  filters?: AdminQuestionFilters;
};

// The row the admin table renders. `authorLabel`/`authorIsPerson` are resolved
// server-side through resolveAuthorDisplay so the client never re-derives person
// vs house from raw provenance (Invariant H-1: house/tombstone rows must NEVER
// render as a person). A null creator, a house row, an LLM row, or an
// author-deleted tombstone all resolve to the neutral "House" label.
export type AdminQuestionRow = {
  id: string;
  questionText: string;
  answerText: string;
  category: string;
  broadCategory: string | null;
  authorLabel: string;
  authorIsPerson: boolean;
  creatorId: string | null;
  source: string;
  trustTier: string;
  visibility: string;
  publicStatus: string;
  verificationVerdict: string | null;
  askedCount: number;
  correctCount: number;
  correctRate: number | null;
  nobodyCorrectFlag: boolean;
  isDuplicate: boolean;
  perishable: boolean;
  authorDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AdminQuestionsPage = {
  rows: AdminQuestionRow[];
  total: number;
  page: number;
  pageSize: number;
  showDeleted: boolean;
};

const HOUSE_LABEL = 'House';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function buildWhere(query: AdminQuestionsQuery): SQL | undefined {
  const clauses: SQL[] = [];

  // Soft-deleted rows are hidden unless explicitly requested.
  if (!query.showDeleted) clauses.push(isNull(questions.deletedAt));

  const f = query.filters ?? {};
  if (f.search) {
    const needle = `%${f.search}%`;
    const match = or(ilike(questions.questionText, needle), ilike(questions.answerText, needle));
    if (match) clauses.push(match);
  }
  if (f.category) clauses.push(eq(questions.category, f.category as typeof questions.$inferSelect.category));
  if (f.trustTier) clauses.push(eq(questions.trustTier, f.trustTier as typeof questions.$inferSelect.trustTier));
  if (f.visibility) clauses.push(eq(questions.visibility, f.visibility as typeof questions.$inferSelect.visibility));
  if (f.verificationVerdict) {
    clauses.push(eq(questions.verificationVerdict, f.verificationVerdict as NonNullable<typeof questions.$inferSelect.verificationVerdict>));
  }
  if (f.nobodyCorrectFlag) clauses.push(eq(questions.nobodyCorrectFlag, true));
  if (f.isDuplicate) clauses.push(eq(questions.isDuplicate, true));
  if (f.authorDeleted) clauses.push(eq(questions.authorDeleted, true));
  if (f.perishable) clauses.push(eq(questions.perishable, true));

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}

export async function getAllQuestionsForAdmin(query: AdminQuestionsQuery = {}): Promise<AdminQuestionsPage> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.max(1, Math.min(Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE));
  const showDeleted = query.showDeleted ?? false;

  const where = buildWhere({ ...query, showDeleted });

  const sortColumn = SORT_COLUMNS[query.sortKey ?? 'createdAt'];
  const orderBy = (query.sortDir ?? 'desc') === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const [rows, [{ count } = { count: 0 }]] = await Promise.all([
    db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        answerText: questions.answerText,
        category: questions.category,
        broadCategory: questions.broadCategory,
        creatorId: questions.creatorId,
        source: questions.source,
        authorDisplayName: users.displayName,
        trustTier: questions.trustTier,
        visibility: questions.visibility,
        publicStatus: questions.publicStatus,
        verificationVerdict: questions.verificationVerdict,
        askedCount: questions.askedCount,
        correctCount: questions.correctCount,
        correctRate: questions.correctRate,
        nobodyCorrectFlag: questions.nobodyCorrectFlag,
        isDuplicate: questions.isDuplicate,
        perishable: questions.perishable,
        authorDeleted: questions.authorDeleted,
        createdAt: questions.createdAt,
        updatedAt: questions.updatedAt,
        deletedAt: questions.deletedAt,
      })
      .from(questions)
      .leftJoin(users, eq(users.id, questions.creatorId))
      .where(where)
      .orderBy(orderBy, desc(questions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(questions)
      .where(where),
  ]);

  return {
    rows: rows.map((row) => {
      // Tombstones re-source to the house identity (creator_id NULL), so
      // resolveAuthorDisplay already routes them to house/non-person. The
      // explicit authorDeleted guard is belt-and-suspenders: even a mis-recorded
      // tombstone that still carries a creator_id must never render as a person.
      const resolved = resolveAuthorDisplay(row.creatorId, parseQuestionSource(row.source), row.authorDisplayName);
      const isPerson = resolved.authorName !== null && !resolved.authorIsHouse && !row.authorDeleted;
      return {
        id: row.id,
        questionText: row.questionText,
        answerText: row.answerText,
        category: row.category,
        broadCategory: row.broadCategory,
        authorLabel: isPerson ? (resolved.authorName as string) : HOUSE_LABEL,
        authorIsPerson: isPerson,
        creatorId: row.creatorId,
        source: row.source,
        trustTier: row.trustTier,
        visibility: row.visibility,
        publicStatus: row.publicStatus,
        verificationVerdict: row.verificationVerdict,
        askedCount: row.askedCount,
        correctCount: row.correctCount,
        correctRate: row.correctRate,
        nobodyCorrectFlag: row.nobodyCorrectFlag,
        isDuplicate: row.isDuplicate,
        perishable: row.perishable,
        authorDeleted: row.authorDeleted,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      };
    }),
    total: Number(count ?? 0),
    page,
    pageSize,
    showDeleted,
  };
}
