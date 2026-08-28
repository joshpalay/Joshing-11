/**
 * Phase 2 of B-QUESTION-QUALITY-AGENTS-01 — the PURE, zero-LLM pre-filter.
 *
 * The verification sweep is the expensive part (an LLM call, plus an occasional
 * web search), so this decides — with NO network and NO model call — whether a
 * question needs verification at all and, if so, which of the two dimensions
 * (Decision B) apply:
 *   - false_premise: the question's SETUP asserts a fact that could be untrue —
 *                    or its INTERROGATIVE presupposes one (asking "what kind of X
 *                    did they plan" when the source only ever raises X and never
 *                    settles it). Both are handled by the same dimension; see the
 *                    false_premise prose in verify-question.ts.
 *   - extra_fact:    the answer or its explanation carries an unasked / adjacent
 *                    claim, even when the answer itself is right.
 *   - self_answering: the stem gives the answer away. The deterministic gate
 *                    (findAnswerLeaks / textContainsAnswer) already DROPS the
 *                    leaks a string test can prove; this dimension exists for the
 *                    ones it cannot — above all the eponym trap, where the stem
 *                    names a work after the person it then asks you to name
 *                    ("the 'Razumovsky' quartets … what was that patron's
 *                    name?"). Like ambiguous_source it is a judgment about the
 *                    TEXT and needs no web search.
 *
 * Stable canonical facts (a bare "what/who is X" over a settled fact with no
 * embedded claim) and opinion-adjacent items are SKIPPED — they never reach a web
 * call. This is the main spend-saver. It is deliberately conservative: when a stem
 * carries assertion signals it routes TO verification rather than guessing, so the
 * skip set is only the clearly-safe. Over-routing costs a cheap LLM call; the
 * web-search fallback (Phase 3) is itself gated on the model failing to resolve
 * from knowledge, so a skip here is the only place spend is truly saved.
 *
 * Pure and deterministic by contract (unit-tested): no I/O, no imports with side
 * effects. (self-answering.ts is itself import-free and side-effect-free, so the
 * self_answering route does not break that contract.) The batch-verify route
 * (Phase 3) calls this first and only proceeds to the LLM for
 * `needsVerification: true`.
 */

import { textContainsAnswer } from '@/server/questions/self-answering';

export type VerificationDimension =
  | 'false_premise'
  | 'extra_fact'
  | 'ambiguous_source'
  | 'self_answering';

export type PrefilterInput = {
  questionText: string;
  answer: string;
  /** factual_explanation / explainer prose that may carry adjacent claims. */
  explanation?: string | null;
  /**
   * The domain the question belongs to (canonical_subcategory). Load-bearing ONLY
   * for the ambiguous_source (self-containment) check: the served card shows the
   * player the question text + a BROAD category, never this subcategory, so a
   * fiction/franchise question that never names its own source reads as broken.
   * When omitted the ambiguous_source route is inert (existing callers/tests keep
   * their exact behavior); the cron threads it through.
   */
  canonicalSubcategory?: string | null;
};

export type PrefilterDecision =
  | { needsVerification: false; verdict: 'skipped'; reason: string }
  | { needsVerification: true; dimensions: VerificationDimension[]; reason: string };

const WORD_NUMBERS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|dozen';

// Assertion-signal categories: tokens that mark a factual CLAIM — a date, a count,
// a superlative/ordinal, a recurrence/universality, an attribution/relationship,
// or a work-location. A premise that embeds any of these is checkable and can be
// wrong. (The minor "dates/counts/superlatives" case from Decision B lives here as
// signals, not as the organizing trigger.)
const SIGNAL_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'year', re: /\b(1\d{3}|20\d{2})\b/ },
  {
    kind: 'date',
    re: /\b(january|february|march|april|june|july|august|september|october|november|december)\b/i,
  },
  { kind: 'count', re: new RegExp(`\\b(\\d+|${WORD_NUMBERS})\\s+\\w+`, 'i') },
  { kind: 'ordinal', re: /\b(\d+(st|nd|rd|th)|first|second|third|fourth|fifth|last|final)\b/i },
  {
    kind: 'superlative',
    re: /\b(only|sole|largest|biggest|smallest|longest|shortest|highest|lowest|oldest|youngest|most|fewest|greatest)\b/i,
  },
  {
    kind: 'recurrence',
    re: /\b(recurring|recurrent|always|every|each|never|repeatedly|throughout)\b/i,
  },
  {
    kind: 'attribution',
    re: /\b(written|composed|directed|invented|founded|created|painted|designed|discovered|authored)\s+by\b/i,
  },
  {
    kind: 'relationship',
    re: /\b(son|daughter|father|mother|grandfather|grandmother|wife|husband|brother|sister|cousin|nephew|niece|uncle|aunt)\s+of\b|\bdoubles\s+as\b|\balso\s+known\s+as\b/i,
  },
  {
    kind: 'work_location',
    re: /\b(book|chapter|volume|season|episode|act|part|canto|movement)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivxl]+)\b/i,
  },
];

