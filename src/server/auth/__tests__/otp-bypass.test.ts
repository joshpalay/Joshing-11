import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOtpBypassCodeForPhone } from '@/server/auth/otp-bypass';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getOtpBypassCodeForPhone', () => {
  it('is disabled unless both a valid US phone and six-digit code are configured', () => {
    vi.stubEnv('AUTH_OTP_BYPASS_PHONE', '+15551234567');
    expect(getOtpBypassCodeForPhone('+15551234567')).toBeNull();

    vi.stubEnv('AUTH_OTP_BYPASS_CODE', 'not-a-code');
    expect(getOtpBypassCodeForPhone('+15551234567')).toBeNull();
  });

  it('returns the code only for the configured phone', () => {
    vi.stubEnv('AUTH_OTP_BYPASS_PHONE', '(555) 123-4567');
    vi.stubEnv('AUTH_OTP_BYPASS_CODE', '654321');

    expect(getOtpBypassCodeForPhone('+15551234567')).toBe('654321');
    expect(getOtpBypassCodeForPhone('+15557654321')).toBeNull();
  });
});
