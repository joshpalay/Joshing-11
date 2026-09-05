import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReminderState } from '@/server/db/queries/account';

const {
  getSessionMock,
  getReminderStateMock,
  updateReminderPreferencesMock,
  restoreSmsReminderConsentMock,
  sendSmsMock,
  sendVerificationEmailMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getReminderStateMock: vi.fn(),
  updateReminderPreferencesMock: vi.fn(),
  restoreSmsReminderConsentMock: vi.fn(),
  sendSmsMock: vi.fn(),
  sendVerificationEmailMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/account', () => ({
  getReminderState: getReminderStateMock,
  restoreSmsReminderConsent: restoreSmsReminderConsentMock,
  updateReminderPreferences: updateReminderPreferencesMock,
}));
vi.mock('@/server/email/send-verification', () => ({
  sendVerificationEmail: sendVerificationEmailMock,
}));
vi.mock('@/server/sms', () => ({
  buildSmsOptInConfirmationMessage: () =>
    'Joshing SMS reminders are on. Up to 1 message per day. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.',
  sendSms: sendSmsMock,
}));

import { PATCH } from '@/app/api/account/reminders/route';

const baseState: ReminderState = {
  smsOptIn: 'not_asked',
  emailOptIn: 'not_asked',
  phoneVerified: true,
  emailVerified: false,
  email: null,
  pendingEmail: null,
  phoneNumber: '+12025550147',
  smsOptInAt: null,
  smsOptOutAt: null,
  smsConsentSource: null,
  smsConsentPolicyVersion: null,
  reminderPromptDismissedAt: null,
  reminderInterstitialSeenAt: null,
};

const optedInState: ReminderState = {
  ...baseState,
  smsOptIn: 'opted_in',
  smsOptInAt: '2026-09-02T12:00:00.000Z',
  smsConsentSource: 'profile_web_form',
  smsConsentPolicyVersion: '2026-09-02',
};

const optedOutState: ReminderState = {
  ...baseState,
  smsOptIn: 'opted_out',
  smsOptOutAt: '2026-09-02T12:00:01.000Z',
  smsConsentSource: 'profile_web_form',
  smsConsentPolicyVersion: '2026-09-02',
};

function patchRequest(body: unknown) {
  return new Request('https://joshing.test/api/account/reminders', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('SMS reminder opt-in confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'user-1' });
    getReminderStateMock.mockResolvedValue(baseState);
    updateReminderPreferencesMock.mockResolvedValue({ ok: true, state: optedInState });
    restoreSmsReminderConsentMock.mockResolvedValue(baseState);
    sendSmsMock.mockResolvedValue({ ok: true });
    sendVerificationEmailMock.mockResolvedValue({ ok: true });
  });

  it('sends the recurring-program confirmation when consent changes to opted in', async () => {
    const response = await PATCH(patchRequest({
      smsOptIn: 'opted_in',
      smsConsentSource: 'profile_web_form',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: optedInState,
      smsConfirmationSent: true,
    });
    expect(sendSmsMock).toHaveBeenCalledWith(
      '+12025550147',
      'Joshing SMS reminders are on. Up to 1 message per day. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.',
      'sms_opt_in_confirmation',
      'user-1',
    );
  });

  it('does not send another confirmation for an already opted-in user', async () => {
    getReminderStateMock.mockResolvedValue(optedInState);

    const response = await PATCH(patchRequest({
      smsOptIn: 'opted_in',
      smsConsentSource: 'profile_web_form',
    }));

    expect(response.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('does not send a confirmation when reminders are turned off', async () => {
    getReminderStateMock.mockResolvedValue(optedInState);
    updateReminderPreferencesMock.mockResolvedValue({ ok: true, state: optedOutState });

    const response = await PATCH(patchRequest({ smsOptIn: 'opted_out' }));

    expect(response.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('restores the exact prior state when the confirmation cannot be delivered', async () => {
    sendSmsMock.mockResolvedValue({ ok: false, reason: 'provider_error' });

    const response = await PATCH(patchRequest({
      smsOptIn: 'opted_in',
      smsConsentSource: 'onboarding_web_form',
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'sms_confirmation_failed',
      state: baseState,
    });
    expect(restoreSmsReminderConsentMock).toHaveBeenCalledWith('user-1', baseState);
  });

  it('requires a source for every SMS opt-in', async () => {
    const response = await PATCH(patchRequest({ smsOptIn: 'opted_in' }));

    expect(response.status).toBe(400);
    expect(updateReminderPreferencesMock).not.toHaveBeenCalled();
  });

  it('retires later prompts only after a non-settings opt-in succeeds', async () => {
    const completedState = {
      ...optedInState,
      smsConsentSource: 'onboarding_web_form',
      reminderPromptDismissedAt: '2026-09-05T16:00:00.000Z',
      reminderInterstitialSeenAt: '2026-09-05T16:00:00.000Z',
    };
    updateReminderPreferencesMock
      .mockResolvedValueOnce({ ok: true, state: completedState })
      .mockResolvedValueOnce({ ok: true, state: completedState });

    const response = await PATCH(patchRequest({
      smsOptIn: 'opted_in',
      smsConsentSource: 'onboarding_web_form',
    }));

    expect(response.status).toBe(200);
    expect(updateReminderPreferencesMock).toHaveBeenNthCalledWith(2, 'user-1', {
      dismissed: true,
      interstitialSeen: true,
    });
  });
});
