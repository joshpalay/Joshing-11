import type { Metadata } from 'next';
import Link from 'next/link';

import { getSession } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'SMS Consent · Joshing',
  description: 'How Joshing SMS verification codes and optional daily reminders work.',
};

const CONTACT_EMAIL = 'Joshuapalay+joshingsupport@gmail.com';

export default async function SmsConsentPage() {
  const session = await getSession();
  const manageHref = session ? '/users/me#notifications' : '/login';
  const manageLabel = session ? 'Manage SMS reminders' : 'Sign in to manage SMS reminders';

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10 pb-28">
      <div className="mb-6">
        <Link
          href={session ? '/users/me' : '/login'}
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          {session ? '← Back to profile' : '← Back to sign in'}
        </Link>
      </div>

      <h1 className="font-serif text-3xl font-semibold">SMS Consent &amp; Program Details</h1>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Joshing SMS is limited to requested account verification codes and one optional daily
        reminder that your questions are ready.
      </p>

      <div className="mt-8 space-y-8 text-sm leading-6 text-foreground">
        <section>
          <h2 className="font-serif text-xl font-semibold">Verification codes</h2>
          <p className="mt-2">
            When you enter your phone number and continue, you request a one-time Joshing
            verification code. Verification messages are sent only when requested. Message and
            data rates may apply.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Optional daily reminder</h2>
          <p className="mt-2">
            Daily reminders are separate from account verification and are off by default. After
            signing in with a verified phone number, you can turn them on under Profile →
            Notifications. The consent control displays:
          </p>
          <blockquote className="mt-4 rounded-[var(--radius-md)] border border-[var(--accent-gold)]/40 bg-[var(--brand-cream-card)] p-4">
            “Get one Joshing reminder each day when your questions are ready. Message and data
            rates may apply. Reply STOP to opt out or HELP for help.”
          </blockquote>
          <p className="mt-4">
            Reminder frequency is up to one message per day. Consent is not a condition of
            purchase. You can turn reminders off at any time in your profile or by replying STOP.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Your choices and support</h2>
          <p className="mt-2">
            Reply STOP to opt out of reminder messages. Reply HELP for help, or email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-[var(--brand-orange)] underline underline-offset-4"
            >
              {CONTACT_EMAIL}
            </a>
            . Turning off reminders does not prevent you from requesting a future account
            verification code.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Mobile information</h2>
          <p className="mt-2">
            Mobile information is not shared with third parties or affiliates for marketing or
            promotional purposes. Text-message opt-in data and consent are not shared except with
            providers necessary to deliver the messaging service.
          </p>
        </section>
      </div>

      <div className="mt-10 rounded-[var(--radius-md)] border bg-card p-5">
        <Link href={manageHref} className="btn-primary inline-flex min-h-11 items-center">
          {manageLabel}
        </Link>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Review the{' '}
          <Link href="/terms" className="font-medium underline underline-offset-2">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="font-medium underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
