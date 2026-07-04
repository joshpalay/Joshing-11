/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) — Phase 3: ROW-GRANULAR question
 * reclassification.
 *
 * Moves a chosen SET of questions (by id) into a different domain — the "King Lear
 * splits out of Shakespearean Tragedy" case. Deliberately NOT
 * merge-domain.ts's applyCorpusRetarget: that path moves a WHOLE label and
 * consolidates every per-user table because it DISSOLVES a domain. A reclassify
 * keeps both domains alive and re-homes only specific question rows, so it must
 * touch ONLY the question rows and NOTHING per-user.
 *
 * Columns moved (the complete set — Phase 3 map):
 *   - GeneratedQuestion.canonical_subcategory + domain_key (must move together).
 *   - Question.canonical_subcategory (no domain_key column on this table).
 *
 * It does NOT touch MASTERY_EVENTS (the immutable log) or any PLAYER_MASTERY /
 * per-user row. Mastery re-derives from the moved questions via the recompute
 * engine (recompute.ts) — points are never relocated; they are recomputed. The ids
 * may belong to either store; each id matches at most one table.
 */

import { inArray } from 'drizzle-orm';

import { db, generatedQuestions, questions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

export type ReclassifyResult = {
  toLabel: string;
  toKey: string;
  /** GeneratedQuestion (bank) rows moved. */
  generatedMoved: number;
  /** Question (authored) rows moved. */
  authoredMoved: number;
};

export async function reclassifyQuestionsByIds(
  input: { questionIds: readonly string[]; toLabel: string },
  actorUserId: string,
): Promise<ReclassifyResult> {
  const toLabel = input.toLabel.trim();
  const toKey = domainKey(toLabel);
  const ids = [...new Set(input.questionIds.filter((id) => id && id.trim()))];

  if (ids.length === 0 || !toLabel) {
    return { toLabel, toKey, generatedMoved: 0, authoredMoved: 0 };
  }

  const result = await db.transaction(async (tx) => {
    const generated = await tx
      .update(generatedQuestions)
      .set({ canonicalSubcategory: toLabel, domainKey: toKey })
      .where(inArray(generatedQuestions.id, ids))
      .returning({ id: generatedQuestions.id });
    const authored = await tx
      .update(questions)
      .set({ canonicalSubcategory: toLabel })
      .where(inArray(questions.id, ids))
      .returning({ id: questions.id });
    return { generatedMoved: generated.length, authoredMoved: authored.length };
  });

  console.info('[knowledge-admin] questions reclassified', {
    actorUserId,
    toLabel,
    toKey,
    requested: ids.length,
    ...result,
  });

  return { toLabel, toKey, ...result };
}
