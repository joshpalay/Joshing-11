import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { getSession } from '@/server/auth/session';
import { getReminderState } from '@/server/db/queries/account';
import { NotificationsForm } from './NotificationsForm';

export const dynamic = 'force-dynamic';

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return value;
  const last = digits.slice(-4);
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(•••) •••-${last}`;
  }
  if (digits.length === 10) {
    return `(•••) •••-${last}`;
  }
  return `••• ${last}`;
}

export default async function NotificationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const state = await getReminderState(session.userId);
  if (!state) redirect('/login');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
      <Link
        href="/account"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">
        SMS &amp; notifications
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We&apos;ll only message you when a new round opens. One per day, max. You can
        turn it off here any time.
      </p>

      <NotificationsForm
        initialState={state}
        maskedPhone={maskPhone(state.phoneNumber)}
      />
    </main>
  );
}
