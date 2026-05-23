import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { getSession } from '@/server/auth/session';
import {
  HANDLE_CHANGE_COOLDOWN_DAYS,
  getEditableProfile,
} from '@/server/db/queries/account';
import { ProfileEditForm } from './ProfileEditForm';

export const dynamic = 'force-dynamic';

export default async function ProfileSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const profile = await getEditableProfile(session.userId);
  if (!profile) redirect('/login');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/account"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">
        Profile
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tap any field to edit. Changes save when you tap away or press Enter.
      </p>

      <ProfileEditForm
        profile={profile}
        handleCooldownDays={HANDLE_CHANGE_COOLDOWN_DAYS}
      />
    </main>
  );
}
