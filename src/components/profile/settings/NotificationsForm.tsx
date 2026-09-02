'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Switch } from '@/components/ui/Switch';
import type { ReminderState } from '@/server/db/queries/account';

type Props = {
  initialState: ReminderState;
  phone: string;
};

const RESEND_COOLDOWN_SECONDS = 60;

export function smsOptInForChecked(checked: boolean): 'opted_in' | 'opted_out' {
  return checked ? 'opted_in' : 'opted_out';
}

async function patchReminders(body: Record<string, unknown>): Promise<{
  ok: boolean;
  state: ReminderState | null;
  verificationEmailSent: boolean;
  smsConfirmationSent: boolean;
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
    smsConfirmationSent?: boolean;
    message?: string;
  } | null;
  if (!response.ok) {
    return {
      ok: false,
      state: null,
      verificationEmailSent: false,
      smsConfirmationSent: false,
      errorMessage: json?.message ?? 'Could not save.',
    };
  }
  return {
    ok: true,
    state: json?.state ?? null,
    verificationEmailSent: json?.verificationEmailSent === true,
    smsConfirmationSent: json?.smsConfirmationSent === true,
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

export function NotificationsForm({ initialState, phone }: Props) {
  const [state, setState] = useState<ReminderState>(initialState);
  const [emailDraft, setEmailDraft] = useState(state.pendingEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmailToggle, setSavingEmailToggle] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [editingEmail, setEditingEmail] = useState(false);
  const [savingSms, setSavingSms] = useState(false);
  const [smsNotice, setSmsNotice] = useState<string | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);

  const smsOn = state.smsOptIn === 'opted_in';
  const emailOn = state.emailOptIn === 'opted_in';
  const hasPendingEmail = Boolean(state.pendingEmail);
  const hasVerifiedEmail = state.emailVerified && Boolean(state.email);
  // Show the address input for a brand-new email, or when a verified user has
  // tapped "Change email". A pending change to an already-verified address
  // leaves the old one in force until the new link is confirmed.
  const showEmailInput = !hasVerifiedEmail || editingEmail;
  const pendingIsChange = hasPendingEmail && hasVerifiedEmail;

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
    if (trimmed.toLowerCase() === (state.email ?? '').toLowerCase()) {
      setEmailError('That’s already your confirmed email.');
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
    setEditingEmail(false);
    if (result.verificationEmailSent) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setResendNotice('Confirmation email sent.');
    }
  }

  function startEditingEmail() {
    setEmailDraft('');
    setEmailError(null);
    setResendNotice(null);
    setEditingEmail(true);
  }

  function cancelEditingEmail() {
    setEditingEmail(false);
    setEmailDraft(state.pendingEmail ?? '');
    setEmailError(null);
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

  async function toggleSms(checked: boolean) {
    setSavingSms(true);
    setSmsError(null);
    setSmsNotice(null);
    const next = smsOptInForChecked(checked);
    const result = await patchReminders({ smsOptIn: next });
    setSavingSms(false);
    if (!result.ok || !result.state) {
      setSmsError(result.errorMessage ?? 'Could not save SMS reminder preference.');
      return;
    }
    setState(result.state);
    setSmsNotice(
      checked
        ? result.smsConfirmationSent
          ? 'Daily SMS reminders are on. Confirmation text sent.'
          : 'Daily SMS reminders are on.'
        : 'Daily SMS reminders are off.',
    );
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
      <section className="bg-card text-card-foreground rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 className="font-serif text-lg font-semibold">SMS reminders</h3>
            <p id="sms-reminder-consent" className="text-muted-foreground mt-1 text-sm">
              By turning on SMS reminders, you agree to receive automated Joshing reminder texts at{' '}
              {phone}, up to one message per day. Message and data rates may apply. Reply{' '}
              <strong>STOP</strong> to unsubscribe or <strong>HELP</strong> for help. Consent is not
              a condition of purchase.{' '}
              <Link href="/terms" className="font-medium underline underline-offset-2">
                Terms
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="font-medium underline underline-offset-2">
                Privacy
              </Link>
              .
            </p>
          </div>
          <Switch
            checked={smsOn}
            onCheckedChange={(checked) => void toggleSms(checked)}
            label="SMS reminders"
            aria-describedby="sms-reminder-consent"
            disabled={savingSms}
          />
        </div>
        {savingSms ? (
          <p className="text-muted-foreground mt-3 text-xs" role="status" aria-live="polite">
            Saving SMS reminder preference…
          </p>
        ) : null}
        {smsNotice ? (
          <p className="mt-3 text-xs text-[var(--success)]" role="status" aria-live="polite">
            {smsNotice}
          </p>
        ) : null}
        {smsError ? (
          <p className="text-destructive mt-3 text-xs" role="alert">
            {smsError}
          </p>
        ) : null}
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
            {hasVerifiedEmail && !editingEmail ? (
              <button
                type="button"
                className="mt-2 self-start text-xs font-medium underline-offset-2 hover:underline"
                onClick={startEditingEmail}
              >
                Change email
              </button>
            ) : null}
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

        {showEmailInput ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={hasVerifiedEmail ? 'new@example.com' : 'you@example.com'}
              value={emailDraft}
              disabled={savingEmail}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                setEmailError(null);
              }}
              className="flex-1 rounded-lg border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 py-2 text-sm focus:border-[var(--brand-navy)]"
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => void saveEmail()}
              disabled={savingEmail}
            >
              {savingEmail
                ? 'Saving…'
                : hasVerifiedEmail
                  ? 'Send confirmation'
                  : hasPendingEmail
                    ? 'Update'
                    : 'Save'}
            </button>
            {editingEmail ? (
              <button
                type="button"
                className="text-muted-foreground text-sm underline-offset-2 hover:underline disabled:opacity-50"
                onClick={cancelEditingEmail}
                disabled={savingEmail}
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}

        {hasPendingEmail ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              {pendingIsChange
                ? `Confirm ${state.pendingEmail} to switch your reminder address. Until then, we’ll keep emailing ${state.email}.`
                : `Check ${state.pendingEmail} for a confirmation link. It expires in 24 hours.`}
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
          <p className="text-muted-foreground mt-3 text-xs">
            On. We&apos;ll email you each day when your five are ready.
          </p>
        ) : null}
        {resendNotice ? <p className="mt-2 text-xs text-[var(--success)]">{resendNotice}</p> : null}
        {emailError ? <p className="text-destructive mt-2 text-xs">{emailError}</p> : null}
      </section>

      <p className="text-muted-foreground text-xs">
        Once your email is confirmed and reminders are on, we&apos;ll send a daily nudge when your
        five are ready — with a no-spoiler peek at the first question.
      </p>
    </div>
  );
}
