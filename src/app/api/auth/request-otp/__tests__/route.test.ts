import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

const {
  findUserSelectMock,
  hasValidPendingInvitationForPhoneMock,
  getInvitePrefillByTokenMock,
  getOtpBypassCodeForPhoneMock,
  requestOtpMock,
  resolveInviteLinkMock,
  sendSmsMock,
} = vi.hoisted(() => {
  const findUserSelectMock = vi.fn(async () => [] as Array<Record<string, unknown>>);
  return {
    findUserSelectMock,
    hasValidPendingInvitationForPhoneMock: vi.fn(async () => false),
    getInvitePrefillByTokenMock: vi.fn(async () => null as unknown),
    getOtpBypassCodeForPhoneMock: vi.fn(() => null as string | null),
    requestOtpMock: vi.fn(async () => ({ code: '424242' })),
    resolveInviteLinkMock: vi.fn(async () => null as unknown),
    sendSmsMock: vi.fn(async () => ({ ok: true as const })),
  };
});

vi.mock('@/server/auth', () => ({
  getOtpBypassCodeForPhone: getOtpBypassCodeForPhoneMock,
  isUsPhoneNumber: (value: string) => /^\+1\d{10}$/.test(value),
  normalizePhone: (value: string) => value,
  requestOtp: requestOtpMock,
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => findUserSelectMock()),
        })),
      })),
    })),
  },
  users: { id: 'users.id', phoneNumber: 'users.phoneNumber' },
}));

vi.mock('@/server/friends/invitations', () => ({
  hasValidPendingInvitationForPhone: hasValidPendingInvitationForPhoneMock,
  getInvitePrefillByToken: getInvitePrefillByTokenMock,
  INVITE_REQUIRED_MESSAGE:
    "Joshing is invite-only. Ask a friend who's already on Joshing to send you an invite.",
  INVITATION_ACCEPTANCE_ERROR_MESSAGE: 'This invitation could not be accepted.',
}));

vi.mock('@/server/friends/user-invite-token', () => ({
  resolveInviteLink: resolveInviteLinkMock,
}));

vi.mock('@/server/sms', () => ({
  buildOtpMessage: (code: string) =>
    `Joshing one-time verification code: ${code}. Expires in 10 minutes. Do not share this code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`,
  sendSms: sendSmsMock,
}));

import { POST } from '@/app/api/auth/request-otp/route';

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const NEW_PHONE = '+15551230001';
const USER_INVITE = { handle: 'jpalay', token: 'real-token' };

