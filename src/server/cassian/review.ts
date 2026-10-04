import type { PoolClient } from 'pg';
import { pool } from '@/server/db';
import { normalizeForMatch } from '@/server/answers/match-normalization';
import { sameFactAnswerKey } from '@/server/daily/answer-cooldown';
import { gradeCassianAnswer } from './grade';
import { isReviewableCandidate } from './candidate-validity';

type CandidateRow = {
  id: string; domain: string; breadth: string; difficulty: string;
  question_text: string; answer: string; acceptable_variants: string[];
  explainer: string; fact_key: string; model: string; arm: string;
  machine_status: string; checks: Record<string, unknown>;
  answer_text?: string | null; grade?: { result: string; via: string } | null;
  rating?: Record<string, unknown> | null;
  run_id: string; manifest_sha?: string;
};

export type CassianCard = {
  id: string; domain: string; breadth: string; difficulty: string;
  questionText: string;
  reveal?: {
    answer: string; explainer: string; result: string; gradedVia: string;
    submittedAnswer: string;
  };
};

export function publicCard(row: CandidateRow): CassianCard {
  return {
    id: row.id, domain: row.domain, breadth: row.breadth,
    difficulty: row.difficulty, questionText: row.question_text,
    ...(row.answer_text !== null && row.answer_text !== undefined && row.grade
      ? { reveal: {
        answer: row.answer, explainer: row.explainer,
        result: row.grade.result, gradedVia: row.grade.via,
        submittedAnswer: row.answer_text,
      } } : {}),
  };
}

export async function getRatedCassianDetails(userId: string, candidateId: string): Promise<{
  model: string; arm: string; machineStatus: string; gateReasons: string[];
} | null> {
  const result = await pool.query<CandidateRow>(`
    SELECT c.* FROM "CassianReview" r JOIN "CassianCandidate" c ON c.id = r.candidate_id
    WHERE r.admin_user_id = $1 AND r.candidate_id = $2 AND r.rating IS NOT NULL`,
  [userId, candidateId]);
  const row = result.rows[0];
  if (!row) return null;
  const gateReasons = ['quality', 'factual'].flatMap((gate) => {
    const check = row.checks?.[gate] as { drop?: boolean; reason?: string } | undefined;
    return check?.drop && check.reason ? [`${gate}: ${check.reason}`] : [];
  });
  const deterministic = row.checks?.deterministic as Record<string, boolean> | undefined;
  if (deterministic) for (const [key, failed] of Object.entries(deterministic)) {
    if (key === 'topic' ? !failed : failed) gateReasons.push(`deterministic: ${key}`);
  }
  return { model: row.model, arm: row.arm, machineStatus: row.machine_status, gateReasons };
}

