const GENERIC_ANSWER_VALUES = new Set([
  'answer',
  'the answer',
  'correct answer',
  'the correct answer',
  'canonical answer',
  'the canonical answer',
]);

export function normalizeCanonicalAnswerLabel(value: string): string {
  return value
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function isGenericCanonicalAnswer(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = normalizeCanonicalAnswerLabel(value).toLowerCase();
  if (GENERIC_ANSWER_VALUES.has(normalized)) return true;
  return /^the answer\s+(?:is|was|would be)$/i.test(normalized);
}
