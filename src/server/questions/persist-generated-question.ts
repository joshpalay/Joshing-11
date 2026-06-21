import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { db, generatedQuestions, questions } from '@/server/db';
import {
  GenericCanonicalSubcategoryError,
  isGenericSubcategory,
} from '@/server/questions/canonical-subcategory';

/**
 * The single canonical `Question` id for a generated question, if one already
 * exists — across BOTH provenance columns:
 *   - `generated_question_id`: the row the daily-answer path persists.
 *   - `source_question_id`:    the row the send-to-friend path mints (curated_sent).
 *
 * Both link back to the same `GeneratedQuestion`, i.e. the same fact. Resolving
 * to one shared id is what stops a question from forking into two `Question`
 * rows — which otherwise defeats every question_id-keyed dedup downstream (feed
 * "already answered" suppression, the send already-in-feed guard) and produces
 * the answer-it-twice loop. Prefers the daily_generated row so repeated calls
 * converge on one stable id regardless of which path created which first.
 */
export async function findCanonicalQuestionIdForGenerated(
  generatedId: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(
      isNull(questions.deletedAt),
      or(
        eq(questions.generatedQuestionId, generatedId),
        eq(questions.sourceQuestionId, generatedId),
      ),
    ))
    .orderBy(sql`case when ${questions.source} = 'daily_generated' then 0 else 1 end`)
    .limit(1);
  return existing?.id ?? null;
}