/** Full candidate-specific fact/text check before recording a new exposure. */
export async function alreadySeen(client: PoolClient, userId: string, candidate: CandidateRow): Promise<boolean> {
  const result = await client.query<{ seen: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM "GeneratedQuestion" g
      WHERE g.user_id = $1 AND (g.fact_key = $2 OR
        regexp_replace(lower(g.question_text), '[^a-z0-9]', '', 'g') = $3)
      UNION ALL
      SELECT 1 FROM "DailyQueue" d
      CROSS JOIN LATERAL jsonb_array_elements(d.slots) AS s(slot)
      LEFT JOIN "GeneratedQuestion" g ON g.id = s.slot ->> 'generated_question_id'
      WHERE d.user_id = $1 AND (g.fact_key = $2 OR
        regexp_replace(lower(s.slot ->> 'question_text'), '[^a-z0-9]', '', 'g') = $3)
      UNION ALL
      SELECT 1 FROM "MASTERY_EVENTS" m
      JOIN "Question" q ON q.id = m.question_id
      LEFT JOIN "GeneratedQuestion" g ON g.id = q.generated_question_id
      WHERE m.answered_by_user_id = $1 AND (g.fact_key = $2 OR
        regexp_replace(lower(q.question_text), '[^a-z0-9]', '', 'g') = $3)
      UNION ALL
      SELECT 1 FROM "FeedItem" f
      JOIN "Question" q ON q.id = f."questionId"
      LEFT JOIN "GeneratedQuestion" g ON g.id = q.generated_question_id
      WHERE f."recipientUserId" = $1 AND (g.fact_key = $2 OR
        regexp_replace(lower(q.question_text), '[^a-z0-9]', '', 'g') = $3)
      UNION ALL
      SELECT 1 FROM "Question" q WHERE q.creator_id = $1 AND
        regexp_replace(lower(q.question_text), '[^a-z0-9]', '', 'g') = $3
      UNION ALL
      SELECT 1 FROM "CassianReview" r JOIN "CassianCandidate" c ON c.id = r.candidate_id
      WHERE r.admin_user_id = $1 AND (c.fact_key = $2 OR
        regexp_replace(lower(c.question_text), '[^a-z0-9]', '', 'g') = $3)
    ) AS seen`,
    [userId, candidate.fact_key,
      candidate.question_text.toLowerCase().replace(/[^a-z0-9]/g, '')],
  );
  if (result.rows[0]?.seen) return true;
  // Fact keys can differ for a paraphrase. The existing same-fact answer key
  // catches a second wording of a distinctive answer within the same domain;
  // low-information answers (years, colors, yes/no) are excluded by that helper.
  const answerKey = sameFactAnswerKey(candidate.answer);
  if (!answerKey) return false;
  const answers = await client.query<{ answer: string }>(`
    SELECT g.answer FROM "GeneratedQuestion" g
    WHERE g.user_id = $1 AND lower(g.canonical_subcategory) = lower($2)
    UNION ALL
    SELECT COALESCE(g.answer, q.answer_text) AS answer FROM "DailyQueue" d
    CROSS JOIN LATERAL jsonb_array_elements(d.slots) AS s(slot)
    LEFT JOIN "GeneratedQuestion" g ON g.id = s.slot ->> 'generated_question_id'
    LEFT JOIN "Question" q ON q.id = s.slot ->> 'question_id'
    WHERE d.user_id = $1 AND lower(s.slot ->> 'domain') = lower($2)
    UNION ALL
    SELECT q.answer_text FROM "MASTERY_EVENTS" m
    JOIN "Question" q ON q.id = m.question_id
    WHERE m.answered_by_user_id = $1 AND lower(q.canonical_subcategory) = lower($2)
    UNION ALL
    SELECT q.answer_text FROM "FeedItem" f
    JOIN "Question" q ON q.id = f."questionId"
    WHERE f."recipientUserId" = $1 AND lower(q.canonical_subcategory) = lower($2)
    UNION ALL
    SELECT q.answer_text FROM "Question" q
    WHERE q.creator_id = $1 AND lower(q.canonical_subcategory) = lower($2)
    UNION ALL
    SELECT c.answer FROM "CassianReview" r
    JOIN "CassianCandidate" c ON c.id = r.candidate_id
    WHERE r.admin_user_id = $1 AND lower(c.domain) = lower($2)`,
  [userId, candidate.domain]);
  return answers.rows.some((row) => sameFactAnswerKey(row.answer) === answerKey);
}

/** Allocate one card per admin. Refresh returns the existing unreviewed card. */
export async function nextCassianCard(userId: string): Promise<CassianCard | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cassian-card:${userId}`]);
    const pending = await client.query<CandidateRow>(`
      SELECT c.*, r.answer_text, r.grade, r.rating
      FROM "CassianReview" r JOIN "CassianCandidate" c ON c.id = r.candidate_id
      WHERE r.admin_user_id = $1 AND r.rating IS NULL
      ORDER BY r.shown_at DESC LIMIT 1`, [userId]);
    if (pending.rows[0] && isReviewableCandidate(pending.rows[0])) {
      await client.query('COMMIT');
      return publicCard(pending.rows[0]);
    }
    const candidates = await client.query<CandidateRow>(`
      SELECT c.* FROM "CassianCandidate" c
      WHERE NOT EXISTS (SELECT 1 FROM "CassianReview" r
        WHERE r.candidate_id = c.id AND r.admin_user_id = $1)
      ORDER BY md5($1 || c.id)`, [userId]);
    for (const candidate of candidates.rows) {
      if (!isReviewableCandidate(candidate)) continue;
      if (await alreadySeen(client, userId, candidate)) continue;
      const inserted = await client.query(
        'INSERT INTO "CassianReview" (candidate_id, admin_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [candidate.id, userId],
      );
      if (inserted.rowCount) {
        await client.query('COMMIT');
        return publicCard(candidate);
      }
    }
    await client.query('COMMIT');
    return null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Exact/accepted answers use the Daily Five fast path. Different wording is
 * checked with a separately budgeted Haiku call; no game state is touched. */
