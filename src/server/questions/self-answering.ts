const MIN_ANSWER_TOKEN_LENGTH = 3;
const COMBINING_DIACRITICS = /[̀-ͯ]/g;
// Leading article on an otherwise-normalized answer. An article-led answer
// ("A fly", "The box cutter") will not substring-match a question that names
// the bare noun ("the episode 'Fly'"), so we strip it and re-test the core.
const LEADING_ARTICLE = /^(?:a|an|the) /;

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function containsNormalizedAnswer(normalizedQuestion: string, normalizedAnswer: string): boolean {
  if (!normalizedAnswer || normalizedAnswer.length < MIN_ANSWER_TOKEN_LENGTH) return false;
  return ` ${normalizedQuestion} `.includes(` ${normalizedAnswer} `);
}

function answerLeaksIntoQuestion(normalizedQuestion: string, candidate: string): boolean {
  const normalizedAnswer = normalize(candidate);
  if (containsNormalizedAnswer(normalizedQuestion, normalizedAnswer)) return true;
  // "A box cutter" / "A fly" name the answer with a leading article the question
  // omits; strip it and re-test so the core noun phrase is still caught.
  const stripped = normalizedAnswer.replace(LEADING_ARTICLE, '');
  if (stripped !== normalizedAnswer && containsNormalizedAnswer(normalizedQuestion, stripped)) {
    return true;
  }
  return false;
}

export function textContainsAnswer(
  text: string,
  answer: string,
  alternateAnswers: readonly string[] = [],
): boolean {
  const normalizedText = normalize(text);
  if (!normalizedText) return false;
  if (answerLeaksIntoQuestion(normalizedText, answer)) return true;
  for (const alt of alternateAnswers) {
    if (answerLeaksIntoQuestion(normalizedText, alt)) return true;
  }
  return false;
}

export const questionContainsAnswer = textContainsAnswer;
