import { assertNever } from '@/lib/assert-never';

/** Question shape returned by /api/questions (matches Prisma Question) */
export type QuestionRecord = {
  id: string;
  creator_id: string;
  question_text: string;
  breadcrumb_context: string | null;
  answer_text: string;
  short_label: string | null;
  accepted_alternatives: string[];
  answer_source: string | null;
  question_type: string;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist' | null;
  minimum_required: number | null;
  category: string;
  category_overridden: boolean;
  creator_note: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  asked_count: number;
  correct_count: number;
  isOwnAuthored?: boolean;
  authorName?: string;
  isInBank?: boolean;
  bankedAt?: string;
  contribution_state?: 'addable' | 'already_added' | 'locked_permission' | 'locked_game_state';
};

// The provenance of a canonical Question, stored as free text() in
// schema.ts (NOT a pgEnum), so widening this union is a type-only change with no
// DB migration. The (source, creatorId) pair is the single provenance
// discriminator across the app:
//   - 'authored'        — a human wrote it (creatorId set)
//   - 'daily_generated' — LLM batch generation (creatorId null)
//   - 'curated_sent'    — a forwarded LLM question (creatorId null; B-2)
//   - 'house_authored'  — the labeled non-human house/editorial author (creatorId
//                         null; D-3). NOT LLM-origin — curated/editorial.
export const QUESTION_SOURCES = ['authored', 'daily_generated', 'curated_sent', 'house_authored'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

// Validate a raw DB string into the QuestionSource union at a trust boundary.
// Use this instead of an unchecked `as QuestionSource` cast so an unexpected
// stored value fails loudly rather than silently misrouting (e.g. a house
// question rendering as a person).
export function parseQuestionSource(value: string): QuestionSource {
  if ((QUESTION_SOURCES as readonly string[]).includes(value)) {
    return value as QuestionSource;
  }
  throw new Error(`Unknown Question.source: ${JSON.stringify(value)}`);
}

// Non-person, non-house attribution for LLM-origin questions
// (source 'daily_generated' | 'curated_sent'; creatorId === null). A machine
// question must never render a human name or imply a person wrote it.
// PLACEHOLDER COPY — flagged for product sign-off. Must NOT be "Joshing"/"Editorial"
// (those are the house identity below); this is for the non-house LLM origins.
export const LLM_QUESTION_ATTRIBUTION = 'Generated' as const;

// D-3 — the single, fixed house/editorial author identity. House questions carry
// creatorId === null + source 'house_authored'; this identity is resolved at
// RENDER from this constant, never from a users row. `id` is a sentinel string
// and must never be used as a users.id foreign key (Invariant H-1: house is
// unfollowable / unmatchable / mastery-ineligible by construction).
// displayName/label are PLACEHOLDER COPY pending product sign-off.
//
// House commentary (creator-notes/asides) must be editorial/curator voice and is
// NEVER relational — see docs/house-editorial-copy-checklist.md (D-3 §E). The
// render layer strips relational chrome; the note text is a review-gate concern.
export const HOUSE_AUTHOR = {
  id: 'house',
  displayName: 'Joshing',
  label: 'Editorial',
  kind: 'house',
} as const;

// True when an attribution name is the house label, mirroring isLlmAttribution.
// Lets Stage 2 consumers gate house-specific rendering without coupling to the
// literal display name.
export function isHouseAttribution(name: string | null | undefined): boolean {
  return name?.trim() === HOUSE_AUTHOR.displayName;
}

// Render-layer resolver for a question's display author from its provenance.
// This is the ONLY place the (creatorId, source) → author decision is made for
// house/LLM/human routing; Stage 2 wires every attribution surface through it.
//
//   - creatorId set                      → human author (hydrate the users row)
//   - (null, 'house_authored')           → the house identity constant
//   - (null, 'daily_generated' | 'curated_sent') → the non-person 'Generated'
//                                          treatment (B-5)
//
// The switch ends in assertNever, so a future source value cannot compile until
// it is routed here deliberately. No branch can resolve a house question to a
// users row or the 'A friend' fallback (Invariant H-1).
export type ResolvedQuestionAuthor<U> =
  | { kind: 'human'; user: U }
  | { kind: 'house'; displayName: string; label: string }
  | { kind: 'generated'; name: string };

export function resolveQuestionAuthor<U>(input: {
  creatorId: string | null;
  source: QuestionSource;
  user: U;
}): ResolvedQuestionAuthor<U> {
  if (input.creatorId !== null) {
    return { kind: 'human', user: input.user };
  }
  switch (input.source) {
    case 'house_authored':
      return { kind: 'house', displayName: HOUSE_AUTHOR.displayName, label: HOUSE_AUTHOR.label };
    case 'daily_generated':
    case 'curated_sent':
      return { kind: 'generated', name: LLM_QUESTION_ATTRIBUTION };
    case 'authored':
      // A null-creator 'authored' question is an inconsistent provenance pair;
      // treat it as non-person rather than inventing a human, and never as house.
      return { kind: 'generated', name: LLM_QUESTION_ATTRIBUTION };
    default:
      return assertNever(input.source, 'Question.source');
  }
}

// Server-side convenience for the many view-builders that carry an
// `authorName: string | null` field to the client. Collapses the resolver into
// the display name plus an explicit `authorIsHouse` flag, so a house question
// yields the house name AND a robust signal the client can badge on (Invariant
// H-2) WITHOUT the client string-matching the name (a human named "Joshing"
// must not be mistaken for the house author). Shaped for spreading straight
// into a view object: `{ ...resolveAuthorDisplay(creatorId, source, name) }`.
//   - human author      → { authorName: displayName, authorIsHouse: false }
//   - house             → { authorName: 'Joshing',   authorIsHouse: true  }
//   - LLM-origin / null  → { authorName: null,        authorIsHouse: false } (client renders 'Generated')
export function resolveAuthorDisplay(
  creatorId: string | null,
  source: QuestionSource,
  displayName: string | null,
): { authorName: string | null; authorIsHouse: boolean } {
  const resolved = resolveQuestionAuthor({ creatorId, source, user: displayName });
  switch (resolved.kind) {
    case 'human':
      return { authorName: resolved.user, authorIsHouse: false };
    case 'house':
      return { authorName: resolved.displayName, authorIsHouse: true };
    case 'generated':
      return { authorName: null, authorIsHouse: false };
    default:
      return assertNever(resolved, 'ResolvedQuestionAuthor');
  }
}

// True when an attribution name is the LLM/non-person label, used to gate
// person-style copy (e.g. "{name} gave you this") so it never fires for machine
// questions. Keeps consumers decoupled from the literal value above.
export function isLlmAttribution(name: string | null | undefined): boolean {
  return name?.trim() === LLM_QUESTION_ATTRIBUTION;
}

// The aside ("inside joke") label carries provenance: a relational label means a
// real person authored the question; the editorial label is for machine-authored
// (LLM-origin) questions, where there is no person and no relationship to imply.
export type InsideJokeKind = 'relational' | 'editorial';
export const INSIDE_JOKE_LABELS: Record<InsideJokeKind, string> = {
  relational: 'Between us friends',
  editorial: 'Between us!', // PLACEHOLDER copy — flagged for product sign-off
};

export const CATEGORIES = [
  'music',
  'literature',
  'history',
  'film_tv',
  'sport',
  'science',
  'philosophy',
  'pop_culture',
  'language',
  'general_knowledge',
] as const;

export const VISIBILITIES = ['private', 'public'] as const;

export const QUESTION_TYPES = ['factual', 'personal', 'ambiguous', 'factual_uncertain'] as const;

export const ANSWER_SOURCES = ['llm_suggested', 'creator_written', 'llm_edited'] as const;

export function categoryLabel(cat: string): string {
  return cat === 'film_tv'
    ? 'Film & TV'
    : cat === 'pop_culture'
      ? 'Pop Culture'
      : cat === 'general_knowledge'
        ? 'General Knowledge'
        : cat.charAt(0).toUpperCase() + cat.slice(1).replace('_', ' ');
}
