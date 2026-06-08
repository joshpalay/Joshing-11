import { and, cosineDistance, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { generatedQuestions, questions } from '@/server/db/schema';

// B1 pool substrate — unified selection layer (PRD-D-5 §5.1 / §8).
//
// The machine bank (GeneratedQuestion) and the human-authored questions
// (Question) stay as separate tables; this layer is the seam that treats them as
// ONE pool — normalizing both into a single shape and exposing trust_tier / scope
// as optional filters.
//
// DRIFT GUARD (B1): this is *capability only*. Nothing here is wired into a live
// surface, and the default filter reproduces today's served set — all trust
// tiers, suppressed rows excluded, soft-deleted human rows excluded. Live
// trust-tier gating is B4's job. Existing callers (pickBankSource,
// pickEligibleAuthoredQuestions, pickHouseQuestions) are untouched.

export type PoolOrigin = 'machine' | 'human';
export type TrustTier = 'unverified' | 'machine_verified' | 'human_validated' | 'author_confirmed';
export type PoolScope = 'private' | 'friends_only' | 'public';

export interface PooledQuestion {
  id: string;
  origin: PoolOrigin;
  questionText: string;
  answer: string;
  explainer: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  difficultyEstimate: string | null;
  trustTier: TrustTier;
  scope: PoolScope;
  /** Author for human rows (creatorId); null for machine (no author — the
   *  GeneratedQuestion.userId is the recipient, not the author). */
  authorId: string | null;
  perishable: boolean;
  sourceRefs: string[];
  nAnswered: number;
  empiricalCorrectRate: number | null;
  isDuplicate: boolean;
  suppressedBy: string | null;
  createdAt: Date;
}

export interface PoolFilter {
  trustTiers?: TrustTier[];
  scopes?: PoolScope[];
  origins?: PoolOrigin[];
  /** canonical_subcategory match. */
  domains?: string[];
  difficulty?: string[];
  /** Include embedding-dedup-suppressed rows. Default false (reproduces today). */
  includeSuppressed?: boolean;
}

type MachineRow = typeof generatedQuestions.$inferSelect;
type HumanRow = typeof questions.$inferSelect;

/** Human Question.visibility → unified pool scope. */
export function visibilityToScope(visibility: 'private' | 'public' | 'friends' | 'blocked'): PoolScope {
  if (visibility === 'friends') return 'friends_only';
  // 'blocked' is a safety hard-block and is never poolable; collapse it to the
  // most restrictive scope so it can never widen reach even if a future caller
  // wires selectFromPool without an explicit scope filter.
  if (visibility === 'blocked') return 'private';
  return visibility;
}

/** Empirical played rate, uniform across origins: correct/asked when there is
 *  play history, falling back to the stored rate, else null. Matches the machine
 *  backfill in migration 0062 (correct_count / asked_count). */
export function empiricalRate(
  asked: number,
  correct: number,
  storedRate: number | null,
): number | null {
  if (asked > 0) return correct / asked;
  return storedRate ?? null;
}

export function normalizeMachineRow(row: MachineRow): PooledQuestion {
  return {
    id: row.id,
    origin: 'machine',
    questionText: row.questionText,
    answer: row.answer,
    explainer: row.explainer,
    canonicalSubcategory: row.canonicalSubcategory,
    broadCategory: row.broadCategory,
    difficultyEstimate: row.difficultyEstimate,
    trustTier: row.trustTier as TrustTier,
    scope: row.scope as PoolScope,
    authorId: null,
    perishable: row.perishable,
    sourceRefs: row.sourceRefs ?? [],
    nAnswered: row.nAnswered,
    empiricalCorrectRate: row.empiricalCorrectRate ?? null,
    isDuplicate: row.isDuplicate,
    suppressedBy: row.suppressedBy ?? null,
    createdAt: row.createdAt,
  };
}

export function normalizeHumanRow(row: HumanRow): PooledQuestion {
  return {
    id: row.id,
    origin: 'human',
    questionText: row.questionText,
    answer: row.answerText,
    // Human rows carry several explainer variants; prefer the factual one, then
    // the full default, mirroring the existing question-view fallback order.
    explainer: row.factualExplanation ?? row.explainerFull ?? null,
    canonicalSubcategory: row.canonicalSubcategory,
    broadCategory: row.broadCategory,
    difficultyEstimate: row.difficultyEstimate,
    trustTier: row.trustTier as TrustTier,
    // Reused field: scope is derived from the existing visibility column.
    scope: visibilityToScope(row.visibility),
    authorId: row.creatorId,
    perishable: row.perishable,
    sourceRefs: row.sourceRefs ?? [],
    // Reused fields: n_answered ← asked_count, empirical rate ← play history.
    nAnswered: row.askedCount,
    empiricalCorrectRate: empiricalRate(row.askedCount, row.correctCount, row.correctRate),
    isDuplicate: row.isDuplicate,
    suppressedBy: row.suppressedBy ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Pure filter over normalized pool rows — the single source of truth for filter
 * semantics. Defaults reproduce today's served set: suppressed rows excluded,
 * no tier/scope narrowing.
 */
export function filterPooledQuestions(
  rows: PooledQuestion[],
  filter: PoolFilter = {},
): PooledQuestion[] {
  const { trustTiers, scopes, origins, domains, difficulty, includeSuppressed } = filter;
  return rows.filter((row) => {
    if (!includeSuppressed && row.isDuplicate) return false;
    if (origins && !origins.includes(row.origin)) return false;
    if (trustTiers && !trustTiers.includes(row.trustTier)) return false;
    if (scopes && !scopes.includes(row.scope)) return false;
    if (domains && (row.canonicalSubcategory == null || !domains.includes(row.canonicalSubcategory))) {
      return false;
    }
    if (difficulty && (row.difficultyEstimate == null || !difficulty.includes(row.difficultyEstimate))) {
      return false;
    }
    return true;
  });
}

/**
 * Draw candidates from BOTH tables as one pool. The selective predicates
 * (domain, difficulty, suppressed, soft-delete) are pushed to SQL for
 * efficiency; the full, authoritative filter is re-applied in-memory via
 * filterPooledQuestions so SQL and pure paths can never diverge.
 */
export async function selectFromPool(filter: PoolFilter = {}): Promise<PooledQuestion[]> {
  const includeMachine = !filter.origins || filter.origins.includes('machine');
  const includeHuman = !filter.origins || filter.origins.includes('human');

  const [machineRows, humanRows] = await Promise.all([
    includeMachine
      ? db.select().from(generatedQuestions).where(buildMachineWhere(filter))
      : Promise.resolve([] as MachineRow[]),
    includeHuman
      ? db.select().from(questions).where(buildHumanWhere(filter))
      : Promise.resolve([] as HumanRow[]),
  ]);

  const pooled = [
    ...machineRows.map(normalizeMachineRow),
    ...humanRows.map(normalizeHumanRow),
  ];
  return filterPooledQuestions(pooled, filter);
}

function buildMachineWhere(filter: PoolFilter) {
  const clauses = [];
  if (!filter.includeSuppressed) clauses.push(eq(generatedQuestions.isDuplicate, false));
  if (filter.domains?.length) clauses.push(inArray(generatedQuestions.canonicalSubcategory, filter.domains));
  if (filter.difficulty?.length) clauses.push(inArray(generatedQuestions.difficultyEstimate, filter.difficulty));
  return clauses.length ? and(...clauses) : sql`true`;
}

function buildHumanWhere(filter: PoolFilter) {
  // Default reproduces today: soft-deleted authored rows are never served.
  const clauses = [isNull(questions.deletedAt)];
  if (!filter.includeSuppressed) clauses.push(eq(questions.isDuplicate, false));
  if (filter.domains?.length) clauses.push(inArray(questions.canonicalSubcategory, filter.domains));
  if (filter.difficulty?.length) {
    // questions.difficultyEstimate is enum-typed; the authoritative narrowing
    // happens in filterPooledQuestions, so a value outside the enum simply
    // matches nothing here. Cast to satisfy the column's literal union.
    clauses.push(inArray(questions.difficultyEstimate, filter.difficulty as HumanDifficulty[]));
  }
  return and(...clauses);
}

type HumanDifficulty = NonNullable<HumanRow['difficultyEstimate']>;

// ─── Embedding dedup helpers (B3) ───────────────────────────────────────────

export interface NearestPoolMatch {
  id: string;
  origin: PoolOrigin;
  /** Cosine similarity in [0,1]; 1 = identical. */
  similarity: number;
}

/**
 * Nearest non-suppressed neighbour across BOTH tables by cosine similarity,
 * excluding the given id. Returns null when nothing has an embedding yet.
 */
export async function findNearestInPool(
  embedding: number[],
  excludeId: string,
): Promise<NearestPoolMatch | null> {
  // cosineDistance returns 1 - similarity; ORDER BY it ascending for nearest.
  const machineDistance = cosineDistance(generatedQuestions.embedding, embedding);
  const humanDistance = cosineDistance(questions.embedding, embedding);

  const [machineNearest, humanNearest] = await Promise.all([
    db
      .select({ id: generatedQuestions.id, distance: machineDistance })
      .from(generatedQuestions)
      .where(and(
        isNotNull(generatedQuestions.embedding),
        eq(generatedQuestions.isDuplicate, false),
        sql`${generatedQuestions.id} <> ${excludeId}`,
      ))
      .orderBy(machineDistance)
      .limit(1),
    db
      .select({ id: questions.id, distance: humanDistance })
      .from(questions)
      .where(and(
        isNotNull(questions.embedding),
        eq(questions.isDuplicate, false),
        isNull(questions.deletedAt),
        sql`${questions.id} <> ${excludeId}`,
      ))
      .orderBy(humanDistance)
      .limit(1),
  ]);

  const candidates: NearestPoolMatch[] = [];
  if (machineNearest[0]) {
    candidates.push({ id: machineNearest[0].id, origin: 'machine', similarity: 1 - Number(machineNearest[0].distance) });
  }
  if (humanNearest[0]) {
    candidates.push({ id: humanNearest[0].id, origin: 'human', similarity: 1 - Number(humanNearest[0].distance) });
  }
  if (!candidates.length) return null;
  return candidates.reduce((best, c) => (c.similarity > best.similarity ? c : best));
}

/** Persist an embedding onto a pool row in the table indicated by origin. */
export async function storePoolEmbedding(
  origin: PoolOrigin,
  id: string,
  embedding: number[],
): Promise<void> {
  if (origin === 'machine') {
    await db.update(generatedQuestions).set({ embedding }).where(eq(generatedQuestions.id, id));
  } else {
    await db.update(questions).set({ embedding }).where(eq(questions.id, id));
  }
}

/**
 * Flag a row as a suppressed near-duplicate (never delete). suppressedBy points
 * at the surviving question, which may live in either table.
 */
export async function markPoolDuplicate(
  origin: PoolOrigin,
  id: string,
  survivorId: string,
): Promise<void> {
  if (origin === 'machine') {
    await db
      .update(generatedQuestions)
      .set({ isDuplicate: true, suppressedBy: survivorId })
      .where(eq(generatedQuestions.id, id));
  } else {
    await db
      .update(questions)
      .set({ isDuplicate: true, suppressedBy: survivorId })
      .where(eq(questions.id, id));
  }
}
