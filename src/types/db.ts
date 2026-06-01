import type { difficultyEstimateEnum, smsMessageTypeEnum } from '@/server/db/schema';

export type AnswerState =
  | 'first_correct'
  | 'first_correct_after_wrong'
  | 'repeat_correct'
  | 'incorrect';

/**
 * Derived from the Drizzle enum so the TypeScript type can never drift from
 * the live DB enum. PRD §9 / Prompt 4 — three values:
 * 'accessible' | 'moderate' | 'specialist'.
 */
export type DifficultyEstimate = (typeof difficultyEstimateEnum.enumValues)[number];

export type MasteryTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

export type SmsMessageType = Exclude<
  (typeof smsMessageTypeEnum.enumValues)[number],
  | 'star_notification'
  | 'game_complete'
  | 'game_summary_ready'
  | 'incognito_round_invitation'
  | 'anniversary_milestone'
>;

export type Category = string;
// Category is used as a string throughout - no enum needed.