function normalizeQuestionTextForDedup(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type PersistGeneratedQuestionResult = {
  questionId: string;
  alreadyExisted: boolean;
};

function asDifficulty(value: string): 'accessible' | 'moderate' | 'specialist' | null {
  if (value === 'accessible' || value === 'moderate' || value === 'specialist') return value;
  return null;
}

export async function persistGeneratedQuestion(generatedQuestionId: string, slotDomain?: string): Promise<PersistGeneratedQuestionResult> {
  try {
    // Reuse any canonical Question already linked to this generated row — by
    // generated_question_id (the usual daily path) OR source_question_id (a
    // curated_sent row a prior send-to-friend minted). The latter is what closes
    // the send-then-answer ordering: without it, persisting after a send would
    // create a SECOND row for the same fact and re-open the answer-it-twice loop.
    const existingId = await findCanonicalQuestionIdForGenerated(generatedQuestionId);
    if (existingId) {
      return { questionId: existingId, alreadyExisted: true };
    }

    const [generated] = await db
      .select()
      .from(generatedQuestions)
      .where(eq(generatedQuestions.id, generatedQuestionId))
      .limit(1);

    if (!generated) {
      throw new Error(`Generated question not found: ${generatedQuestionId}`);
    }

    // Fact-key dedup: even when the LLM is told to avoid a fact, it sometimes
    // produces a re-worded version with a fresh question_text — which slips
    // past the text-level check below. The fact_key column is the canonical
    // identifier for the underlying trivia (set by the LLM, normalized in
    // src/server/questions/fact-key.ts) and is shared across re-wordings.
    // If any prior daily_generated Question is keyed to a GeneratedQuestion
    // with the same fact_key, reuse that Question rather than create a new
    // one. Runs before the text-level check because it's the stricter test.
    const factKey = generated.factKey;
    if (factKey) {
      const [factMatch] = await db
        .select({ id: questions.id })
        .from(questions)
        .innerJoin(
          generatedQuestions,
          eq(questions.generatedQuestionId, generatedQuestions.id),
        )
        .where(and(
          isNull(questions.deletedAt),
          eq(questions.source, 'daily_generated'),
          eq(generatedQuestions.factKey, factKey),
        ))
        .limit(1);

      if (factMatch) {
        return { questionId: factMatch.id, alreadyExisted: true };
      }
    }

    // Text-level dedup: the LLM occasionally returns identical question text
    // across separate per-user GeneratedQuestion rows. Without this check each
    // generation would land as its own Question, then a "friend answered"
    // feed item for question B would slip past the question_id-based
    // dedup in createFeedItemsForFriendsFromAnswer because the recipient's
    // prior answer is keyed to question A.
    const dedupText = normalizeQuestionTextForDedup(generated.questionText);
    const dedupDomain = (generated.canonicalSubcategory ?? generated.broadCategory ?? slotDomain ?? '').trim();
    if (dedupText && dedupDomain) {
      const [textMatch] = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(
          isNull(questions.deletedAt),
          eq(questions.source, 'daily_generated'),
          sql`lower(regexp_replace(${questions.questionText}, '\s+', ' ', 'g')) = ${dedupText}`,
          sql`lower(${questions.canonicalSubcategory}) = ${dedupDomain.toLowerCase()}`,
        ))
        .limit(1);

      if (textMatch) {
        // Intentionally do NOT rewrite the matched Question's
        // generated_question_id — that would orphan the original
        // GeneratedQuestion. The new GeneratedQuestion just shares the
        // canonical Question; subsequent persist calls for this same
        // GeneratedQuestion will re-hit this same text-dedup branch.
        return { questionId: textMatch.id, alreadyExisted: true };
      }
    }

    // F4.5: prefer a specific canonical subcategory; fall back through broad
    // category and slot domain. If all three are generic labels, use whatever
    // is non-null rather than throwing — persisting with a generic label is
    // far better than failing to persist at all, which would silently block
    // feed propagation for every correct daily answer.
    const desiredCanonical = !isGenericSubcategory(generated.canonicalSubcategory)
      ? generated.canonicalSubcategory!
      : !isGenericSubcategory(generated.broadCategory)
        ? generated.broadCategory!
        : !isGenericSubcategory(slotDomain)
          ? slotDomain!
          : slotDomain ?? generated.canonicalSubcategory ?? generated.broadCategory;

    if (!desiredCanonical) {
      throw new GenericCanonicalSubcategoryError(desiredCanonical);
    }

    const [created] = await db
      .insert(questions)
      .values({
        creatorId: null,
        generatedQuestionId,
        source: 'daily_generated',
        questionText: generated.questionText,
        answerText: generated.answer,
        factualExplanation: generated.explainer,
        // Carry the machine row's acceptable_variants (B4 Phase 4) onto the
        // canonical row so grading honors right-but-rephrased answers everywhere.
        acceptedAlternatives: generated.acceptableVariants ?? [],
        answerSource: 'llm_suggested',
        questionType: 'factual',
        category: 'general_knowledge',
        broadCategory: generated.broadCategory,
        canonicalSubcategory: desiredCanonical,
        categoryOverridden: true,
        difficultyEstimate: asDifficulty(generated.difficultyEstimate),
        llmDifficulty: asDifficulty(generated.difficultyEstimate),
        calibratedDifficulty: asDifficulty(generated.difficultyEstimate),
        status: 'verified',
        visibility: 'public',
        // Carry the machine row's earned trust tier onto the canonical row (B4
        // Phase 2): a machine_verified generated question yields a machine_verified
        // Question, which human play can then promote to human_validated. Without
        // this the canonical row would default to 'unverified' and never promote.
        // Null-creator daily_generated rows are machine-origin, so they must NOT
        // default to author_confirmed (that tier means a human authored it).
        trustTier: generated.trustTier,
        // Carry the precomputed aside through; the editorial label is applied at
        // display time (selectInsideJokeForViewer) for these null-creator rows.
        insideJoke: generated.insideJoke,
        // Carry the machine row's Voyage embedding onto the canonical promotion
        // (B-DEDUP-SEMANTIC-01). Without this, daily_generated promotions land
        // with a NULL embedding, so the per-user semantic history gate
        // (getNearestAnsweredQuestionDistance) can't see questions answered from
        // the daily path — the most common kind. Copied, not recomputed, so it
        // adds no Voyage call; null when the source embed hadn't completed.
        embedding: generated.embedding,
      })
      .onConflictDoNothing({ target: questions.generatedQuestionId })
      .returning({ id: questions.id });

    if (created) {
      return { questionId: created.id, alreadyExisted: false };
    }

    // Concurrent insert won the race; re-fetch the row it wrote.
    const [racedExisting] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.generatedQuestionId, generatedQuestionId))
      .limit(1);

    if (!racedExisting) {
      throw new Error(`Failed to persist generated question: ${generatedQuestionId}`);
    }

    return { questionId: racedExisting.id, alreadyExisted: true };
  } catch (error) {
    console.error('[persistGeneratedQuestion] failed', {
      generatedQuestionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
