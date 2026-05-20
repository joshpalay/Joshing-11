'use client';

import { useState } from 'react';

import type { ReminderState } from '@/server/db/queries/account';

type Props = {
  initialState: ReminderState;
  maskedPhone: string;
};

async function patchReminders(body: Record<string, unknown>): Promise<{
  ok: boolean;
  state: ReminderState | null;
  errorMessage: string | null;
}> {
  const response = await fetch('/api/account/reminders', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as {
    state?: ReminderState;
    message?: string;
  } | null;
  if (!response.ok) {
    return { ok: false, state: null, errorMessage: json?.message ?? 'Could not save.' };
  }
  return { ok: true, state: json?.state ?? null, errorMessage: null };
}

export function NotificationsForm({ initialState, maskedPhone }: Props) {
  const [state, setState] = useState<ReminderState>(initialState);
  const [savingSms, setSavingSms] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState(state.pendingEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmailToggle, setSavingEmailToggle] = useState(false);

  const smsOn = state.smsOptIn === 'opted_in';
  const emailOn = state.emailOptIn === 'opted_in';
  const hasPendingEmail = Boolean(state.pendingEmail);
  const hasVerifiedEmail = state.emailVerified && Boolean(state.email);

  async function toggleSms() {
    const next = smsOn ? 'opted_out' : 'opted_in';
    setSavingSms(true);
    setSmsError(null);
    const result = await patchReminders({ smsOptIn: next });
    setSavingSms(false);
    if (!result.ok || !result.state) {
      setSmsError(result.errorMessage ?? 'Could not save.');
      return;
    }
    setState(result.state);
  }

  async function saveEmail() {
    const trimmed = emailDraft.trim();
    if (!trimmed) {
      setEmailError('Please enter an email address.');
      return;
    }
    setSavingEmail(true);
    setEmailError(null);
    const result = await patchReminders({ pendingEmail: trimmed });
    setSavingEmail(false);
    if (!result.ok || !result.state) {
      setEmailError(result.errorMessage ?? 'Could not save.');
      return;
    }
    setState(result.state);
  }

  async function toggleEmail() {
    const next = emailOn ? 'opted_out' : 'opted_in';
    setSavingEmailToggle(true);
    setEmailError(null);
    const result = await patchReminders({ emailOptIn: next });
    setSavingEmailToggle(false);
    if (!result.ok || !result.state) {
      setEmailError(result.errorMessage ?? 'Could not save.');
      return;
    }
    setState(result.state);
  }

  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="font-serif text-lg font-semibold">SMS reminders</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Text {maskedPhone} when a new round opens.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={smsOn}
            disabled={savingSms}
            onClick={() => void toggleSms()}
            className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition ${
              smsOn ? 'bg-emerald-500 border-emerald-500' : 'bg-muted border-border'
            } ${savingSms ? 'opacity-60' : ''}`}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow transition ${
                smsOn ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {smsOn ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Saved. Texts will start when reminders launch.
          </p>
        ) : null}
        {smsError ? (
          <p className="mt-2 text-xs text-rose-700">{smsError}</p>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="font-serif text-lg font-semibold">Email reminders</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasVerifiedEmail
                ? `Email ${state.email} when a new round opens.`
                : 'Add an email address to enable email reminders.'}
            </p>
          </div>
          {hasVerifiedEmail ? (
            <button
              type="button"
              role="switch"
              aria-checked={emailOn}
              disabled={savingEmailToggle}
              onClick={() => void toggleEmail()}
              className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition ${
                emailOn ? 'bg-emerald-500 border-emerald-500' : 'bg-muted border-border'
              } ${savingEmailToggle ? 'opacity-60' : ''}`}
            >
              <span
                className={`inline-block size-5 rounded-full bg-white shadow transition ${
                  emailOn ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          ) : null}
        </div>

        {!hasVerifiedEmail ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={emailDraft}
              disabled={savingEmail}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                setEmailError(null);
              }}
              className="bg-background flex-1 rounded-lg border px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => void saveEmail()}
              disabled={savingEmail}
            >
              {savingEmail ? 'Saving…' : hasPendingEmail ? 'Update' : 'Save'}
            </button>
          </div>
        ) : null}

        {hasPendingEmail && !hasVerifiedEmail ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Awaiting verification (coming soon). We saved {state.pendingEmail} and
            will email a confirmation link once email reminders launch.
          </p>
        ) : null}
        {hasVerifiedEmail && emailOn ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Saved. Emails will start when reminders launch.
          </p>
        ) : null}
        {emailError ? (
          <p className="mt-2 text-xs text-rose-700">{emailError}</p>
        ) : null}
      </section>

      <p className="text-xs text-muted-foreground">
        Reminders aren&apos;t sending yet — we&apos;re collecting preferences while
        we finish setting up message delivery.
      </p>
    </div>
  );
}
