// Canonical answer vs. accepted variants — the split the answer key was missing.
//
// `GeneratedQuestion.acceptable_variants` and `Question.accepted_alternatives`
// have existed since B4 Phase 4, and grading reads both (exactMatch in
// src/server/grading.ts, plus the LLM grader's prompt). But NOTHING made the
// generator use them: the model was asked for a single `answer` string, so it
// packed every alternate phrasing into that one string —
//
//   "Lack of proportion (or 'failure of proportion')"
//   "Cannon (a peal of ordnance / guns)"
//
// — and the packed form is what landed in `answer`, what the grader compared
// against, and what the player's reply had to look like. Two costs:
//
//  1. GRADING is fuzzier than it needs to be. The canonical string is no longer
//     a thing anyone would type, so the deterministic exactMatch fast-path can
//     only miss and every such question falls through to the LLM grader.
//  2. The ANSWER-LEAK gates read the primary accepted form (see acceptedForms in
//     src/server/questions/self-answering.ts). A padded primary form is a longer
//     conjunction, and every extra word is another chance one is absent from the
//     stem — which is how the Joyce "petition for universal peace" question
//     survived: its answer padded in the word "calling".
//
// The generator is now asked for `answer` + `acceptable_variants` separately
// (Rule 3d in SYSTEM_PROMPT). This module is the deterministic backstop for when
// it ignores that — and for the bank sweep over rows generated before the rule
// existed: peel the packed alternates off the tail and hand back a canonical
// string plus the variants that were hiding inside it.
//
// SAFETY POSTURE: the ORIGINAL packed string is always kept as a variant, so a
// split can never make grading stricter than it is today — whatever the key used
// to accept, it still accepts. What a split CAN do is make it more lenient (an
// extra accepted form), which is why the peel is conservative and why
// disambiguating glosses are dropped rather than promoted to answers.

import { normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';

/** Cap on stored variants per answer. Parity with MAX_VARIANTS_PER_ITEM /
 *  MAX_VARIANT_LENGTH in src/server/daily/enrich-variants.ts — a key that grows
 *  without bound is a leniency surface, not a better key. */
export const MAX_ANSWER_VARIANTS = 4;
export const MAX_ANSWER_VARIANT_CHARS = 120;

// A TRAILING parenthetical: "Venus (Aphrodite)", "Cannon (a peal of ordnance)".
// Anchored so a LEADING parenthetical that is part of the title itself —
// "(I Can't Get No) Satisfaction", "(Sittin' On) The Dock of the Bay" — never
// matches: there the head before "(" is empty.
const TRAILING_PARENTHETICAL = /^(.*\S)\s*\(([^()]{1,120})\)$/;

// Alternates spelled inline: "Cannon / ordnance", "Cannon; ordnance".
// The slash form REQUIRES surrounding spaces so "and/or", "9/11", "km/h" and
// "AC/DC" — all of which are single answers, not alternates — stay whole.
const INLINE_ALTERNATES = /\s+\/\s+|\s*;\s+/;

// Lead-ins a model writes when it means "or you could say": stripped off a
// peeled piece so the variant is the phrasing itself, not the aside.
const VARIANT_LEAD_IN = /^(?:or\s+|aka\s+|a\.k\.a\.\s+|also\s+(?:known\s+as|called)\s+|i\.e\.\s+|e\.g\.\s+)/i;

// A peeled piece that DISAMBIGUATES rather than answers: an article plus one
// common noun — "(the planet)", "(the play)", "(a film)". Nobody types these as
// an answer, and promoting one to an accepted alternative would teach the
// grader to mark a bare category label correct forever. Dropped, not kept.
// A capitalized second word is a name, not a category ("the Balrog", "the
// Dane"), so it survives.
const DISAMBIGUATING_GLOSS = /^(?:[Tt]he|[Aa]n?)\s+[a-z][a-z'-]*$/;

function cleanPiece(piece: string): string {
  return normalizeCanonicalAnswerLabel(piece.replace(VARIANT_LEAD_IN, ''));
}

function hasSubstance(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

/**
 * Split one packed answer string into the canonical answer plus the accepted
 * variants that were packed into it.
 *
 * Returns the input unchanged (and no variants) when there is nothing safe to
 * peel — which is the common case and the intended one for a model that follows
 * Rule 3d. `variants` always ends with the ORIGINAL string when a peel happened,
 * so the key never loses what it already accepted.
 */
export function splitPackedAnswer(raw: string): { answer: string; variants: string[] } {
  const original = normalizeCanonicalAnswerLabel(raw);
  if (!original) return { answer: original, variants: [] };

  const pieces: string[] = [];
  let head = original;

  // Peel trailing parentheticals repeatedly: "X (Y) (Z)" is rare but real.
  for (let depth = 0; depth < MAX_ANSWER_VARIANTS; depth += 1) {
    const match = head.match(TRAILING_PARENTHETICAL);
    if (!match) break;
    const [, before, inner] = match;
    const candidateHead = normalizeCanonicalAnswerLabel(before);
    // A head that is not itself an answer ("(GPU)" alone, punctuation) means the
    // parenthetical was the substance — leave the string whole.
    if (!hasSubstance(candidateHead)) break;
    head = candidateHead;
    pieces.push(...inner.split(INLINE_ALTERNATES));
  }

  // Alternates spelled inline in what remains: the FIRST is the canonical one,
  // matching acceptedForms' treatment of the primary form.
  const inline = head.split(INLINE_ALTERNATES);
  if (inline.length > 1) {
    const candidateHead = normalizeCanonicalAnswerLabel(inline[0]);
    if (hasSubstance(candidateHead)) {
      head = candidateHead;
      pieces.push(...inline.slice(1));
    }
  }

  if (pieces.length === 0 || head === original) return { answer: original, variants: [] };

  const seen = new Set<string>([head.toLowerCase()]);
  const variants: string[] = [];
  const add = (value: string) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    if (value.length > MAX_ANSWER_VARIANT_CHARS) return;
    seen.add(key);
    variants.push(value);
  };

  for (const piece of pieces) {
    const cleaned = cleanPiece(piece);
    if (!hasSubstance(cleaned)) continue;
    if (DISAMBIGUATING_GLOSS.test(cleaned)) continue;
    add(cleaned);
  }
  // The packed original, last: it is what the key accepted before this split, so
  // keeping it makes the change strictly non-regressive for grading.
  add(original);

  return { answer: head, variants: variants.slice(0, MAX_ANSWER_VARIANTS) };
}

/**
 * Normalize a variants list for storage: trim, drop empties and over-long
 * entries, dedup case-insensitively against each other AND against the canonical
 * answer, cap the count. Used for both the model-emitted `acceptable_variants`
 * field and the peeled ones.
 */
export function normalizeAnswerVariants(
  values: readonly unknown[] | unknown,
  canonicalAnswer: string,
): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>([normalizeCanonicalAnswerLabel(canonicalAnswer).toLowerCase()]);
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const cleaned = cleanPiece(value);
    if (!hasSubstance(cleaned) || cleaned.length > MAX_ANSWER_VARIANT_CHARS) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_ANSWER_VARIANTS) break;
  }
  return out;
}
