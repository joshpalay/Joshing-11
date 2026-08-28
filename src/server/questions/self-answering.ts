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

// --- Accepted-form leak detection (the "Razumovsky" class) -------------------
//
// The whole-answer test above is ONE-DIRECTIONAL and ORDER-SENSITIVE: it fires
// only when the question contains the answer string end-to-end. That misses the
// most common real leak shape, where the answer is written as a name plus its
// accepted variants and the question hands over the discriminating word:
//
//   Q: "Beethoven dedicated his three 'Razumovsky' string quartets, Op. 59, to a
//       Russian patron ... What was that patron's name?"
//   A: "Andrey Razumovsky (Count Razumovsky)"
//
// "Andrey Razumovsky (Count Razumovsky)" is not a substring of that question, so
// the gate passed it — three separate times (fact_key
// beethoven-op59-razumovsky-patron-identity, generated 2026-06-24 / 08-20 /
// 08-27, served 2026-08-27). The player can read the answer straight off the
// stem.
//
// The fix reads an answer written "X (Y)" or "X / Y" as a declaration that Y is
// an ACCEPTED way to answer, then asks of each accepted form: are all of its
// load-bearing words already in the question? "Count Razumovsky" reduces to
// {razumovsky} once the honorific is dropped — and the question shows it.
//
// Deliberately conservative, because this gate DROPS questions:
//  - Only load-bearing words count. Articles, copulas, prepositions and
//    honorifics ("Count", "Sir", "Dr") are not the answer, so they neither
//    trigger a match nor block one.
//  - EVERY load-bearing word of the form must be present. "Locutus of Borg"
//    keeps {locutus, borg}; a question naming only the Borg still withholds
//    "Locutus", so it is not a leak. Same for "Enfield Tennis Academy" against a
//    stem that says "Boston tennis academy".
//  - Bare ALL-CAPS acronyms are skipped, preserving the guard documented above
//    on acronymShortForm: "what does GPU stand for?" must survive an answer
//    written "Graphics Processing Unit (GPU)".

// Words that are never the substance of an answer: they must not make a form
// match on their own, and their absence from the question must not save a form
// that is otherwise fully present. Honorifics matter most here — "Count
// Razumovsky" is the same answer as "Razumovsky".
const NON_SUBSTANTIVE = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'in',
  'on',
  'at',
  'to',
  'for',
  'from',
  'by',
  'with',
  'as',
  'is',
  'was',
  'were',
  'be',
  'been',
  'his',
  'her',
  'its',
  'their',
  'this',
  'that',
  'also',
  'known',
  'called',
  'aka',
  'eg',
  'ie',
  'etc',
  'mr',
  'mrs',
  'ms',
  'dr',
  'sir',
  'lord',
  'lady',
  'count',
  'countess',
  'baron',
  'duke',
  'prince',
  'princess',
  'king',
  'queen',
  'saint',
  'st',
  'general',
  'captain',
  'colonel',
  'major',
  'professor',
  'doctor',
  'president',
  'pope',
]);

const BARE_ACRONYM = /^[A-Z]{2,8}$/;

// "Andrey Razumovsky (Count Razumovsky)" -> ["Andrey Razumovsky", "Count Razumovsky"]
// Parentheticals are lifted out BEFORE splitting on "/" so a slash inside a
// parenthetical ("subprime (mortgages / loans)") cannot strand a bracket.
function acceptedForms(answer: string): string[] {
  const forms = new Set<string>();
  const parentheticals: string[] = [];
  const outside = answer.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    parentheticals.push(inner);
    return ' ';
  });
  for (const chunk of [outside, ...parentheticals]) {
    for (const part of chunk.split(/\s*\/\s*|\s*;\s*/)) {
      const trimmed = part.trim();
      if (trimmed && !BARE_ACRONYM.test(trimmed)) forms.add(trimmed);
    }
  }
  return [...forms];
}

// The words of a form that actually carry the answer, normalized.
function substantiveTokens(form: string): string[] {
  return normalize(form)
    .split(' ')
    .filter((t) => t.length >= MIN_ANSWER_TOKEN_LENGTH && !NON_SUBSTANTIVE.has(t));
}

// Is this accepted form specific enough that finding all of it in the question
// means something? Measured against the live bank, "all words present" ALONE
// fires constantly on short generic answers whose words any stem would naturally
// contain — "Book I" against "in which book…", "8 feet" against "how long … in
// feet", "his mother" against a stem that weighs mother against father, "It
// fails" against "does the motion pass or fail". None of those are leaks, and
// dropping them would cost real questions.
//
// A form earns the check two ways:
//  - it carries a PROPER NOUN (capitalized, and not merely the form's first word,
//    which is just sentence case) — "Count Razumovsky", "the Balrog", "Oh!
//    Streetcar". A rare name in the stem is a genuine tell; a common noun is not.
//  - or it is long enough that a full match cannot be coincidence (3+ substantive
//    words) — "Social facilitation of eating", "Assumes facts not in evidence".
//
// Two-word all-lowercase forms are deliberately left alone: that is where the
// quote-inversion style lives ("In my beginning is my end" → "In my end is my
// beginning"), and flagging it would drop a question whose whole point is that
// the stem shows the words in the other order.
function isDiscriminating(form: string, tokens: string[]): boolean {
  if (tokens.length >= 3) return true;
  const words = form.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''));
  return words.some(
    (w, i) => i > 0 && /^\p{Lu}/u.test(w) && normalize(w).length >= MIN_ANSWER_TOKEN_LENGTH,
  );
}

// True when the question already shows every load-bearing word of some accepted
// form of the answer, and that form is specific enough for the match to mean
// something.
function acceptedFormLeaks(normalizedQuestion: string, answer: string): boolean {
  const padded = ` ${normalizedQuestion} `;
  for (const form of acceptedForms(answer)) {
    const tokens = substantiveTokens(form);
    if (tokens.length === 0 || !isDiscriminating(form, tokens)) continue;
    if (tokens.every((t) => padded.includes(` ${t} `))) return true;
  }
  return false;
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
  // "Andrey Razumovsky (Count Razumovsky)" leaks into a stem that quotes the
  // 'Razumovsky' quartets: the accepted form "Count Razumovsky" reduces to the
  // one load-bearing word the question already shows. See the block comment
  // above acceptedForms for why this is the order-insensitive counterpart to
  // the whole-answer test.
  if (acceptedFormLeaks(normalizedQuestion, candidate)) return true;
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
