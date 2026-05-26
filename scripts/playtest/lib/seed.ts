import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, questions, users } from '@/server/db';
import { createJoshingGame } from '@/server/db/queries/joshing-game';

import { authenticateAsTestUser } from './auth';
import type { PlaytestManifest } from './manifest';

const PHONE_BASE = '+15557000000';

function phoneFor(index: number): string {
  const tail = PHONE_BASE.length - String(index).length;
  return PHONE_BASE.slice(0, tail) + String(index);
}

type SeededQuestion = {
  questionText: string;
  answerText: string;
  acceptedAlternatives: string[];
  category: 'literature' | 'science' | 'history';
  broadCategory: string;
  canonicalSubcategory: string;
};

const TEST_QUESTIONS: SeededQuestion[] = [
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

async function provisionUser(params: {
  phone: string;
  displayName: string;
}): Promise<{ id: string }> {
  // Mark onboardingComplete so the edge proxy doesn't redirect to /onboarding.
  // refresh-onboarding-claim will re-mint the JWT to match on first nav.
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

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneNumber, params.phone))
    .limit(1);
  if (!existing) {
    throw new Error(`[playtest/seed] failed to provision user for ${params.phone}`);
  }
  return existing;
}

async function insertQuestions(
  inviterId: string,
  count: number,
): Promise<string[]> {
  const picks = TEST_QUESTIONS.slice(0, count);
  if (picks.length < count) {
    throw new Error(`[playtest/seed] only ${TEST_QUESTIONS.length} canned questions available; requested ${count}`);
  }

  const rows = await db
    .insert(questions)
    .values(
      picks.map((q) => ({
        creatorId: inviterId,
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

  return rows.map((row) => row.id);
}

export async function seed(params: {
  runId: string;
  baseUrl: string;
  numPlayers: number;
  numQuestions: number;
}): Promise<PlaytestManifest> {
  const inviterPhone = phoneFor(0);
  const inviter = await provisionUser({ phone: inviterPhone, displayName: '[TEST] Inviter' });

  const players: PlaytestManifest['players'] = [];
  for (let i = 1; i <= params.numPlayers; i += 1) {
    const phone = phoneFor(i);
    const displayName = `[TEST] Player ${i}`;
    const user = await provisionUser({ phone, displayName });
    const cookie = await authenticateAsTestUser(params.baseUrl, phone);
    players.push({ id: user.id, phone, displayName, sessionCookie: cookie.value });
  }

  const questionIds = await insertQuestions(inviter.id, params.numQuestions);

  const { id: gameId } = await createJoshingGame({
    title: '[TEST] Automated Playtest',
    creatorId: inviter.id,
    recipientIds: players.map((p) => p.id),
    questionIds,
  });

  return {
    runId: params.runId,
    baseUrl: params.baseUrl,
    createdAt: new Date().toISOString(),
    inviter: { id: inviter.id, phone: inviterPhone, displayName: '[TEST] Inviter' },
    players,
    questionIds,
    gameId,
  };
}

export function canonicalAnswerFor(questionText: string): string | null {
  const match = TEST_QUESTIONS.find((q) => q.questionText === questionText);
  return match?.answerText ?? null;
}
