'use client';

import { useState } from 'react';
import Link from 'next/link';

import { SmsReminderDisclosure } from '@/components/reminders/SmsReminderDisclosure';

type State =
  | { kind: 'ask'; error: string | null }
  | { kind: 'working' }
  | { kind: 'done' };

async function optIn(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch('/api/account/reminders', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ smsOptIn: 'opted_in', smsConsentSource: 'reminder_link_web_form' }),
    });
    const json = (await response.json().catch(() => null)) as { message?: string } | null;
    if (!response.ok) {
      return { ok: false, message: json?.message ?? "Couldn't turn on text reminders." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't turn on text reminders. Check your connection." };
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative z-10 mx-auto w-full max-w-md rounded-[var(--radius-md)] bg-[var(--brand-cream-card)] px-6 py-8 shadow-[0_4px_4px_0_rgba(0,0,0,0.25),var(--shadow-card)] ring-1 ring-black/5 sm:px-10 sm:py-10">
      {children}
    </section>
  );
}

function Wordmark() {
  return (
    <p className="font-wordmark text-quiet mb-3 font-bold tracking-[0.18em] text-[var(--brand-navy)] uppercase">
      Joshing
    </p>
  );
}

export function RemindersLinkCard({
  phoneNumber,
  phoneVerified,
  alreadyOptedIn,
}: {
  phoneNumber: string | null;
  phoneVerified: boolean;
  alreadyOptedIn: boolean;
}) {
  const [state, setState] = useState<State>(
    alreadyOptedIn ? { kind: 'done' } : { kind: 'ask', error: null },
  );

  async function handleOptIn() {
    setState({ kind: 'working' });
    const result = await optIn();
    if (result.ok) {
      setState({ kind: 'done' });
      return;
    }
    setState({ kind: 'ask', error: result.message });
  }

  if (!phoneVerified) {
    return (
      <Card>
        <Wordmark />
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink-950)]">
          Verify your phone first
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          Text reminders need a verified phone number on your account. Add and verify one in
          Settings, then come back to this link.
        </p>
        <Link href="/users/me#notifications" className="btn-primary mt-6 inline-flex w-full">
          Go to Settings
        </Link>
      </Card>
    );
  }

  if (state.kind === 'done') {
    return (
      <Card>
        <Wordmark />
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink-950)]">
          You&rsquo;re all set
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          We&rsquo;ll text you at {phoneNumber ?? 'your account phone number'} when each day&rsquo;s
          five open.
        </p>
        <Link href="/daily" className="btn-primary mt-6 inline-flex w-full">
          Go to today&rsquo;s five
        </Link>
      </Card>
    );
  }

  const saving = state.kind === 'working';

  return (
    <Card>
      <Wordmark />
      <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink-950)]">
        Get a text when your five open
      </h1>
      <p className="text-muted-foreground mt-3 text-sm leading-6">
        One note a day, only when there&rsquo;s something new to answer. No spam, and you can turn
        it off anytime.
      </p>

      <div className="mt-6 space-y-4">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => void handleOptIn()}
          disabled={saving}
        >
          {saving ? 'Turning on…' : 'Text me the daily five'}
        </button>
        <SmsReminderDisclosure phoneNumber={phoneNumber} actionLabel="Text me the daily five" />
        {state.kind === 'ask' && state.error ? (
          <p className="text-destructive text-sm" role="alert">
            {state.error}
          </p>
        ) : null}
        <Link href="/daily" className="btn-ghost inline-flex w-full">
          Not right now
        </Link>
      </div>
    </Card>
  );
}
