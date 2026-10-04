/** Keep malformed pilot output in the audit data, but never serve it as a quiz. */
export function isReviewableCandidate(candidate: { answer: string; explainer: string }): boolean {
  const unusable = /^(?:placeholder|tbd|to be determined|n\/a)$/i;
  return [candidate.answer, candidate.explainer].every(
    (value) => Boolean(value?.trim()) && !unusable.test(value.trim()),
  );
}