export async function answerCassianCard(userId: string, candidateId: string, submitted: string): Promise<CassianCard['reveal'] | null> {
  const preflight = await pool.query<CandidateRow>(`
    SELECT c.*, run.manifest_sha, r.answer_text, r.grade FROM "CassianReview" r
    JOIN "CassianCandidate" c ON c.id = r.candidate_id
    JOIN "CassianRun" run ON run.id = c.run_id
    WHERE r.admin_user_id = $1 AND r.candidate_id = $2`, [userId, candidateId]);
  const original = preflight.rows[0];
  if (!original) return null;
  if (original.answer_text !== null && original.answer_text !== undefined && original.grade) {
    return publicCard(original).reveal;
  }
  const submittedNormalized = normalizeForMatch(submitted);
  const accepted = [original.answer, ...(Array.isArray(original.acceptable_variants) ? original.acceptable_variants : [])];
  const correct = Boolean(submittedNormalized) && accepted.some((answer) => normalizeForMatch(answer) === submittedNormalized);
  const grade = !isReviewableCandidate(original) ? { result: 'needs_review', via: 'invalid_candidate' }
    : correct ? { result: 'correct', via: 'exact_or_variant' }
    : !submittedNormalized ? { result: 'gave_up', via: 'empty_answer' }
      : await gradeCassianAnswer({
        runId: original.run_id, manifestSha: original.manifest_sha ?? '', userId, candidateId,
        question: original.question_text, answer: original.answer,
        variants: original.acceptable_variants, submitted,
      });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<CandidateRow>(`
      SELECT c.*, r.answer_text, r.grade FROM "CassianReview" r
      JOIN "CassianCandidate" c ON c.id = r.candidate_id
      WHERE r.admin_user_id = $1 AND r.candidate_id = $2 FOR UPDATE OF r`,
      [userId, candidateId]);
    const row = result.rows[0];
    if (!row) { await client.query('ROLLBACK'); return null; }
    if (row.answer_text !== null && row.answer_text !== undefined && row.grade) {
      await client.query('COMMIT');
      return publicCard(row).reveal;
    }
    await client.query(`UPDATE "CassianReview" SET answer_text = $3, grade = $4::jsonb,
      answered_at = now() WHERE candidate_id = $2 AND admin_user_id = $1`,
      [userId, candidateId, submitted, JSON.stringify(grade)]);
    await client.query('COMMIT');
    return publicCard({ ...row, answer_text: submitted, grade }).reveal;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export type CassianRating = {
  revisionId: string;
  overall: 'Good' | 'Fix' | 'Reject' | 'Unsure';
  accuracy?: string; clarity?: string; interest?: string; difficulty?: string;
  topicFit?: string; appropriateness?: string; repetition?: string;
  answerAcceptance?: string; creationSpeed?: string; gateReview?: string;
  candidateDisposition?: string; gateDecisionReview?: string; postGateNote?: string;
  accuracyIssue?: string; correctedVariants?: string; familiarity?: string;
  note?: string; correctedQuestion?: string; correctedAnswer?: string;
  correctedExplanation?: string; supportingSource?: string;
};

export async function saveCassianRating(userId: string, candidateId: string, rating: CassianRating): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ rating: CassianRating | null; rating_history: CassianRating[] }>(`
      SELECT rating, rating_history FROM "CassianReview"
      WHERE admin_user_id = $1 AND candidate_id = $2 AND answered_at IS NOT NULL
      FOR UPDATE`, [userId, candidateId]);
    const row = result.rows[0];
    if (!row) { await client.query('ROLLBACK'); return false; }
    if (row.rating?.revisionId === rating.revisionId) { await client.query('COMMIT'); return true; }
    const history = [...(Array.isArray(row.rating_history) ? row.rating_history : [])];
    if (row.rating) history.push(row.rating);
    await client.query(`UPDATE "CassianReview" SET rating = $3::jsonb,
      rating_history = $4::jsonb, rating_updated_at = now()
      WHERE admin_user_id = $1 AND candidate_id = $2`,
      [userId, candidateId, JSON.stringify(rating), JSON.stringify(history)]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function saveCassianPanelNote(userId: string, note: {
  id: string; area: 'Missing topic' | 'Variety' | 'UI issue'; text: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ panel_notes: Array<Record<string, unknown> & { id: string }> }>(
      'SELECT panel_notes FROM "CassianRun" WHERE id = $1 FOR UPDATE', ['cassian-pilot-2026-10-03'],
    );
    if (!result.rows[0]) throw new Error('Cassian run missing');
    const notes = Array.isArray(result.rows[0].panel_notes) ? result.rows[0].panel_notes : [];
    if (!notes.some((item) => item.id === note.id)) {
      notes.push({ ...note, adminUserId: userId, createdAt: new Date().toISOString() });
      await client.query('UPDATE "CassianRun" SET panel_notes = $2::jsonb, updated_at = now() WHERE id = $1',
        ['cassian-pilot-2026-10-03', JSON.stringify(notes)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
