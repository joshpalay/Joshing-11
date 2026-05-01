export type AnswerState =
  | 'first_correct'
  | 'first_correct_after_wrong'
  | 'repeat_correct'
  | 'incorrect';

export type DifficultyEstimate =
  | 'easy'
  | 'medium'
  | 'hard'
  | 'very_hard';

export type MasteryTier =
  | 'establishing'
  | 'familiar'
  | 'solid'
  | 'mastery';

export type SmsMessageType =
  | 'otp'
  | 'daily_questions'
  | 'invitation'
  | 'game_complete'
  | 'creator_note_prompt'
  | 'reaction_notification'
  | 'joshing_game_received'
  | 'joshing_game_progress'
  | 'joshing_game_complete'
  | 'ceremony_ready';

export type Category = string;
// Category is used as a string throughout - no enum needed.
