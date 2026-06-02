import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, questions, users } from '@/server/db';
import { createJoshingGame } from '@/server/db/queries/joshing-game';

import { authenticateAsTestUser, type SessionCookie } from './auth';
import type { ManifestBuilder } from './scenario-context';

const PHONE_BASE = '+15557000000';

export function phoneFor(index: number): string {
  const tail = PHONE_BASE.length - String(index).length;
  return PHONE_BASE.slice(0, tail) + String(index);
}

export type SeededQuestion = {
  questionText: string;
  answerText: string;
  acceptedAlternatives: string[];
  category: 'literature' | 'science' | 'history';
  broadCategory: string;
  canonicalSubcategory: string;
};

export const TEST_QUESTIONS: SeededQuestion[] = [
  {
    questionText: '[TEST] What is the name of the dog in Peanuts?',
    answerText: 'Snoopy',
    acceptedAlternatives: ['snoopy'],
    category: 'literature',
    broadCategory: 'Pop Culture',
    canonicalSubcategory: 'Mid-Century Newspaper Comics',
  },
  {
    questionText: '[TEST] What planet is closest to the Sun?',
    answerText: 'Mercury',
    acceptedAlternatives: ['mercury'],
    category: 'science',
    broadCategory: 'Science',
    canonicalSubcategory: 'Inner Planets',
  },
  {
    questionText: '[TEST] In what year did the Berlin Wall fall?',
    answerText: '1989',
    acceptedAlternatives: ['nineteen eighty-nine'],
    category: 'history',
    broadCategory: 'History',
    canonicalSubcategory: 'Cold War Endgame',
  },
  {
    questionText: '[TEST] Who painted the Mona Lisa?',
    answerText: 'Leonardo da Vinci',
    acceptedAlternatives: ['da vinci', 'leonardo'],
    category: 'literature',
    broadCategory: 'Visual Arts',
    canonicalSubcategory: 'Italian Renaissance Painting',
  },
  {
    questionText: '[TEST] What is the chemical symbol for gold?',
    answerText: 'Au',
    acceptedAlternatives: ['au'],
    category: 'science',
    broadCategory: 'Science',
    canonicalSubcategory: 'Periodic Table Symbols',
  },
];

export type ProvisionedUser = { id: string; phone: string; displayName: string };

export async function provisionTestUser(params: {
  phone: string;
  displayName: string;
  scenarioId: string;
  manifest: ManifestBuilder;
}): Promise<ProvisionedUser> {
  const id = randomUUID();
  await db
    .insert(users)
    .values({
      id,
      phoneNumber: params.phone,
      displayName: params.displayName,
      phoneVerified: true,
      onboardingComplete: true,
    })
    .onConflictDoNothing({ target: users.phoneNumber });

  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneNumber, params.phone))
    .limit(1);
  if (!row) {
    throw new Error(`[playtest/seed] failed to provision user for ${params.phone}`);
  }

  params.manifest.trackUser({
    id: row.id,
    phone: params.phone,
    displayName: params.displayName,
    scenarioId: params.scenarioId,
  });

  return { id: row.id, phone: params.phone, displayName: params.displayName };
}

export async function authenticateAndCookie(
  baseUrl: string,
  phone: string,
): Promise<SessionCookie> {
  return authenticateAsTestUser(baseUrl, phone);
}

export async function insertTestQuestions(params: {
  creatorId: string;
  count: number;
  scenarioId: string;
  manifest: ManifestBuilder;
}): Promise<string[]> {
  const picks = TEST_QUESTIONS.slice(0, params.count);
  if (picks.length < params.count) {
    throw new Error(
      `[playtest/seed] only ${TEST_QUESTIONS.length} canned questions available; requested ${params.count}`,
    );
  }

  const rows = await db
    .insert(questions)
    .values(
      picks.map((q) => ({
        creatorId: params.creatorId,
        questionText: q.questionText,
        answerText: q.answerText,
        acceptedAlternatives: q.acceptedAlternatives,
        category: q.category,
        broadCategory: q.broadCategory,
        canonicalSubcategory: q.canonicalSubcategory,
        questionType: 'factual' as const,
        status: 'verified' as const,
        verified: true,
        visibility: 'friends' as const,
      })),
    )
    .returning({ id: questions.id });

  for (const row of rows) {
    params.manifest.trackQuestion({
      id: row.id,
      creatorId: params.creatorId,
      scenarioId: params.scenarioId,
    });
  }

  return rows.map((row) => row.id);
}

export async function createTestGame(params: {
  title: string;
  creatorId: string;
  recipientIds: string[];
  questionIds: string[];
  scenarioId: string;
  manifest: ManifestBuilder;
}): Promise<string> {
  const { id } = await createJoshingGame({
    title: params.title,
    creatorId: params.creatorId,
    recipientIds: params.recipientIds,
    questionIds: params.questionIds,
  });
  params.manifest.trackGame({ id, scenarioId: params.scenarioId });
  return id;
}

export function canonicalAnswerFor(questionText: string): string | null {
  const match = TEST_QUESTIONS.find((q) => q.questionText === questionText);
  return match?.answerText ?? null;
}
