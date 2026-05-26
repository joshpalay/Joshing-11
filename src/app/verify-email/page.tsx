import Link from 'next/link';

import { consumeVerificationToken } from '@/server/db/queries/email-verification';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ token?: string | string[] }>;

function extractToken(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = extractToken(params.token);

  const result = token
    ? await consumeVerificationToken(token)
    : ({ ok: false, reason: 'invalid_or_expired' } as const);

  const success = result.ok;
  const alreadyInUse = !result.ok && result.reason === 'email_already_in_use';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-16">
      <div className="w-full rounded-xl border bg-card p-8 text-card-foreground">
        {success ? (
          <>
            <h1 className="font-serif text-2xl font-semibold">Email confirmed</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {result.email} is now your reminder address. Head to your profile to
              turn on email reminders whenever you&apos;re ready.
            </p>
          </>
        ) : alreadyInUse ? (
          <>
            <h1 className="font-serif text-2xl font-semibold">Email already in use</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              That email is already linked to another Joshing account. Use a
              different address or contact support.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-semibold">Link expired</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              This confirmation link is invalid or has expired. Open your profile
              and tap &ldquo;Resend confirmation&rdquo; to get a new one.
            </p>
          </>
        )}

        <Link
          href="/users/me"
          className="btn-primary mt-6 inline-flex w-full items-center justify-center text-sm"
        >
          Return to profile
        </Link>
      </div>
    </main>
  );
}
