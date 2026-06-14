import { createHash, randomBytes } from 'crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db, emailVerificationTokens, users } from '@/server/db';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type CreateVerificationTokenResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number };

// Mints a fresh verification token for the given pendingEmail. Any prior
// unconsumed token rows for the user are invalidated first (consumed_at =
// now) so the only path to verifying becomes the newest URL — protects
// against an old leaked link being re-used after the user changed their
// pendingEmail.
//
// Rate-limit: at most one token per RESEND_COOLDOWN_MS per user. Callers
// should surface this as a friendly "wait a minute" message rather than a
// hard error.
export async function createVerificationToken(
  userId: string,
  email: string,
  options: { optInOnConfirm?: boolean } = {},
): Promise<CreateVerificationTokenResult> {
  const now = Date.now();

  const [latest] = await db
    .select({ createdAt: emailVerificationTokens.createdAt })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, userId))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);

  if (latest) {
    const sinceLast = now - latest.createdAt.getTime();
    if (sinceLast < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'rate_limited', retryAfterMs: RESEND_COOLDOWN_MS - sinceLast };
    }
  }

  await invalidateUserTokens(userId);

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now + TOKEN_TTL_MS);

  await db.insert(emailVerificationTokens).values({
    userId,
    email,
    tokenHash,
    expiresAt,
    optInOnConfirm: options.optInOnConfirm ?? false,
  });

  return { ok: true, token, expiresAt };
}

// Marks every outstanding (unconsumed) token for the user as consumed.
// Called when the user updates their pendingEmail, before issuing a new
// token, and when the email is successfully promoted.
export async function invalidateUserTokens(userId: string): Promise<void> {
  await db
    .update(emailVerificationTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.consumedAt),
      ),
    );
}

export type ConsumeVerificationTokenResult =
  | { ok: true; email: string; userId: string; optedIn: boolean }
  | { ok: false; reason: 'invalid_or_expired' | 'email_already_in_use' };

// Consumes a token in a single transaction with the User row promotion:
//   - finds the token row by hash
//   - bails if it's missing, expired, consumed, or the User's pendingEmail
//     no longer matches the address the token was issued for
//   - sets emailVerified=true, email=pendingEmail, pendingEmail=null
//   - marks the token consumed
//
// Returns a generic 'invalid_or_expired' for all token-side failures so
// the UI cannot distinguish "expired" vs "already used" vs "never existed"
// (granular reason still lives in API logs).
export async function consumeVerificationToken(
  token: string,
): Promise<ConsumeVerificationTokenResult> {
  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: emailVerificationTokens.id,
        userId: emailVerificationTokens.userId,
        email: emailVerificationTokens.email,
        expiresAt: emailVerificationTokens.expiresAt,
        consumedAt: emailVerificationTokens.consumedAt,
        optInOnConfirm: emailVerificationTokens.optInOnConfirm,
      })
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return { ok: false, reason: 'invalid_or_expired' };
    if (row.consumedAt) return { ok: false, reason: 'invalid_or_expired' };
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'invalid_or_expired' };
    }

    const [user] = await tx
      .select({ pendingEmail: users.pendingEmail })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);

    if (!user || user.pendingEmail !== row.email) {
      return { ok: false, reason: 'invalid_or_expired' };
    }

    // The onboarding beat captures opt-in intent up front (the user typed their
    // email to *get* reminders), so a token minted with opt_in_on_confirm flips
    // emailOptIn on in the same transaction that verifies the address — no
    // second trip to the profile toggle. Sending is still gated on
    // emailVerified (which we set here), so nothing went out before this point.
    try {
      await tx
        .update(users)
        .set({
          email: row.email,
          emailVerified: true,
          pendingEmail: null,
          ...(row.optInOnConfirm ? { emailOptIn: 'opted_in' as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.userId));
    } catch (err) {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        return { ok: false, reason: 'email_already_in_use' };
      }
      throw err;
    }

    await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationTokens.id, row.id));

    return { ok: true, email: row.email, userId: row.userId, optedIn: row.optInOnConfirm };
  });
}
