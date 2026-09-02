import { describe, expect, it } from 'vitest';

import {
  buildDailyReminderSmsBody,
  buildOtpMessage,
  buildSmsOptInConfirmationMessage,
  isEligibleForDailyReminder,
  isSmsMessageTypeEnabled,
} from '@/server/sms';

describe('A2P SMS campaign boundaries and copy', () => {
  it('allows only OTP and daily-reminder message types', () => {
    expect(isSmsMessageTypeEnabled('otp')).toBe(true);
    expect(isSmsMessageTypeEnabled('sms_opt_in_confirmation')).toBe(true);
    expect(isSmsMessageTypeEnabled('daily_questions')).toBe(true);
    expect(isSmsMessageTypeEnabled('daily_questions_batched')).toBe(true);

    for (const messageType of [
      'invitation',
      'question_reaction',
      'correct_answer_notification',
      'joshing_game_received',
      'joshing_game_progress',
      'joshing_game_complete',
      'ceremony_ready',
      'friend_answered_question',
      'missed_return_recovered',
    ] as const) {
      expect(isSmsMessageTypeEnabled(messageType)).toBe(false);
    }
  });

  it('builds identified OTP, opt-in confirmation, and daily reminder copy', () => {
    expect(buildOtpMessage('123456')).toBe(
      'Joshing one-time verification code: 123456. Expires in 10 minutes. Do not share this code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
    );
    expect(buildOtpMessage('123456').length).toBeLessThanOrEqual(160);
    expect(buildSmsOptInConfirmationMessage()).toBe(
      'Joshing SMS reminders are on. Up to 1 message per day. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.',
    );
    expect(buildDailyReminderSmsBody('https://joshing.example/')).toBe(
      'Joshing: Your five for today are ready: https://joshing.example/daily. Reply STOP to opt out, HELP for help. Msg & data rates may apply.',
    );
  });

  it('requires verified phone plus explicit opt-in for daily reminders', () => {
    expect(
      isEligibleForDailyReminder({
        phoneNumber: '+17345550123',
        phoneVerified: true,
        smsOptIn: 'opted_in',
      }),
    ).toBe(true);
    expect(
      isEligibleForDailyReminder({
        phoneNumber: '+17345550123',
        phoneVerified: false,
        smsOptIn: 'opted_in',
      }),
    ).toBe(false);
    expect(
      isEligibleForDailyReminder({
        phoneNumber: '+17345550123',
        phoneVerified: true,
        smsOptIn: 'not_asked',
      }),
    ).toBe(false);
  });
});
