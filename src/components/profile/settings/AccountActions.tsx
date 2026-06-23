'use client';

import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Code2,
  Compass,
  FlaskConical,
  Loader2,
  LogOut,
  Map,
  RefreshCw,
  Smartphone,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useState } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';

/**
 * Log out, then redirect. `destroySession()` clears the `joshing_session`
 * cookie server-side; the redirect MUST be a hard navigation so the cleared
 * cookie takes effect and no stale authenticated client tree (App Router
 * cache) survives. A soft `router.push` left the user looking signed-in until
 * they manually navigated (B-LOGOUT-CONFIRM-FIX-01). 401 means the session was
 * already gone, which is still a successful logout.
 *
 * `navigate` is injected so the chain is testable without a DOM.
 */
export async function logoutAndRedirect(navigate: (url: string) => void): Promise<void> {
  const response = await fetch('/api/account/logout', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok && response.status !== 401) {
    throw new Error('Could not log out.');
  }

  navigate('/login');
}

// TEMP (ungate): the Developer-tools section is currently shown to every owner
// viewing their own profile, regardless of admin status. To restore the
// ADMIN_USER_IDS gate (D-DESIGN-DEBT-STRUCTURAL-01, Phase 3), flip this back to
// `false` — `showDeveloperTools` then falls back to the `isAdmin` prop. The
// matching /dev route gate lives in src/app/dev/layout.tsx; revert both together.
const DEV_TOOLS_UNGATED = true;

/**
 * `isAdmin` normally gates the Developer-tools section via the ADMIN_USER_IDS
 * allowlist (the caller computes it from `isAdminUser(session.userId)`).
 * Defaults to false (fail closed). While `DEV_TOOLS_UNGATED` is true the gate
 * is bypassed and the section renders for any profile owner. This component only
 * mounts in the owner self-view, so the tools are never exposed on other
 * people's profiles either way.
 */
export function AccountActions({ isAdmin = false }: { isAdmin?: boolean }) {
  const showDeveloperTools = DEV_TOOLS_UNGATED || isAdmin;
  const router = useRouter();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resettingGame, setResettingGame] = useState(false);
  const [resetGameError, setResetGameError] = useState<string | null>(null);

  const canDeleteAccount = deleteConfirmation === 'DELETE';

  async function createTestGame() {
    if (resettingGame) return;
    setResetGameError(null);
    setResettingGame(true);

    try {
      const response = await fetch('/api/daily/reset', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not reset daily round.');
      }

      router.push('/daily');
    } catch (caught) {
      setResetGameError(caught instanceof Error ? caught.message : 'Could not reset daily round.');
      setResettingGame(false);
    }
  }

  async function confirmLogout() {
    setLoggingOut(true);
    setLogoutError(null);

    try {
      // Hard navigation (not router.push): see logoutAndRedirect above.
      await logoutAndRedirect((url) => {
        window.location.assign(url);
      });
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
      {showDeveloperTools ? (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl font-semibold">Developer tools</h2>
          <SettingsGroup>
            <SettingsRow
              icon={<FlaskConical className="size-5" />}
              title={resettingGame ? 'Resetting…' : 'Create test game'}
              subtitle="Reset today's game and play again"
              onClick={() => void createTestGame()}
              disabled={resettingGame}
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
            <SettingsRow
              icon={<Sparkles className="size-5" />}
              title="Show me the first time player"
              subtitle="Preview the first-session experience a new player sees"
              href="/dev/first-time-player"
            />
            <SettingsRow
              icon={<Map className="size-5" />}
              title="Replay onboarding stages"
              subtitle="Walk through every signup / first-run stage on demand (read-only)"
              href="/dev/onboarding"
            />
            <SettingsRow
              icon={<Compass className="size-5" />}
              title="Replay the welcome tour"
              subtitle="The first-run coach-marks over a sample home, into Play"
              href="/dev/welcome-tour"
            />
            <SettingsRow
              icon={<Smartphone className="size-5" />}
              title="Phone-first invite login"
              subtitle="Preview the invite login screens without sending an invite"
              href="/dev/invite-login"
            />
          </SettingsGroup>
          {resetGameError ? (
            <p className="text-destructive mt-2 text-sm">{resetGameError}</p>
          ) : null}
        </section>
      ) : null}

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
                className="btn-danger gap-2"
                type="button"
                onClick={() => void confirmLogout()}
                disabled={loggingOut}
              >
                {loggingOut ? <Loader2 className="size-4 animate-spin" /> : null}
                Log out
              </button>
              <button
                className="btn-ghost"
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
                className="focus:border-destructive mt-1 h-10 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 text-sm outline-none"
                autoComplete="off"
                disabled={deletingAccount}
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-danger gap-2"
                  type="button"
                  onClick={() => void confirmDeleteAccount()}
                  disabled={!canDeleteAccount || deletingAccount}
                >
                  {deletingAccount ? <Loader2 className="size-4 animate-spin" /> : null}
                  Permanently delete account
                </button>
                <button
                  className="btn-ghost"
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
