'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Code2,
  FlaskConical,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Palette,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/account/SettingsRow';
import type { UserProfile } from '@/server/db/queries/account';

type AccountResponse = {
  profile?: UserProfile;
  error?: string;
};

const APP_VERSION = 'v1.0.0';

function memberSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Member since recently';
  return `Member since ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)}`;
}

function LoadingSkeleton() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
      <div className="mb-8 h-10 w-32 animate-pulse rounded-md bg-muted" />
      <div className="mb-6 h-6 w-24 animate-pulse rounded bg-muted" />
      <div className="mb-8 h-64 animate-pulse rounded-xl border bg-muted" />
      <div className="mb-6 h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="h-72 animate-pulse rounded-xl border bg-muted" />
    </main>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch('/api/account', { cache: 'no-store', credentials: 'include' });

      if (response.status === 401) {
        router.push('/login');
        return;
      }

      const body = await response.json().catch(() => null) as AccountResponse | null;
      if (!response.ok || !body?.profile) {
        throw new Error(body?.error ?? 'Could not load your account.');
      }

      setProfile(body.profile);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Could not load your account.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  const canDeleteAccount = deleteConfirmation === 'DELETE';

  async function confirmDeleteAccount() {
    if (!canDeleteAccount) return;

    setDeletingAccount(true);
    setDeleteError(null);

    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;

      if (!response.ok && response.status !== 401) {
        throw new Error(body?.error ?? 'Could not delete your account.');
      }

      router.push('/login');
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Could not delete your account.');
      setDeletingAccount(false);
    }
  }

  async function confirmLogout() {
    setLoggingOut(true);
    setLogoutError(null);

    try {
      const response = await fetch('/api/account/logout', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok && response.status !== 401) {
        throw new Error('Could not log out.');
      }

      router.push('/login');
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'Could not log out.');
      setLoggingOut(false);
    }
  }

  if (loading) return <LoadingSkeleton />;

  if (loadError || !profile) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
        <h1 className="font-serif text-3xl font-semibold">Could not load your account</h1>
        <p className="mt-3 text-sm text-muted-foreground">{loadError ?? 'Something went wrong.'}</p>
        <button className="btn-primary mt-5" type="button" onClick={() => void loadProfile()}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
      <section className="mb-10 flex items-center justify-between gap-4">
        <h1 className="font-serif text-4xl font-semibold leading-tight">Settings</h1>
        <Link
          href="/users/me"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View your profile →
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Account</h2>
        <SettingsGroup>
          <SettingsRow
            icon={Lock}
            title="Privacy & visibility"
            subtitle="Control what others can see"
            href="/account/privacy"
          />
          <SettingsRow
            icon={MessageSquare}
            title="SMS & notifications"
            subtitle="Manage how you get updates"
            href="/account/notifications"
          />
          <SettingsRow
            icon={Palette}
            title="App preferences"
            subtitle="Theme, language, and more"
            href="/account/preferences"
          />
        </SettingsGroup>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Developer Tools</h2>
        <SettingsGroup>
          <SettingsRow
            icon={FlaskConical}
            title="Create test game"
            subtitle="Spin up a test game instantly"
            href="/dev/test-game"
          />
          <SettingsRow
            icon={RefreshCw}
            title="Reset session"
            subtitle="Clear current session data"
            href="/dev/reset-session"
          />
          <SettingsRow
            icon={Sun}
            title="Trigger noon reset"
            subtitle="Simulate daily reset (noon ET)"
            href="/dev/noon-reset"
          />
          <SettingsRow
            icon={Code2}
            title="View staging flags"
            subtitle="See feature flag status"
            href="/dev/flags"
          />
          <SettingsRow
            icon={BarChart3}
            title="Points diagnostic"
            subtitle="Inspect a user's mastery events and where points came from"
            href="/dev/points-diagnostic"
          />
        </SettingsGroup>

        <div className="mt-4">
          <SettingsGroup>
            <SettingsRow
              icon={LogOut}
              title="Log out"
              subtitle="Sign out of your account"
              onClick={() => {
                setConfirmingLogout(true);
                setConfirmingDelete(false);
                setDeleteError(null);
              }}
              disabled={loggingOut}
            />
          </SettingsGroup>
          {confirmingLogout ? (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-card p-4 text-card-foreground">
              <p className="text-sm font-medium">Are you sure you want to log out?</p>
              <div className="mt-3 flex gap-2">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-destructive px-3 text-sm font-medium text-destructive hover:bg-destructive/10"
                  type="button"
                  onClick={() => void confirmLogout()}
                  disabled={loggingOut}
                >
                  {loggingOut ? <Loader2 className="size-4 animate-spin" /> : null}
                  Log out
                </button>
                <button
                  className="rounded-md border px-3 text-sm"
                  type="button"
                  onClick={() => setConfirmingLogout(false)}
                  disabled={loggingOut}
                >
                  Cancel
                </button>
              </div>
              {logoutError ? <p className="mt-2 text-sm text-destructive">{logoutError}</p> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="mb-10">
        {confirmingDelete ? (
          <div className="rounded-xl border border-destructive bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Delete your account permanently?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This removes your account, sessions, stats, authored questions, games, and friend connections. This cannot be undone.
            </p>
            <label className="mt-3 block text-xs font-medium" htmlFor="delete-confirmation">
              Type DELETE to confirm.
            </label>
            <input
              id="delete-confirmation"
              value={deleteConfirmation}
              onChange={(event) => {
                setDeleteConfirmation(event.target.value);
                setDeleteError(null);
              }}
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-destructive"
              autoComplete="off"
              disabled={deletingAccount}
            />
            <div className="mt-3 flex gap-2">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={() => void confirmDeleteAccount()}
                disabled={!canDeleteAccount || deletingAccount}
              >
                {deletingAccount ? <Loader2 className="size-4 animate-spin" /> : null}
                Permanently delete account
              </button>
              <button
                className="rounded-md border px-3 text-sm"
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteConfirmation('');
                  setDeleteError(null);
                }}
                disabled={deletingAccount}
              >
                Cancel
              </button>
            </div>
            {deleteError ? <p className="mt-2 text-sm text-destructive">{deleteError}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
            onClick={() => {
              setConfirmingDelete(true);
              setConfirmingLogout(false);
              setLogoutError(null);
            }}
          >
            Delete account
          </button>
        )}
      </section>

      <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
        Joshing {APP_VERSION} · {memberSince(profile.createdAt)}
      </footer>
    </main>
  );
}
