'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { UserProfile } from '@/server/db/queries/account';

type AccountResponse = {
  profile?: UserProfile;
  error?: string;
};

const AVATAR_COLORS = ['#0f766e', '#7c3aed', '#be123c', '#2563eb', '#b45309', '#15803d'];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function colorForUser(userId: string): string {
  const hash = Array.from(userId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function memberSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Member since recently';
  return `Member since ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)}`;
}

function LoadingSkeleton() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
      <div className="mb-6 flex flex-col items-center">
        <div className="size-28 animate-pulse rounded-full bg-muted" />
        <div className="mt-4 h-8 w-44 animate-pulse rounded-md bg-muted" />
        <div className="mt-3 h-6 w-36 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="mb-5 h-28 animate-pulse rounded-lg border bg-muted" />
      <div className="mb-5 grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-lg border bg-muted" />
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center text-card-foreground">
      <div className="text-3xl font-semibold">{formatNumber(value)}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
      setDisplayName(body.profile.displayName);
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const changed = profile ? displayName.trim() !== profile.displayName : false;
  const initials = useMemo(() => initialsFor(profile?.displayName ?? displayName), [displayName, profile]);
  const canDeleteAccount = deleteConfirmation === 'DELETE';

  async function saveDisplayName() {
    if (!profile) return;
    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;

      if (response.status === 400) {
        setSaveError(body?.error ?? 'Display name must be 2-30 characters.');
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error ?? 'Could not update your name.');
      }

      const trimmed = displayName.trim();
      setProfile({ ...profile, displayName: trimmed });
      setDisplayName(trimmed);
      setToast('Name updated.');
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'Could not update your name.');
    } finally {
      setSaving(false);
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
      <section className="mb-7 flex flex-col items-center text-center">
        <div
          className="grid size-28 place-items-center rounded-full text-3xl font-semibold text-white shadow-sm"
          style={{ backgroundColor: colorForUser(profile.id) }}
          aria-hidden="true"
        >
          {initials}
        </div>
        <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight">{profile.displayName}</h1>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground">{profile.currentTier}</span>
          <span className="text-muted-foreground">{formatNumber(profile.totalPoints)} points</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{memberSince(profile.createdAt)}</p>
      </section>

      <section className="mb-7 rounded-lg border bg-card p-4 text-card-foreground">
        <label className="text-sm font-medium" htmlFor="display-name">Display name</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setSaveError(null);
            }}
            className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-base outline-none focus:border-primary"
            maxLength={30}
          />
          {changed ? (
            <div className="flex items-center gap-3">
              <button className="btn-primary inline-flex min-w-20 items-center justify-center gap-2" type="button" onClick={() => void saveDisplayName()} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </button>
              <button
                className="text-sm text-muted-foreground underline"
                type="button"
                onClick={() => {
                  setDisplayName(profile.displayName);
                  setSaveError(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
        {saveError ? <p className="mt-2 text-sm text-destructive">{saveError}</p> : null}
      </section>

      <section className="mb-7">
        <h2 className="font-serif text-2xl font-semibold">Your Stats</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <StatTile label="Questions written" value={profile.questionsAuthored} />
          <StatTile label="Games created" value={profile.gamesCreated} />
          <StatTile label="Games played" value={profile.gamesPlayed} />
          <StatTile label="Total points" value={profile.totalPoints} />
        </div>
      </section>

      <section className="mb-7 divide-y rounded-lg border bg-card text-card-foreground">
        {[
          { href: '/knowledge?interests=manage', label: 'Manage interests' },
          { href: '/archive', label: 'Archive' },
          { href: '/questions', label: 'Your Questions' },
          { href: '/knowledge', label: 'Knowledge Map' },
          { href: '/activities', label: 'Activities' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="flex min-h-14 items-center justify-between px-4 text-sm font-medium hover:bg-muted">
            {item.label}
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </section>

      <section className="mt-auto rounded-lg border border-destructive/30 bg-card p-4 text-card-foreground">
        <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
        <div className="mt-4">
          <p className="text-sm font-medium">Phone: {profile.phoneNumber}</p>
          <p className="mt-1 text-xs text-muted-foreground">To change your number, contact support.</p>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            className="min-h-10 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10"
            type="button"
            onClick={() => {
              setConfirmingLogout(true);
              setConfirmingDelete(false);
              setDeleteError(null);
            }}
          >
            Log out
          </button>
          <button
            className="min-h-10 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            type="button"
            onClick={() => {
              setConfirmingDelete(true);
              setConfirmingLogout(false);
              setLogoutError(null);
            }}
          >
            Delete account
          </button>
        </div>

        {confirmingLogout ? (
          <div className="mt-5 rounded-lg border border-destructive/30 p-3">
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
              <button className="rounded-md border px-3 text-sm" type="button" onClick={() => setConfirmingLogout(false)} disabled={loggingOut}>
                Cancel
              </button>
            </div>
            {logoutError ? <p className="mt-2 text-sm text-destructive">{logoutError}</p> : null}
          </div>
        ) : null}

        {confirmingDelete ? (
          <div className="mt-5 rounded-lg border border-destructive bg-destructive/5 p-3">
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
        ) : null}
      </section>

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg md:bottom-8">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
