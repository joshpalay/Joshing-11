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

// Non-person, non-house attribution for LLM-origin questions
// (source 'daily_generated' | 'curated_sent'; creatorId === null). A machine
// question must never render a human name or imply a person wrote it.
// PLACEHOLDER COPY — flagged for product sign-off. Must NOT be "Joshing"/"Editorial"
// (those are the house identity, owned by D-3); this is for the non-house LLM origins.
export const LLM_QUESTION_ATTRIBUTION = 'Generated' as const;

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
