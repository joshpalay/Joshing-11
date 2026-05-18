const MIN_ANSWER_TOKEN_LENGTH = 3;
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function answerLeaksIntoQuestion(normalizedQuestion: string, candidate: string): boolean {
  const normalizedAnswer = normalize(candidate);
  if (!normalizedAnswer || normalizedAnswer.length < MIN_ANSWER_TOKEN_LENGTH) return false;
  return ` ${normalizedQuestion} `.includes(` ${normalizedAnswer} `);
}

export function questionContainsAnswer(
  questionText: string,
  answer: string,
  alternateAnswers: readonly string[] = [],
): boolean {
  const normalizedQuestion = normalize(questionText);
  if (!normalizedQuestion) return false;
  if (answerLeaksIntoQuestion(normalizedQuestion, answer)) return true;
  for (const alt of alternateAnswers) {
    if (answerLeaksIntoQuestion(normalizedQuestion, alt)) return true;
  }
  return false;
}
