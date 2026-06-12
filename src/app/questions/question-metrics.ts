import type { QuestionView } from '@/server/db/queries/questions';

export type QuestionPageMetrics = {
  answersReceived: number;
  questionsAnswered: number;
};

export function getQuestionPageMetrics(
  questions: Pick<QuestionView, 'timesAnswered'>[],
): QuestionPageMetrics {
  return questions.reduce<QuestionPageMetrics>(
    (metrics, question) => {
      const timesAnswered = Number.isFinite(question.timesAnswered)
        ? Math.max(0, question.timesAnswered)
        : 0;
      return {
        answersReceived: metrics.answersReceived + timesAnswered,
        questionsAnswered: metrics.questionsAnswered + (timesAnswered > 0 ? 1 : 0),
      };
    },
    { answersReceived: 0, questionsAnswered: 0 },
  );
}
