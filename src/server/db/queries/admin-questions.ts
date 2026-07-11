import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

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
  // Author display-name contains-match (case-insensitive). Implies a human
  // creator (creator_id IS NOT NULL) — house/LLM rows have no person to match.
  authorSearch?: string;
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

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// ── Phase 4 mutations (admin-gated; the caller re-checks isAdminUser) ─────────
// WHY these live here rather than reusing questions.ts's updateQuestion/
// deleteQuestion: those are USER-SCOPED — they resolve the row by
// (id, creatorId=userId) and block edits on in-use rows, so they cannot serve an
// admin editing another creator's (or a house) question. editQuestionContent
// (machine-demotions.ts) is admin-safe but covers only 3 of the 6 minimal fields
// AND unconditionally clears the verification stamp (wrong for a visibility-only
// edit). So these helpers reuse the canonical MECHANICS — the soft-delete
// primitive (deletedAt) and the "content changed ⇒ re-verify" stamp-clear that
// editQuestionContent established — without reimplementing a divergent delete.

export type AdminEditQuestionInput = {
  questionText?: string;
  answerText?: string;
  acceptedAlternatives?: string[];
  factualExplanation?: string | null;
  // The "between us" aside. Flavor text, not grading-adjacent — editing it does
  // NOT clear the verification stamp (verification fact-checks the answer, not
  // the aside). Empty string normalizes to null.
  insideJoke?: string | null;
  category?: string;
  visibility?: string;
  // Re-attribution. 'house' re-sources the question to the labeled non-human
  // house author (creator_id NULL + source 'house_authored') — the same override
  // the crafter "keep" flow applies. NOT a tombstone: authorDeleted stays false
  // (a deliberate re-attribution, not an account-deletion retention). One-way in
  // this tool: the original creator link is dropped, so there is no house→person
  // reverse without a person picker.
  attribution?: 'house';
};

export type AdminMutationResult = { ok: boolean; reason?: 'not_found' | 'no_fields' };

// Edit a question as an admin. Grading-adjacent fields (question/answer/
// alternatives/explanation) trigger the same canon editQuestionContent applies:
// the verification stamp is cleared so the batch-verify sweep re-fact-checks the
// edit, trustTier records a human shaped the row, and a demoted row returns to
// circulation. category/visibility are metadata and do NOT touch the stamp.
export async function adminEditQuestion(
  id: string,
  input: AdminEditQuestionInput,
): Promise<AdminMutationResult> {
  const values: Partial<typeof questions.$inferInsert> = {};
  let contentChanged = false;

  if (input.questionText !== undefined) {
    values.questionText = input.questionText;
    contentChanged = true;
  }
  if (input.answerText !== undefined) {
    values.answerText = input.answerText;
    contentChanged = true;
  }
  if (input.acceptedAlternatives !== undefined) {
    values.acceptedAlternatives = input.acceptedAlternatives;
    contentChanged = true;
  }
  if (input.factualExplanation !== undefined) {
    values.factualExplanation = input.factualExplanation || null;
    contentChanged = true;
  }
  if (input.insideJoke !== undefined) {
    // Metadata, not content: the aside is flavor and isn't fact-checked, so it
    // does NOT flip contentChanged (the verification stamp stays put).
    values.insideJoke = input.insideJoke || null;
  }
  if (input.category !== undefined) {
    values.category = input.category as typeof questions.$inferInsert.category;
    // Mirror updateQuestion: an explicit category edit clears the override flag.
    values.categoryOverridden = false;
  }
  if (input.visibility !== undefined) {
    values.visibility = input.visibility as typeof questions.$inferInsert.visibility;
  }
  if (input.attribution === 'house') {
    // House marker: creator_id NULL + source 'house_authored' (crafter-keep
    // precedent). Not a content change — the verification stamp is untouched.
    values.creatorId = null;
    values.source = 'house_authored';
  }

  if (Object.keys(values).length === 0) return { ok: false, reason: 'no_fields' };

  // Only edit rows that still exist (deleted rows are restored first, not edited).
  const [existing] = await db
    .select({ publicStatus: questions.publicStatus })
    .from(questions)
    .where(and(eq(questions.id, id), isNull(questions.deletedAt)))
    .limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };

  if (contentChanged) {
    // Canon (editQuestionContent): the facts changed, so the old stamp no longer
    // vouches — clear it back into the sweep's dragnet and mark human-shaped.
    values.verifiedAt = null;
    values.verificationVerdict = null;
    values.verificationReason = null;
    values.trustTier = 'human_validated';
    if (existing.publicStatus === 'needs_review') values.publicStatus = 'not_scored';
  }
  values.updatedAt = new Date();

  await db.update(questions).set(values).where(eq(questions.id, id));
  return { ok: true };
}