describe('/api/auth/request-otp invite gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUserSelectMock.mockReset();
    // Default: phone belongs to no existing user (new-signup path).
    findUserSelectMock.mockResolvedValue([]);
    hasValidPendingInvitationForPhoneMock.mockResolvedValue(false);
    getInvitePrefillByTokenMock.mockResolvedValue(null);
    getOtpBypassCodeForPhoneMock.mockReturnValue(null);
    resolveInviteLinkMock.mockResolvedValue(null);
    requestOtpMock.mockResolvedValue({ code: '424242' });
    sendSmsMock.mockResolvedValue({ ok: true });
  });

  it('blocks a brand-new phone with no invitation (403, no OTP sent)', async () => {
    const response = await POST(jsonRequest({ phone: NEW_PHONE }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'invite_required' });
    expect(requestOtpMock).not.toHaveBeenCalled();
  });

  it('lets a brand-new phone through when a valid per-user invite link is supplied', async () => {
    resolveInviteLinkMock.mockResolvedValue({
      inviterUserId: 'inviter-1',
      inviterHandle: 'jpalay',
      inviterDisplayName: 'Joshua P',
      inviterAvatarColor: null,
    });

    const response = await POST(jsonRequest({ phone: NEW_PHONE, userInvite: USER_INVITE }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(resolveInviteLinkMock).toHaveBeenCalledWith('jpalay', 'real-token');
    expect(requestOtpMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenCalledWith(
      NEW_PHONE,
      'Joshing one-time verification code: 424242. Expires in 10 minutes. Do not share this code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
      'otp',
      undefined,
    );
  });

  it('still blocks a brand-new phone when the invite link does not resolve', async () => {
    resolveInviteLinkMock.mockResolvedValue(null);

    const response = await POST(
      jsonRequest({
        phone: NEW_PHONE,
        userInvite: { handle: 'jpalay', token: 'bogus' },
      }),
    );

    expect(response.status).toBe(403);
    expect(requestOtpMock).not.toHaveBeenCalled();
  });

  it('returns the warm invite_phone_unclaimed signal when a token rides along but the (edited) phone has no claim', async () => {
    // Phone-first invite path: the invitee edited the pre-filled number to one
    // with no claim of its own. The gate still rejects (no OTP), but with a
    // distinguishable label so the client can render the warm dead-end.
    const response = await POST(jsonRequest({ phone: NEW_PHONE, invitationToken: 'tok-1' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'invite_phone_unclaimed',
    });
    expect(requestOtpMock).not.toHaveBeenCalled();
  });

  it('does not require an invitation for an existing user', async () => {
    findUserSelectMock.mockResolvedValue([{ id: 'user-1' }]);

    const response = await POST(jsonRequest({ phone: NEW_PHONE }));

    expect(response.status).toBe(200);
    expect(resolveInviteLinkMock).not.toHaveBeenCalled();
    expect(requestOtpMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenCalledWith(
      NEW_PHONE,
      'Joshing one-time verification code: 424242. Expires in 10 minutes. Do not share this code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
      'otp',
      'user-1',
    );
  });
});

describe('/api/auth/request-otp invite-phone prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUserSelectMock.mockReset();
    findUserSelectMock.mockResolvedValue([]);
    hasValidPendingInvitationForPhoneMock.mockResolvedValue(false);
    getInvitePrefillByTokenMock.mockResolvedValue(null);
    getOtpBypassCodeForPhoneMock.mockReturnValue(null);
    resolveInviteLinkMock.mockResolvedValue(null);
    requestOtpMock.mockResolvedValue({ code: '424242' });
    sendSmsMock.mockResolvedValue({ ok: true });
  });

  it('sends the OTP to the invite phone and returns only the masked form', async () => {
    getInvitePrefillByTokenMock.mockResolvedValue({
      inviterName: 'Alex',
      inviteePhone: '+17345556819',
      maskedPhone: '•••-•••-6819',
    });

    const response = await POST(jsonRequest({ invitationToken: 'tok-1', useInvitePhone: true }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, maskedPhone: '•••-•••-6819' });
    // The raw phone must never cross to the client.
    expect(JSON.stringify(body)).not.toContain('+17345556819');
    expect(getInvitePrefillByTokenMock).toHaveBeenCalledWith('tok-1');
    expect(requestOtpMock).toHaveBeenCalledWith('+17345556819');
    expect(sendSmsMock).toHaveBeenCalledWith(
      '+17345556819',
      'Joshing one-time verification code: 424242. Expires in 10 minutes. Do not share this code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
      'otp',
    );
  });

  it('rejects when the invite token does not resolve to a sendable phone (no OTP sent)', async () => {
    getInvitePrefillByTokenMock.mockResolvedValue(null);

    const response = await POST(jsonRequest({ invitationToken: 'bogus', useInvitePhone: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_invitation' });
    expect(requestOtpMock).not.toHaveBeenCalled();
  });

  it('falls back to the phone gate when useInvitePhone is not set', async () => {
    // invitationToken present but useInvitePhone absent → manual path; the
    // brand-new phone has no invitation, so the gate blocks it.
    const response = await POST(jsonRequest({ phone: NEW_PHONE, invitationToken: 'tok-1' }));

    expect(response.status).toBe(403);
    expect(getInvitePrefillByTokenMock).not.toHaveBeenCalled();
    expect(requestOtpMock).not.toHaveBeenCalled();
  });

  it('skips SMS for the explicitly configured invite phone', async () => {
    getInvitePrefillByTokenMock.mockResolvedValue({
      inviterName: 'Alex',
      inviteePhone: '+17345556819',
      maskedPhone: '•••-•••-6819',
    });
    getOtpBypassCodeForPhoneMock.mockReturnValue('654321');

    const response = await POST(jsonRequest({ invitationToken: 'tok-1', useInvitePhone: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      maskedPhone: '•••-•••-6819',
      debugCode: '654321',
    });
    expect(requestOtpMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

describe('/api/auth/request-otp configured SMS bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUserSelectMock.mockReset();
    findUserSelectMock.mockResolvedValue([{ id: 'user-1' }]);
    getOtpBypassCodeForPhoneMock.mockReturnValue('654321');
  });

  it('advances without creating or sending an OTP for the allowlisted phone', async () => {
    const response = await POST(jsonRequest({ phone: NEW_PHONE }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, phone: NEW_PHONE, debugCode: '654321' });
    expect(requestOtpMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

describe('/api/auth/request-otp production delivery safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    findUserSelectMock.mockReset();
    findUserSelectMock.mockResolvedValue([{ id: 'user-1' }]);
    getOtpBypassCodeForPhoneMock.mockReturnValue(null);
    requestOtpMock.mockResolvedValue({ code: '424242' });
    sendSmsMock.mockResolvedValue({ ok: true });
  });

  it('never exposes debugCode in production', async () => {
    const response = await POST(jsonRequest({ phone: NEW_PHONE }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, phone: NEW_PHONE });
  });

  it('does not claim success when Twilio delivery fails', async () => {
    sendSmsMock.mockResolvedValue({ ok: false, reason: 'provider_error' });
    const response = await POST(jsonRequest({ phone: NEW_PHONE }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'sms_delivery_failed' });
  });

  it('advances the allowlisted walkthrough phone without contacting Twilio', async () => {
    getOtpBypassCodeForPhoneMock.mockReturnValue('654321');

    const response = await POST(jsonRequest({ phone: NEW_PHONE }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, phone: NEW_PHONE });
    expect(requestOtpMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
