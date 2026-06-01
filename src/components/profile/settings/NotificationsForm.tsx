'use client';

import { useState } from 'react';

import { Switch } from '@/components/ui/Switch';
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
  const [emailDraft, setEmailDraft] = useState(state.pendingEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmailToggle, setSavingEmailToggle] = useState(false);

  const smsOn = state.smsOptIn === 'opted_in';
  const emailOn = state.emailOptIn === 'opted_in';
  const hasPendingEmail = Boolean(state.pendingEmail);
  const hasVerifiedEmail = state.emailVerified && Boolean(state.email);

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
    <div className="space-y-4">
      <section className="bg-card text-card-foreground rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-lg font-semibold">SMS reminders</h3>
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                Coming soon
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              SMS notifications are coming soon — this functionality isn&apos;t available yet. Once
              it&apos;s ready, we&apos;ll text {maskedPhone} when a new round opens.
            </p>
          </div>
          <Switch
            checked={smsOn}
            onCheckedChange={() => {}}
            label="SMS reminders"
            disabled
            title="SMS notifications are coming soon"
          />
        </div>
      </section>

      <section className="bg-card text-card-foreground rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 className="font-serif text-lg font-semibold">Email reminders</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {hasVerifiedEmail
                ? `Email ${state.email} when a new round opens.`
                : 'Add an email address to enable email reminders.'}
            </p>
          </div>
          {hasVerifiedEmail ? (
            <Switch
              checked={emailOn}
              onCheckedChange={() => void toggleEmail()}
              label="Email reminders"
              disabled={savingEmailToggle}
            />
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
          <p className="text-muted-foreground mt-3 text-xs">
            Awaiting verification (coming soon). We saved {state.pendingEmail} and will email a
            confirmation link once email reminders launch.
          </p>
        ) : null}
        {hasVerifiedEmail && emailOn ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Saved. Emails will start when reminders launch.
          </p>
        ) : null}
        {emailError ? <p className="mt-2 text-xs text-rose-700">{emailError}</p> : null}
      </section>

      <p className="text-muted-foreground text-xs">
        Reminders aren&apos;t sending yet — we&apos;re collecting preferences while we finish
        setting up message delivery.
      </p>
    </div>
  );
}