// Bulk person → house re-attribution. Same marker the single-row attribution
// edit above applies (creator_id NULL + source 'house_authored'; authorDeleted
// stays false — a deliberate re-attribution, not a tombstone), and like it the
// verification stamp is untouched (attribution is metadata, not content). Only
// live rows that currently carry a human creator transition; deleted, house,
// and LLM rows in the selection are counted as skipped, not errors. One-way:
// the original creator link is dropped with no reverse path in this tool.
export type AdminBulkReattributeResult = { ok: true; updated: number; skipped: number };

export async function adminBulkReattributeToHouse(ids: string[]): Promise<AdminBulkReattributeResult> {
  if (ids.length === 0) return { ok: true, updated: 0, skipped: 0 };
  const updated = await db
    .update(questions)
    .set({ creatorId: null, source: 'house_authored', updatedAt: new Date() })
    .where(and(inArray(questions.id, ids), isNull(questions.deletedAt), isNotNull(questions.creatorId)))
    .returning({ id: questions.id });
  return { ok: true, updated: updated.length, skipped: ids.length - updated.length };
}

// Admin soft-delete — reuses the canonical soft-delete primitive (deletedAt),
// never a hard DELETE. No in-use guard (an admin override is deliberate). A
// no-op on an already-deleted row.
export async function adminSoftDeleteQuestion(id: string): Promise<AdminMutationResult> {
  const updated = await db
    .update(questions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(questions.id, id), isNull(questions.deletedAt)))
    .returning({ id: questions.id });
  if (updated.length === 0) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// Admin restore — the inverse of the soft-delete (deletedAt back to NULL). Since
// delete is soft, restore must exist. A no-op on a row that isn't deleted.
export async function adminRestoreQuestion(id: string): Promise<AdminMutationResult> {
  const updated = await db
    .update(questions)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(questions.id, id), isNotNull(questions.deletedAt)))
    .returning({ id: questions.id });
  if (updated.length === 0) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// The full read-only record for the Phase 3 detail view. Every non-embedding
// Question column is inspectable here (the 1024-dim vector is deliberately
// omitted — it is not human-inspectable and would bloat the payload). Same H-1
// author guard as the list row.
export type AdminQuestionDetail = {
  id: string;
  authorLabel: string;
  authorIsPerson: boolean;
  creatorId: string | null;
  generatedQuestionId: string | null;
  source: string;
  sourceQuestionId: string | null;
  sourceCreatorId: string | null;
  suppressedBy: string | null;
  subjectEntity: string | null;
  categorizeProvider: string | null;
  questionText: string;
  answerText: string;
  acceptedAlternatives: string[];
  factualExplanation: string | null;
  breadcrumbContext: string | null;
  creatorNote: string | null;
  insideJoke: string | null;
  shortLabel: string | null;
  llmSuggestedAnswer: string | null;
  answerSource: string | null;
  questionType: string;
  minimumRequired: number | null;
  category: string;
  broadCategory: string | null;
  subcategory: string | null;
  canonicalSubcategory: string | null;
  categoryOverridden: boolean;
  difficultyEstimate: string | null;
  llmDifficulty: string | null;
  calibratedDifficulty: string | null;
  explainerBrief: string | null;
  explainerFull: string | null;
  explainerBriefCorrect: string | null;
  explainerFullCorrect: string | null;
  explainerBriefWrong: string | null;
  explainerFullWrong: string | null;
  explainerBriefExpired: string | null;
  explainerFullExpired: string | null;
  status: string;
  verified: boolean;
  critiqueIterations: number;
  visibility: string;
  publicStatus: string;
  publicEligibilityScore: number | null;
  publicEligibilityReason: string | null;
  sharedToFriendsFeed: boolean;
  askedCount: number;
  correctCount: number;
  correctRate: number | null;
  surfacePriorityScore: number;
  trustTier: string;
  perishable: boolean;
  sourceRefs: string[];
  nobodyCorrectFlag: boolean;
  isDuplicate: boolean;
  authorDeleted: boolean;
  verificationVerdict: string | null;
  verificationReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  verifiedAt: string | null;
};

