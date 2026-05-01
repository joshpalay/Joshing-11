import type { MasteryTier } from '@prisma/client';

export type KnowledgeDomain = {
  name: string;
  tier: MasteryTier;
  progressWithinTier: number;
  masteryPoints: number;
  declaredQuestionCount: number;
  provenCorrectCount: number;
  isVisibleOnProfile: boolean;
  broadCategory?: string | null;
};

export type KnowledgeOverview = {
  userId: string;
  displayName: string;
  yourMind: string;
  topDomains: KnowledgeDomain[];
  allDomains: KnowledgeDomain[];
  excludedDomains: KnowledgeDomain[];
};

export type DomainCorrectAnswer = {
  questionId: string;
  questionText: string;
  authorName: string;
  explanation: string | null;
};

export type DomainAuthoredQuestion = {
  questionId: string;
  questionText: string;
  groupNames: string[];
};

export type DomainDetail = {
  domain: KnowledgeDomain;
  explanation: string;
  correctAnswers: DomainCorrectAnswer[];
  authoredQuestions: DomainAuthoredQuestion[];
};
