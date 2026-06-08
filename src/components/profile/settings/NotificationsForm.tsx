'use client';

import { useEffect, useState } from 'react';

import { Switch } from '@/components/ui/Switch';
import type { ReminderState } from '@/server/db/queries/account';

type Props = {
  initialState: ReminderState;
  maskedPhone: string;
};

const RESEND_COOLDOWN_SECONDS = 60;

async function patchReminders(body: Record<string, unknown>): Promise<{
  ok: boolean;
  state: ReminderState | null;
  verificationEmailSent: boolean;
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
    verificationEmailSent?: boolean;
    message?: string;
  } | null;
  if (!response.ok) {
    return {
      ok: false,
      state: null,
      verificationEmailSent: false,
      errorMessage: json?.message ?? 'Could not save.',
    };
  }
  return {
    ok: true,
    state: json?.state ?? null,
    verificationEmailSent: json?.verificationEmailSent === true,
    errorMessage: null,
  };
}

async function resendVerification(): Promise<{
  ok: boolean;
  errorMessage: string | null;
  retryAfterMs: number | null;
}> {
  const response = await fetch('/api/account/email/verify/send', {
    method: 'POST',
    credentials: 'include',
  });
  const json = (await response.json().catch(() => null)) as {
    message?: string;
    retryAfterMs?: number;
  } | null;
  if (!response.ok) {
    return {
      ok: false,
      errorMessage: json?.message ?? 'Could not resend.',
      retryAfterMs: typeof json?.retryAfterMs === 'number' ? json.retryAfterMs : null,
    };
  }
  return { ok: true, errorMessage: null, retryAfterMs: null };
}

export function NotificationsForm({ initialState, maskedPhone }: Props) {
  const [state, setState] = useState<ReminderState>(initialState);
  const [emailDraft, setEmailDraft] = useState(state.pendingEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmailToggle, setSavingEmailToggle] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const smsOn = state.smsOptIn === 'opted_in';
  const emailOn = state.emailOptIn === 'opted_in';
  const hasPendingEmail = Boolean(state.pendingEmail);
  const hasVerifiedEmail = state.emailVerified && Boolean(state.email);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const handle = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(handle);
  }, [resendCooldown]);

  async function saveEmail() {
    const trimmed = emailDraft.trim();
    if (!trimmed) {
      setEmailError('Please enter an email address.');
      return;
    }
    setSavingEmail(true);
    setEmailError(null);
    setResendNotice(null);
    const result = await patchReminders({ pendingEmail: trimmed });
    setSavingEmail(false);
    if (!result.ok || !result.state) {
      setEmailError(result.errorMessage ?? 'Could not save.');
      return;
    }
    setState(result.state);
    if (result.verificationEmailSent) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setResendNotice('Confirmation email sent.');
    }
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

  async function resendEmail() {
    setResending(true);
    setEmailError(null);
    setResendNotice(null);
    const result = await resendVerification();
    setResending(false);
    if (!result.ok) {
      if (result.retryAfterMs && result.retryAfterMs > 0) {
        setResendCooldown(Math.ceil(result.retryAfterMs / 1000));
      }
      setEmailError(result.errorMessage ?? 'Could not resend.');
      return;
    }
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setResendNotice('Confirmation email sent.');
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-lg font-semibold">SMS reminders</h3>
              <span className="inline-flex items-center rounded-full border border-[var(--warning-border)] bg-[var(--warning-surface)] px-2 py-0.5 text-xs font-medium text-[var(--warning)]">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              SMS notifications are coming soon — this functionality isn&apos;t
              available yet. Once it&apos;s ready, we&apos;ll text {maskedPhone}{' '}
              when a new round opens.
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

      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 className="font-serif text-lg font-semibold">Email reminders</h3>
            <p className="mt-1 text-sm text-muted-foreground">
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
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Check {state.pendingEmail} for a confirmation link. It expires in 24 hours.
            </p>
            <button
              type="button"
              className="text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50"
              onClick={() => void resendEmail()}
              disabled={resending || resendCooldown > 0}
            >
              {resending
                ? 'Sending…'
                : resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : 'Resend confirmation'}
            </button>
          </div>
        ) : null}
        {hasVerifiedEmail && emailOn ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Saved. Emails will start when reminders launch.
          </p>
        ) : null}
        {resendNotice ? (
          <p className="mt-2 text-xs text-[var(--success)]">{resendNotice}</p>
        ) : null}
        {emailError ? (
          <p className="mt-2 text-xs text-destructive">{emailError}</p>
        ) : null}
      </section>

      <p className="text-xs text-muted-foreground">
        Daily reminders aren&apos;t sending yet — we&apos;re still wiring up message delivery.
        Verifying your email now means you&apos;ll be ready as soon as they launch.
      </p>
    </div>
  );
}