// Full-record fetch for the detail view. Unscoped by design (admin audit) and
// does NOT filter deletedAt — a deleted row must still be inspectable from the
// show-deleted list. The gate is the isAdminUser check on the calling route.
export async function getAdminQuestionDetail(id: string): Promise<AdminQuestionDetail | null> {
  const [row] = await db
    .select({
      q: questions,
      authorDisplayName: users.displayName,
    })
    .from(questions)
    .leftJoin(users, eq(users.id, questions.creatorId))
    .where(eq(questions.id, id))
    .limit(1);

  if (!row) return null;
  const q = row.q;

  const resolved = resolveAuthorDisplay(q.creatorId, parseQuestionSource(q.source), row.authorDisplayName);
  const isPerson = resolved.authorName !== null && !resolved.authorIsHouse && !q.authorDeleted;

  return {
    id: q.id,
    authorLabel: isPerson ? (resolved.authorName as string) : HOUSE_LABEL,
    authorIsPerson: isPerson,
    creatorId: q.creatorId,
    generatedQuestionId: q.generatedQuestionId,
    source: q.source,
    sourceQuestionId: q.sourceQuestionId,
    sourceCreatorId: q.sourceCreatorId,
    suppressedBy: q.suppressedBy,
    subjectEntity: q.subjectEntity,
    categorizeProvider: q.categorizeProvider,
    questionText: q.questionText,
    answerText: q.answerText,
    acceptedAlternatives: q.acceptedAlternatives ?? [],
    factualExplanation: q.factualExplanation,
    breadcrumbContext: q.breadcrumbContext,
    creatorNote: q.creatorNote,
    insideJoke: q.insideJoke,
    shortLabel: q.shortLabel,
    llmSuggestedAnswer: q.llmSuggestedAnswer,
    answerSource: q.answerSource,
    questionType: q.questionType,
    minimumRequired: q.minimumRequired,
    category: q.category,
    broadCategory: q.broadCategory,
    subcategory: q.subcategory,
    canonicalSubcategory: q.canonicalSubcategory,
    categoryOverridden: q.categoryOverridden,
    difficultyEstimate: q.difficultyEstimate,
    llmDifficulty: q.llmDifficulty,
    calibratedDifficulty: q.calibratedDifficulty,
    explainerBrief: q.explainerBrief,
    explainerFull: q.explainerFull,
    explainerBriefCorrect: q.explainerBriefCorrect,
    explainerFullCorrect: q.explainerFullCorrect,
    explainerBriefWrong: q.explainerBriefWrong,
    explainerFullWrong: q.explainerFullWrong,
    explainerBriefExpired: q.explainerBriefExpired,
    explainerFullExpired: q.explainerFullExpired,
    status: q.status,
    verified: q.verified,
    critiqueIterations: q.critiqueIterations,
    visibility: q.visibility,
    publicStatus: q.publicStatus,
    publicEligibilityScore: q.publicEligibilityScore,
    publicEligibilityReason: q.publicEligibilityReason,
    sharedToFriendsFeed: q.sharedToFriendsFeed,
    askedCount: q.askedCount,
    correctCount: q.correctCount,
    correctRate: q.correctRate,
    surfacePriorityScore: q.surfacePriorityScore,
    trustTier: q.trustTier,
    perishable: q.perishable,
    sourceRefs: q.sourceRefs ?? [],
    nobodyCorrectFlag: q.nobodyCorrectFlag,
    isDuplicate: q.isDuplicate,
    authorDeleted: q.authorDeleted,
    verificationVerdict: q.verificationVerdict,
    verificationReason: q.verificationReason,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    deletedAt: isoOrNull(q.deletedAt),
    verifiedAt: isoOrNull(q.verifiedAt),
  };
}

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
  if (f.authorSearch) {
    // Requires the users join both queries in getAllQuestionsForAdmin carry.
    clauses.push(isNotNull(questions.creatorId));
    clauses.push(ilike(users.displayName, `%${f.authorSearch}%`));
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
      // Same join as the page query so authorSearch can reference users.
      // users.id is unique, so a left join never multiplies the count.
      .leftJoin(users, eq(users.id, questions.creatorId))
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
