import Link from 'next/link';

import { updateReminderPreferences } from '@/server/db/queries/account';
import { verifyUnsubscribeToken } from '@/server/email/unsubscribe-token';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ token?: string | string[] }>;

function extractToken(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

// The visible footer link from the daily-reminder email. Flips emailOptIn to
// opted_out on load (opting out is always allowed) and confirms it. No session
// required — the signed token in the URL is the authentication.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = extractToken(params.token);
  const userId = token ? verifyUnsubscribeToken(token) : null;

  let success = false;
  if (userId) {
    const result = await updateReminderPreferences(userId, { emailOptIn: 'opted_out' });
    success = result.ok;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 py-16">
      <div className="w-full rounded-xl border bg-card p-8 text-card-foreground">
        {success ? (
          <>
            <h1 className="font-serif text-2xl font-semibold">You&apos;re unsubscribed</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              We&apos;ve turned off your daily reminder emails. You can turn them
              back on any time from your profile settings.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-semibold">Link not recognized</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              This unsubscribe link is invalid. Open your profile and switch off
              &ldquo;Email reminders&rdquo; to stop the daily emails.
            </p>
          </>
        )}

        <Link
          href="/users/me"
          className="btn-primary mt-6 inline-flex w-full items-center justify-center"
        >
          Go to profile
        </Link>
      </div>
    </main>
  );
}
