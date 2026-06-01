'use client';

import { useRouter } from 'next/navigation';
import { BarChart3, Code2, FlaskConical, Loader2, LogOut, RefreshCw, Sun } from 'lucide-react';
import { useState } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';

export function AccountActions() {
  const router = useRouter();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canDeleteAccount = deleteConfirmation === 'DELETE';

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

  async function confirmDeleteAccount() {
    if (!canDeleteAccount) return;

    setDeletingAccount(true);
    setDeleteError(null);

    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok && response.status !== 401) {
        throw new Error(body?.error ?? 'Could not delete your account.');
      }

      router.push('/login');
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Could not delete your account.');
      setDeletingAccount(false);
    }
  }

  return (
    <>
      <section className="mb-8">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Developer tools</h2>
        <SettingsGroup>
          <SettingsRow
            icon={<FlaskConical className="size-5" />}
            title="Create test game"
            subtitle="Spin up a test game instantly"
            href="/dev/test-game"
          />
          <SettingsRow
            icon={<RefreshCw className="size-5" />}
            title="Reset session"
            subtitle="Clear current session data"
            href="/dev/reset-session"
          />
          <SettingsRow
            icon={<Sun className="size-5" />}
            title="Trigger noon reset"
            subtitle="Simulate daily reset"
            href="/dev/noon-reset"
          />
          <SettingsRow
            icon={<Code2 className="size-5" />}
            title="View staging flags"
            subtitle="See feature flag status"
            href="/dev/flags"
          />
          <SettingsRow
            icon={<BarChart3 className="size-5" />}
            title="Points diagnostic"
            subtitle="Inspect a user's mastery events and where points came from"
            href="/dev/points-diagnostic"
          />
        </SettingsGroup>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Account</h2>
        <SettingsGroup>
          <SettingsRow
            icon={<LogOut className="size-5" />}
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
          <div className="border-destructive/30 bg-card text-card-foreground mt-3 rounded-xl border p-4">
            <p className="text-sm font-medium">Are you sure you want to log out?</p>
            <div className="mt-3 flex gap-2">
              <button
                className="border-destructive text-destructive hover:bg-destructive/10 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium"
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
            {logoutError ? <p className="text-destructive mt-2 text-sm">{logoutError}</p> : null}
          </div>
        ) : null}

        <div className="mt-6">
          {confirmingDelete ? (
            <div className="border-destructive bg-destructive/5 rounded-xl border p-4">
              <p className="text-destructive text-sm font-semibold">
                Delete your account permanently?
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                This removes your account, sessions, stats, authored questions, games, and friend
                connections. This cannot be undone.
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
                className="bg-background focus:border-destructive mt-1 h-10 w-full rounded-md border px-3 text-sm outline-none"
                autoComplete="off"
                disabled={deletingAccount}
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
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
              {deleteError ? <p className="text-destructive mt-2 text-sm">{deleteError}</p> : null}
            </div>
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive text-xs font-medium underline-offset-2 hover:underline"
              onClick={() => {
                setConfirmingDelete(true);
                setConfirmingLogout(false);
                setLogoutError(null);
              }}
            >
              Delete account
            </button>
          )}
        </div>
      </section>
    </>
  );
}
