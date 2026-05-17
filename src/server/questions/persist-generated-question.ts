import { eq } from 'drizzle-orm';

import { db, generatedQuestions, questions } from '@/server/db';
import {
  GenericCanonicalSubcategoryError,
  isGenericSubcategory,
} from '@/server/questions/canonical-subcategory';

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
    const [existing] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.generatedQuestionId, generatedQuestionId))
      .limit(1);

    if (existing) {
      return { questionId: existing.id, alreadyExisted: true };
    }

    const [generated] = await db
      .select()
      .from(generatedQuestions)
      .where(eq(generatedQuestions.id, generatedQuestionId))
      .limit(1);

    if (!generated) {
      throw new Error(`Generated question not found: ${generatedQuestionId}`);
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
        acceptedAlternatives: [],
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
      })
      .returning({ id: questions.id });

    if (!created) {
      throw new Error(`Failed to persist generated question: ${generatedQuestionId}`);
    }

    return { questionId: created.id, alreadyExisted: false };
  } catch (error) {
    console.error('[persistGeneratedQuestion] failed', {
      generatedQuestionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