function signalKinds(text: string): Set<string> {
  const kinds = new Set<string>();
  for (const { kind, re } of SIGNAL_PATTERNS) if (re.test(text)) kinds.add(kind);
  return kinds;
}

// Abbreviations whose trailing period is NOT a sentence end. Without this,
// "Dr. Smith wrote which novel?" would split into two "sentences".
const ABBREVIATION_END_RE = /\b(mr|mrs|ms|dr|st|jr|sr|prof|vs|no|fig|est|approx|etc)\.$/i;

// A stem carrying a complete SENTENCE before its ask is setup by definition —
// however short either half is. Added 2026-08-07 after the reported Macbeth
// presupposition stem ("…the three witches open the play by agreeing to meet
// again after a battle. In what kind of weather do they plan to reconvene?")
// slipped past every other test below: no dash, only two comma-clauses, and 27
// words — ONE under the length floor. It scored as a bare ask and skipped
// verification outright, so the verifier never got to judge it. Sentence count
// is the structural signal the other three were approximating by proxy.
function hasSentenceLevelSetup(stem: string): boolean {
  const parts = stem.split(/(?<=[.!?])\s+(?=["'“‘(]?[A-Z])/);
  let sentences = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    // An abbreviation-final chunk is the head of the FOLLOWING sentence, not a
    // sentence of its own — skip it so the pair counts once.
    if (!trimmed || ABBREVIATION_END_RE.test(trimmed)) continue;
    sentences += 1;
  }
  return sentences >= 2;
}

// A SETUP clause = the stem says something beyond the bare interrogative: a
// dash-delimited aside, three-plus comma/semicolon clauses, a preceding complete
// sentence, or simply a long stem. Bare asks ("What is the capital of France?",
// "Who was the first president?") have none of these, so an isolated signal word
// in a bare ask does not route to verify.
function hasSetupClause(stem: string): boolean {
  const wordCount = stem.trim().split(/\s+/).filter(Boolean).length;
  const clauses = stem
    .split(/[—–]| - |,|;|:/)
    .map((c) => c.trim())
    .filter(Boolean);
  return (
    /[—–]| - /.test(stem) || clauses.length >= 3 || wordCount >= 28 || hasSentenceLevelSetup(stem)
  );
}

const OPINION_RE =
  /\b(favou?rite|best|worst|most beautiful|most overrated|greatest ever|coolest|prettiest|your opinion|do you (think|prefer))\b/i;

function isOpinionAdjacent(text: string): boolean {
  return OPINION_RE.test(text);
}

// ─── ambiguous_source (self-containment) routing ─────────────────────────────
// A question about a specific named work/franchise that never NAMES that source
// in its own text is unanswerable when served: the card shows the player only
// the question text and a broad category (e.g. "Film & Television"), never the
// canonical_subcategory. "At the start of most episodes, Candace notices the
// boys' project…" is broken — nothing says it is Phineas and Ferb. This is a
// demote-worthy defect distinct from any factual error, so it gets its own
// dimension. The verifier makes the final, semantic call; this pure router only
// decides which rows are worth that (free-on-already-routed) check.

// English stopwords + bare interrogative/scaffolding openers that a capitalized
// first letter does NOT make a proper noun. Kept small and lowercase.
const SELF_CONTAINMENT_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'by',
  'with',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'why',
  'how',
  'this',
  'that',
  'these',
  'those',
  'after',
  'before',
  'during',
  'is',
  'are',
  'was',
  'were',
]);

