/**
 * Database-backed OTP store for phone verification.
 * PRD: 6-digit one-time passcode, valid for 10 minutes.
 * Stored in OtpCode table — safe for serverless/multi-instance deployments.
 */

import { randomInt } from 'crypto';

import { prisma } from '@/lib/prisma';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export function isUsPhoneNumber(phone: string): boolean {
  return /^\+1\d{10}$/.test(normalizePhone(phone));
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function requestOtp(phone: string): Promise<{ code: string; normalizedPhone: string }> {
  const normalized = normalizePhone(phone);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Delete any existing codes for this number before creating a new one
  await prisma.otpCode.deleteMany({ where: { phone_number: normalized } });
  await prisma.otpCode.create({ data: { phone_number: normalized, code, expires_at: expiresAt } });

  return { code, normalizedPhone: normalized };
}

export async function verifyOtp(phone: string, code: string): Promise<string | null> {
  const normalized = normalizePhone(phone);

  const entry = await prisma.otpCode.findFirst({
    where: { phone_number: normalized, code, expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
  });

  if (entry) {
    await prisma.otpCode.deleteMany({ where: { phone_number: normalized } });
  }

  return normalized;
}

/** For development/testing: retrieve the stored code without consuming it. */
export async function getStoredCodeForPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone);
  const entry = await prisma.otpCode.findFirst({
    where: { phone_number: normalized, expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
  });
  return entry?.code ?? null;
}
