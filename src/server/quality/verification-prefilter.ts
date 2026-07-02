/**
 * Phase 2 of B-QUESTION-QUALITY-AGENTS-01 — the PURE, zero-LLM pre-filter.
 *
 * The verification sweep is the expensive part (an LLM call, plus an occasional
 * web search), so this decides — with NO network and NO model call — whether a
 * question needs verification at all and, if so, which of the two dimensions
 * (Decision B) apply:
 *   - false_premise: the question's SETUP asserts a fact that could be untrue.
 *   - extra_fact:    the answer or its explanation carries an unasked / adjacent
 *                    claim, even when the answer itself is right.
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
 * effects. The batch-verify route (Phase 3) calls this first and only proceeds to
 * the LLM for `needsVerification: true`.
 */

export type VerificationDimension = 'false_premise' | 'extra_fact';

export type PrefilterInput = {
  questionText: string;
  answer: string;
  /** factual_explanation / explainer prose that may carry adjacent claims. */
  explanation?: string | null;
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

// A SETUP clause = the stem says something beyond the bare interrogative: a
// dash-delimited aside, three-plus comma/semicolon clauses, or simply a long stem.
// Bare asks ("What is the capital of France?", "Who was the first president?") have
// none of these, so an isolated signal word in a bare ask does not route to verify.
function hasSetupClause(stem: string): boolean {
  const wordCount = stem.trim().split(/\s+/).filter(Boolean).length;
  const clauses = stem
    .split(/[—–]| - |,|;|:/)
    .map((c) => c.trim())
    .filter(Boolean);
  return /[—–]| - /.test(stem) || clauses.length >= 3 || wordCount >= 28;
}

const OPINION_RE =
  /\b(favou?rite|best|worst|most beautiful|most overrated|greatest ever|coolest|prettiest|your opinion|do you (think|prefer))\b/i;

function isOpinionAdjacent(text: string): boolean {
  return OPINION_RE.test(text);
}

// The explanation carries adjacent claims when it is more than a terse restatement
// of the answer — long enough to assert something of its own, with assertion
// signals or substantial independent prose.
function explanationCarriesClaims(
  explanation: string | null | undefined,
  _answer: string,
): boolean {
  if (!explanation) return false;
  const trimmed = explanation.trim();
  if (trimmed.length < 60) return false; // too short to carry an independent claim
  return signalKinds(trimmed).size >= 1 || trimmed.length >= 140;
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
  // side requires bundling + an assertion signal (tightened 2026-07) unless the
  // legacy escape hatch is on.
  const answerRoutes = options?.legacyExtraFact
    ? answerIsMultiFact(answer)
    : answerCarriesAdjacentClaim(answer);
  if (explanationCarriesClaims(input.explanation, answer) || answerRoutes) {
    dimensions.push('extra_fact');
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
