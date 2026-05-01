/**
 * Database-backed OTP store for phone verification.
 * PRD: 6-digit one-time passcode, valid for 10 minutes.
 * Stored in OtpCode table — safe for serverless/multi-instance deployments.
 */

import { randomInt } from 'crypto';
import { and, count, desc, eq, gt, gte } from 'drizzle-orm';

import { db } from '@/server/db';
import { otpCodes, smsLogs } from '@/server/db/schema';
import { normalizePhone } from './phone';

export { isUsPhoneNumber, normalizePhone } from './phone';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function requestOtp(phone: string): Promise<{ code: string; normalizedPhone: string }> {
  const normalized = normalizePhone(phone);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Delete any existing codes for this number before creating a new one
  await db.delete(otpCodes).where(eq(otpCodes.phoneNumber, normalized));
  await db.insert(otpCodes).values({ phoneNumber: normalized, code, expiresAt });

  return { code, normalizedPhone: normalized };
}

export async function verifyOtp(phone: string, code: string): Promise<string | null> {
  const normalized = normalizePhone(phone);

  const [entry] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phoneNumber, normalized), eq(otpCodes.code, code), gt(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (entry) {
    await db.delete(otpCodes).where(eq(otpCodes.phoneNumber, normalized));
  }

  return normalized;
}

/** For development/testing: retrieve the stored code without consuming it. */
export async function getStoredCodeForPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone);
  const [entry] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phoneNumber, normalized), gt(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  return entry?.code ?? null;
}

export async function getRecentOtpRequestCount(phone: string, since: Date): Promise<number> {
  const normalized = normalizePhone(phone);
  const [row] = await db
    .select({ value: count() })
    .from(smsLogs)
    .where(
      and(
        eq(smsLogs.phoneNumber, normalized),
        eq(smsLogs.messageType, 'otp'),
        gte(smsLogs.sentAt, since),
      ),
    );

  return row?.value ?? 0;
}
