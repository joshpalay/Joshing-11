import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'where'),
  count: vi.fn(),
  desc: vi.fn(() => 'order'),
  eq: vi.fn(() => 'equal'),
  gt: vi.fn(() => 'greater'),
  gte: vi.fn(() => 'greater-or-equal'),
}));

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('@/server/db/schema', () => ({
  otpCodes: {
    phoneNumber: 'phoneNumber',
    code: 'code',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
  },
  smsLogs: {},
}));

import { verifyOtp } from '@/server/auth/otp-store';

beforeEach(() => {
  vi.clearAllMocks();
  selectMock.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyOtp configured bypass', () => {
  it('accepts the configured code for the allowlisted phone without reading OTP storage', async () => {
    vi.stubEnv('AUTH_OTP_BYPASS_PHONE', '+15551234567');
    vi.stubEnv('AUTH_OTP_BYPASS_CODE', '654321');

    await expect(verifyOtp('(555) 123-4567', '654321')).resolves.toBe('+15551234567');
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('does not retain the old universal 000000 bypass', async () => {
    await expect(verifyOtp('+15551234567', '000000')).resolves.toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
