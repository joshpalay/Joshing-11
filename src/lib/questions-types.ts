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
  contribution_state?: 'addable' | 'already_added' | 'locked_permission' | 'locked_game_state';
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
  'other',
] as const;

export const VISIBILITIES = ['private', 'public'] as const;

export const QUESTION_TYPES = ['factual', 'personal', 'ambiguous', 'factual_uncertain'] as const;

export const ANSWER_SOURCES = ['llm_suggested', 'creator_written', 'llm_edited'] as const;

export function categoryLabel(cat: string): string {
  return cat === 'film_tv'
    ? 'Film & TV'
    : cat === 'pop_culture'
      ? 'Pop Culture'
      : cat.charAt(0).toUpperCase() + cat.slice(1).replace('_', ' ');
}
