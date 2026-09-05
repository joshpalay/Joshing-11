import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReminderState } from '@/server/db/queries/account';

const {
  getSessionMock,
  getReminderStateMock,
  markPhoneVerifiedMock,
  getOtpBypassCodeForPhoneMock,
  requestOtpMock,
  verifyOtpMock,
  sendSmsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getReminderStateMock: vi.fn(),
  markPhoneVerifiedMock: vi.fn(),
  getOtpBypassCodeForPhoneMock: vi.fn(),
  requestOtpMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  sendSmsMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/auth', () => ({
  getOtpBypassCodeForPhone: getOtpBypassCodeForPhoneMock,
  requestOtp: requestOtpMock,
  verifyOtp: verifyOtpMock,
}));
vi.mock('@/server/db/queries/account', () => ({
  getReminderState: getReminderStateMock,
  markPhoneVerified: markPhoneVerifiedMock,
}));
vi.mock('@/server/sms', () => ({
  buildOtpMessage: (code: string) => `Verification code: ${code}`,
  sendSms: sendSmsMock,
}));

import { POST } from '@/app/api/account/phone/verify/route';

const unverifiedState: ReminderState = {
  smsOptIn: 'not_asked',
  emailOptIn: 'not_asked',
  phoneVerified: false,
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

const verifiedState: ReminderState = { ...unverifiedState, phoneVerified: true };

function request(body: unknown) {
  return new Request('https://joshing.test/api/account/phone/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/account/phone/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'user-1' });
    getReminderStateMock.mockResolvedValue(unverifiedState);
    markPhoneVerifiedMock.mockResolvedValue(verifiedState);
    getOtpBypassCodeForPhoneMock.mockReturnValue(null);
    requestOtpMock.mockResolvedValue({ code: '123456', normalizedPhone: '+12025550147' });
    verifyOtpMock.mockResolvedValue('+12025550147');
    sendSmsMock.mockResolvedValue({ ok: true });
  });

  it('sends a code to the signed-in account phone number', async () => {
    const response = await POST(request({ action: 'send' }));

    expect(response.status).toBe(200);
    expect(requestOtpMock).toHaveBeenCalledWith('+12025550147');
    expect(sendSmsMock).toHaveBeenCalledWith(
      '+12025550147',
      'Verification code: 123456',
      'otp',
      'user-1',
    );
  });

  it('marks the account phone verified after a valid code', async () => {
    const response = await POST(request({ action: 'confirm', code: '123456' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verified: true, state: verifiedState });
    expect(verifyOtpMock).toHaveBeenCalledWith('+12025550147', '123456');
    expect(markPhoneVerifiedMock).toHaveBeenCalledWith('user-1');
  });

  it('rejects an invalid code without changing the account', async () => {
    verifyOtpMock.mockResolvedValue(null);

    const response = await POST(request({ action: 'confirm', code: '999999' }));

    expect(response.status).toBe(401);
    expect(markPhoneVerifiedMock).not.toHaveBeenCalled();
  });

  it('does not send another code when the phone is already verified', async () => {
    getReminderStateMock.mockResolvedValue(verifiedState);

    const response = await POST(request({ action: 'send' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verified: true, state: verifiedState });
    expect(requestOtpMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
