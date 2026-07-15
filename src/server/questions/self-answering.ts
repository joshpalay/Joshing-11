const MIN_ANSWER_TOKEN_LENGTH = 3;
const COMBINING_DIACRITICS = /[̀-ͯ]/g;
// Leading article on an otherwise-normalized answer. An article-led answer
// ("A fly", "The box cutter") will not substring-match a question that names
// the bare noun ("the episode 'Fly'"), so we strip it and re-test the core.
const LEADING_ARTICLE = /^(?:a|an|the) /;

// A run of Capitalized expansion words immediately followed by a parenthetical
// acronym: "User Experience (UX)". When an answer spells out an acronym it also
// shows ("User Experience (UX) design"), the whole-answer substring test misses
// a question that shows only the SHORT form ("In UX design, what term…") because
// the question never contains the expansion ("User Experience"). Collapsing the
// expansion down to the acronym recovers the short form ("UX design") so it can
// substring-match. We do NOT verify the acronym's letters against the expansion:
// UX = User eXperience shows the acronym need not be strict initials, so a
// parenthetical acronym sitting after a capitalized run is signal enough. The
// acronym must be ALL-UPPERCASE (2–8 letters) so a lowercase prose aside like
// "(in)" or "(the)" inside an answer can never be mistaken for one.
const ACRONYM_EXPANSION = /(?:\b[A-Z][A-Za-z.'-]*\s*){1,6}\(([A-Z]{2,8})\)/;

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

// "User Experience (UX) design" → "UX design": collapse the expansion words
// preceding a parenthetical acronym down to the acronym alone. Returns the
// NORMALIZED short form, or null when no such pattern exists / it collapses to a
// bare acronym. Operates on the RAW candidate (before normalize strips the
// parentheses and capitalization the pattern needs).
//
// CRITICAL guard against false demotes: we only return a short form when it is
// the acronym PLUS at least one trailing token (≥ 2 normalized tokens). An
// answer that is just an expansion of a bare acronym ("Graphics Processing Unit
// (GPU)", "Franklin D. Roosevelt (FDR)") collapses to the bare acronym, and a
// legitimate "what does GPU stand for?" / "which president is known as FDR?"
// question MUST show that acronym — flagging it would delete a good question.
// Requiring a trailing token means we only fire when the question contains the
// answer's full short phrase ("UX design"), which is a genuine leak.
function acronymShortForm(candidate: string): string | null {
  const match = candidate.match(ACRONYM_EXPANSION);
  if (!match) return null;
  const collapsed = candidate.replace(match[0], match[1]);
  if (collapsed === candidate) return null;
  const normalized = normalize(collapsed);
  if (!normalized.includes(' ')) return null; // bare acronym → not a leak signal
  return normalized;
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
  // "User Experience (UX) design" leaks into "In UX design, what term…": the
  // question shows the acronym short form even though the answer spells it out.
  // acronymShortForm already returns the normalized, multi-token form (or null).
  const shortForm = acronymShortForm(candidate);
  if (shortForm && containsNormalizedAnswer(normalizedQuestion, shortForm)) {
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
