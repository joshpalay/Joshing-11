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

describe('verifyOtp accepts no bypass', () => {
  // The scoped AUTH_OTP_BYPASS_* escape hatch was removed once Twilio delivery
  // resumed -- the condition its own .env.example note set for removal. What
  // remains is the invariant that matters permanently: verifyOtp reads OTP
  // storage and nothing else. Any code that works without a stored row is a
  // bypass, whatever it is called.
  it('does not accept the old universal 000000 bypass', async () => {
    await expect(verifyOtp('+15551234567', '000000')).resolves.toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
