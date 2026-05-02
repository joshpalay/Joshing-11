export function creatorNoteSubmittedAnswerText(
  submittedAnswer: string | null | undefined,
  fallbackSubject: 'Their' | 'Your',
) {
  return submittedAnswer?.trim() || `${fallbackSubject} answer was not saved.`;
}
