import { createHmac, timingSafeEqual } from 'crypto';

// Stateless, signed unsubscribe tokens so the daily-reminder footer link (and
// the RFC 8058 one-click List-Unsubscribe header) work without a logged-in
// session — the recipient clicks straight from their inbox. We HMAC the userId
// with JWT_SECRET under a dedicated context string (domain separation from
// session tokens), so no DB column or expiry is needed: the link stays valid
// as long as the secret does, which is exactly what an unsubscribe link wants.
const CONTEXT = 'email-unsubscribe:v1';

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error('JWT_SECRET is required to sign unsubscribe links');
  }
  return value;
}

function sign(userId: string): string {
  return createHmac('sha256', secret()).update(`${CONTEXT}:${userId}`).digest('hex');
}

export function createUnsubscribeToken(userId: string): string {
  return `${encodeURIComponent(userId)}.${sign(userId)}`;
}

// Returns the userId when the signature checks out, null otherwise. Constant-
// time compare so a forged token can't be brute-forced by timing.
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const userId = decodeURIComponent(token.slice(0, dot));
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(userId));

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return userId;
}
