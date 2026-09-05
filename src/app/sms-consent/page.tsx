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
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          {session ? '← Back to profile' : '← Back to sign in'}
        </Link>
      </div>

      <h1 className="font-serif text-3xl font-semibold">SMS Consent &amp; Program Details</h1>
      <p className="text-muted-foreground mt-4 text-sm leading-6">
        Joshing SMS is limited to requested account verification codes and one optional daily
        reminder that your questions are ready.
      </p>

      <div className="text-foreground mt-8 space-y-8 text-sm leading-6">
        <section>
          <h2 className="font-serif text-xl font-semibold">Verification codes</h2>
          <p className="mt-2">
            When you enter your phone number and continue, you request a one-time Joshing
            verification code. Verification messages are sent only when requested. Message and data
            rates may apply.
          </p>
          <blockquote className="mt-4 rounded-[var(--radius-md)] border border-[var(--accent-gold)]/40 bg-[var(--brand-cream-card)] p-4">
            “By selecting Continue, you agree to receive one automated Joshing verification text at
            this number. Message and data rates may apply. Reply STOP to unsubscribe or HELP for
            help. Consent is not a condition of purchase. Terms and Privacy.”
          </blockquote>
          <figure className="bg-card mt-5 overflow-hidden rounded-[var(--radius-md)] border shadow-sm">
            {/* Twilio requires a visible, unoptimized screenshot evidence image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/compliance/otp-request.png"
              alt="Joshing phone verification screen with the demo number (202) 555-0147, a Continue button, explicit agreement to receive one verification text, rate disclosure, STOP and HELP instructions, no-purchase-condition language, and Terms and Privacy links"
              width="916"
              height="768"
              className="h-auto w-full"
            />
            <figcaption className="text-muted-foreground border-t px-4 py-3 text-xs leading-5">
              Joshing&apos;s production OTP request interface, shown with a reserved 555 demo
              number. The evidence image is informational and does not submit the number or request
              a code.
            </figcaption>
          </figure>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Optional daily reminder</h2>
          <p className="mt-2">
            Daily reminders are separate from account verification and are off by default. After
            signing in with a verified phone number, you may opt in on the final onboarding screen,
            in the one-time Daily Summary follow-up, or later under Profile → Notifications. Each
            consent control identifies its action and displays:
          </p>
          <blockquote className="mt-4 rounded-[var(--radius-md)] border border-[var(--accent-gold)]/40 bg-[var(--brand-cream-card)] p-4">
            “By choosing [the opt-in action], you agree to receive automated Joshing reminder texts
            at your verified number, up to one message per day. Message and data rates may apply.
            Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase.
            Terms and Privacy.”
          </blockquote>
          <p className="mt-4">
            Reminder frequency is up to one message per day. Consent is not a condition of purchase.
            You can turn reminders off at any time in your profile or by replying STOP.
          </p>
          <figure className="bg-card mt-5 overflow-hidden rounded-[var(--radius-md)] border shadow-sm">
            {/* Twilio requires a visible, unoptimized screenshot evidence image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/compliance/daily-sms-reminder.png"
              alt="Joshing profile Notifications screen with SMS reminders visibly switched off and explicit agreement language covering automated reminder texts, up to one message per day, rates, STOP and HELP, no purchase condition, Terms, and Privacy"
              width="917"
              height="537"
              className="h-auto w-full"
            />
            <figcaption className="text-muted-foreground border-t px-4 py-3 text-xs leading-5">
              Joshing&apos;s production reminder preference interface in its default-off state,
              shown with a reserved 555 demo number. This evidence image is informational and cannot
              opt anyone in.
            </figcaption>
          </figure>
          <figure className="bg-card mt-5 overflow-hidden rounded-[var(--radius-md)] border shadow-sm">
            {/* Twilio requires a visible, unoptimized screenshot evidence image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/compliance/onboarding-sms-reminder.png"
              alt="Joshing onboarding reminder choice with a Continue with SMS reminders button, Continue without reminders link, verified demo number, frequency, rates, STOP and HELP, no-purchase-condition language, Terms, and Privacy"
              width="390"
              height="700"
              className="mx-auto h-auto w-full max-w-sm"
            />
            <figcaption className="text-muted-foreground border-t px-4 py-3 text-xs leading-5">
              The production onboarding opt-in screen, shown with a reserved 555 demo number. The
              choice is optional; continuing without reminders completes setup without consent.
            </figcaption>
          </figure>
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

      <div className="bg-card mt-10 rounded-[var(--radius-md)] border p-5">
        <Link href={manageHref} className="btn-primary inline-flex min-h-11 items-center">
          {manageLabel}
        </Link>
        <p className="text-muted-foreground mt-4 text-xs leading-5">
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
