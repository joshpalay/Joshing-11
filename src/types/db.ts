import type { smsMessageTypeEnum } from '@/server/db/schema';

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

export type SmsMessageType = (typeof smsMessageTypeEnum.enumValues)[number];

export type Category = string;
// Category is used as a string throughout - no enum needed.