// Significant (≥3-char, non-stopword) lowercased tokens of a label.
function significantTokens(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !SELF_CONTAINMENT_STOPWORDS.has(t));
}

// True when at least one of the subcategory's significant tokens appears as a
// whole word in the stem — i.e. the question lexically NAMES its own source
// (possibly via an alias the subcategory string also contains: "In Ulysses…"
// matches "James Joyce's Ulysses"). Such a question is self-contained; skip it.
function stemNamesSubject(stem: string, subjectTokens: string[]): boolean {
  const lowerStem = ` ${stem.toLowerCase()} `;
  return subjectTokens.some((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`).test(lowerStem));
}

// True when the stem references a mid-text proper noun (a named character,
// place, or work) that is NOT one of the subject's own tokens — the tell that a
// question is leaning on a specific fictional world it never names. Excludes the
// very first token of each sentence (a sentence-initial capital is usually just
// the opener, "What"/"At"/"Which") and common openers via the stopword set.
function hasForeignProperNoun(stem: string, subjectTokens: string[]): boolean {
  const subjectSet = new Set(subjectTokens);
  // Split into sentences so we can drop each sentence's first word.
  for (const sentence of stem.split(/[.!?]+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i += 1) {
      const stripped = words[i].replace(/[^A-Za-z']/g, '');
      if (stripped.length < 3) continue;
      if (!/^[A-Z][a-z]/.test(stripped)) continue; // not a proper-noun shape
      const lower = stripped.toLowerCase();
      if (SELF_CONTAINMENT_STOPWORDS.has(lower)) continue;
      if (subjectSet.has(lower)) continue; // names the subject → not "foreign"
      return true;
    }
  }
  return false;
}

// Overlap scoring for isSelfAnsweringCandidate. Kept local (and coarse) so the
// module stays pure: same normalization shape as self-answering.ts, but the only
// job here is deciding whether to spend an LLM call.
const OVERLAP_MIN_TOKEN_LENGTH = 4;
const OVERLAP_STOPWORDS = new Set([
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
  'what',
  'which',
  'who',
]);

function normalizeForOverlap(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Route ambiguous_source when the question is about a specific named subject
// (subcategory provided, with real tokens) that the stem does NOT name, yet the
// stem leans on a foreign proper noun. Inert without a subcategory so existing
// callers/tests are unaffected.
export function isAmbiguousSourceCandidate(
  stem: string,
  canonicalSubcategory: string | null | undefined,
): boolean {
  if (!canonicalSubcategory) return false;
  const subjectTokens = significantTokens(canonicalSubcategory);
  if (subjectTokens.length === 0) return false;
  if (stemNamesSubject(stem, subjectTokens)) return false;
  return hasForeignProperNoun(stem, subjectTokens);
}

// Route self_answering when the stem already shows a DISCRIMINATING piece of the
// answer — but not so much of it that the deterministic gate would have dropped
// the row outright (textContainsAnswer is the drop; this is the suspicion).
//
// Two shapes qualify, both measured against the live bank (2026-08-27):
//   - a shared PROPER NOUN, i.e. a capitalized word of the answer that is not
//     merely its first word (sentence case) and that the stem also contains.
//     This is the eponym signature: "Andrey Razumovsky (Count Razumovsky)"
//     against a stem quoting the 'Razumovsky' quartets.
//   - two-plus shared load-bearing words, where the overlap is too broad to be
//     coincidence.
//
// Deliberately NOT "any shared word": that routed 44 of the 126 otherwise-skipped
// bank rows, almost all on common nouns the stem has to use to pose the question
// at all ("cognitive", "product"). The tightened form routes 16 — and since this
// dimension attaches no web-search tool, those are the cheap knowledge-only calls,
// not the ~24x searching kind.
export function isSelfAnsweringCandidate(stem: string, answer: string): boolean {
  if (!stem || !answer) return false;
  // Already provable by string test → the gate drops it; no LLM call needed.
  if (textContainsAnswer(stem, answer)) return false;

  const haystack = ` ${normalizeForOverlap(stem)} `;
  const words = answer.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  let shared = 0;
  let sharedProperNoun = false;
  words.forEach((word, i) => {
    const token = normalizeForOverlap(word);
    if (token.length < OVERLAP_MIN_TOKEN_LENGTH || OVERLAP_STOPWORDS.has(token)) return;
    if (!haystack.includes(` ${token} `)) return;
    shared += 1;
    if (i > 0 && /^\p{Lu}/u.test(word)) sharedProperNoun = true;
  });
  return sharedProperNoun || shared >= 2;
}

// LEGACY (pre-2026-07-05): substance ≈ claims — ≥60 chars AND (any one signal OR
// ≥140 chars). MEASURED as the dominant ~90% router (cost-characterization §5
// retraction): trivia explainers nearly always clear one of those bars — every
// explainer mentions a year or runs long — so extra_fact routed almost every row
// and the pre-filter skipped only ~9%. Kept callable for the escape hatch and
// the before/after measurement script.
export function explanationCarriesClaimsLegacy(explanation: string | null | undefined): boolean {
  if (!explanation) return false;
  const trimmed = explanation.trim();
  if (trimmed.length < 60) return false; // too short to carry an independent claim
  return signalKinds(trimmed).size >= 1 || trimmed.length >= 140;
}

// TIGHTENED (2026-07-05): length is prose, not a claim — and a single signal of
// the same KIND the question/answer already carries is context (restating the
// asked fact), not an ADJACENT claim. Route only when the explanation asserts
// something checkable BEYOND the question+answer:
//   - a signal kind ABSENT from stem+answer (a genuinely new claim category —
//     e.g. the question asks a "who" and the explainer volunteers a date), or
//   - two-plus distinct signal kinds (a claim-dense explainer — where wrong
//     adjacent facts live).
// Kind-level comparison is deliberately coarse (stem 1804 / explainer 1799 both
// read as 'year' and would skip) — this is a demote-only BACKGROUND net behind
// the factual gate and ask-to-answer, and the spend guarantee only pays out on
// skips. The measurement script prints route→skip flips for eyeballing.
// signalKinds with the year/count double-fire collapsed: the 'count' pattern
// greedily matches ANY number followed by a word — including the year itself
// ("in 1912 after…") — so every explainer mentioning a year read as two kinds
// (year + count) and looked claim-dense. Keep 'count' only when a NON-year
// number (or word-number) also matches. Local to the explanation path — the
// stem/premise router keeps the original, deliberately conservative behavior.
function effectiveKinds(text: string): Set<string> {
  const kinds = signalKinds(text);
  if (kinds.has('year') && kinds.has('count')) {
    const withoutYears = text.replace(/\b(1\d{3}|20\d{2})\b/g, ' ');
    if (!new RegExp(`\\b(\\d+|${WORD_NUMBERS})\\s+\\w+`, 'i').test(withoutYears)) {
      kinds.delete('count');
    }
  }
  return kinds;
}

export function explanationCarriesAdjacentClaims(
  explanation: string | null | undefined,
  stem: string,
  answer: string,
): boolean {
  if (!explanation) return false;
  const trimmed = explanation.trim();
  if (trimmed.length < 60) return false; // too short to carry an independent claim
  const explKinds = effectiveKinds(trimmed);
  if (explKinds.size === 0) return false; // pure prose — nothing checkable
  if (explKinds.size >= 2) return true; // claim-dense
  const contextKinds = effectiveKinds(`${stem} ${answer}`);
  for (const kind of explKinds) if (!contextKinds.has(kind)) return true; // novel kind
  return false;
}

// The answer bundles an extra descriptor ("Eroica (Beethoven's Third, dedicated to
// Napoleon)") rather than a single clean token — a place an adjacent claim can be
// wrong even when the headline answer is right.
//
// LEGACY (pre-tightening, 2026-07): any structural separator routed. Measured
// over-broad — 91% of rows routed, extra_fact on ~90%, because "a comma + a word"
// matches most multi-word answers (batch-verify-cost-characterization.md §2).
// Kept callable for the legacy escape hatch and the before/after measurement
// script; the default is answerCarriesAdjacentClaim below.
export function answerIsMultiFact(answer: string): boolean {
  return /[(;]/.test(answer) || /,\s+\w/.test(answer) || /\s+and\s+/i.test(answer);
}

// TIGHTENED (2026-07): bundling alone is structure, not a claim — "Bread, Eggs
// and Milk" separates items; it asserts nothing checkable. Route only when the
// bundled answer ALSO carries an assertion signal (year/count/ordinal/superlative/
// attribution/…): the same signal taxonomy false_premise uses on the stem. This is
// the "stronger adjacent-claim signal" the cost characterization recommended; the
// explanation path (explanationCarriesClaims) is unchanged, so claim-bearing
// explainers still route regardless of the answer's shape.
export function answerCarriesAdjacentClaim(answer: string): boolean {
  if (!answerIsMultiFact(answer)) return false;
  return signalKinds(answer).size >= 1;
}

export type PrefilterOptions = {
  /**
   * Use the pre-2026-07 answer heuristic (any comma/paren/"and" routes extra_fact).
   * Operational escape hatch only — the cron passes this from
   * PREFILTER_EXTRA_FACT_LEGACY; the measurement script uses it for the
   * before/after comparison. Default false (tightened heuristic).
   */
  legacyExtraFact?: boolean;
  /**
   * Use the pre-2026-07-05 explanation heuristic (any one signal OR length ≥140
   * routes — the measured ~90% router). Operational escape hatch only — the cron
   * passes this from PREFILTER_EXPLANATION_LEGACY; the measurement script uses it
   * for the before/after comparison. Default false (adjacent-claims heuristic).
   */
  legacyExplanation?: boolean;
};

/**
 * Decide, purely, whether a question needs verification and on which dimension(s).
 * Never performs I/O. A `needsVerification: false` result MUST short-circuit the
 * caller before any LLM / web call (the spend guarantee Phase 2's tests enforce).
 */
export function prefilterForVerification(
  input: PrefilterInput,
  options?: PrefilterOptions,
): PrefilterDecision {
  const stem = input.questionText ?? '';
  const answer = input.answer ?? '';

  // Opinion-adjacent items are not factually verifiable at all → skip outright.
  if (isOpinionAdjacent(stem) || isOpinionAdjacent(answer)) {
    return {
      needsVerification: false,
      verdict: 'skipped',
      reason: 'opinion-adjacent (not factually verifiable)',
    };
  }

  const dimensions: VerificationDimension[] = [];

  // false_premise: the stem embeds a checkable claim in a real setup clause (a lone
  // signal word in a bare ask is the ANSWER, not a premise, so it needs a setup
  // clause to count) — or it carries two-plus independent signals.
  const stemSignals = signalKinds(stem);
  const premiseBearing = (hasSetupClause(stem) && stemSignals.size >= 1) || stemSignals.size >= 2;
  if (premiseBearing) dimensions.push('false_premise');

  // extra_fact: the explanation or the answer carries adjacent claims. The answer
  // side requires bundling + an assertion signal (tightened 2026-07); the
  // explanation side requires a NOVEL or claim-dense assertion (tightened
  // 2026-07-05 — the measured ~90% router). Each has its own legacy hatch.
  const answerRoutes = options?.legacyExtraFact
    ? answerIsMultiFact(answer)
    : answerCarriesAdjacentClaim(answer);
  const explanationRoutes = options?.legacyExplanation
    ? explanationCarriesClaimsLegacy(input.explanation)
    : explanationCarriesAdjacentClaims(input.explanation, stem, answer);
  if (explanationRoutes || answerRoutes) {
    dimensions.push('extra_fact');
  }

  // ambiguous_source: the question is about a specific named subject it never
  // names in its own text (self-containment defect). Independent of the factual
  // routes — a question can be factually clean yet unanswerable out of context.
  if (isAmbiguousSourceCandidate(stem, input.canonicalSubcategory)) {
    dimensions.push('ambiguous_source');
  }

  // self_answering: the stem hands over a discriminating piece of the answer in a
  // way no string test can prove. Independent of every route above — a question
  // can be factually spotless and self-contained and still answer itself.
  if (isSelfAnsweringCandidate(stem, answer)) {
    dimensions.push('self_answering');
  }

  if (dimensions.length === 0) {
    return {
      needsVerification: false,
      verdict: 'skipped',
      reason: 'bare ask over a stable canonical fact; no embedded premise or adjacent claim',
    };
  }

  return {
    needsVerification: true,
    dimensions,
    reason: `routed: ${dimensions.join(', ')}`,
  };
}
