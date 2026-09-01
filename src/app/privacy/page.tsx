import type { Metadata } from 'next';
import Link from 'next/link';

import { getSession } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'Privacy Policy · Joshing',
  description: 'How Joshing collects, uses, and protects information.',
};

const CONTACT_EMAIL = 'Joshuapalay+joshingsupport@gmail.com';

export default async function PrivacyPage() {
  const session = await getSession();
  const backHref = session ? '/users/me' : '/login';
  const backLabel = session ? '← Back to profile' : '← Back to sign in';

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10 pb-28">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          {backLabel}
        </Link>
      </div>

      <h1 className="font-serif text-3xl font-semibold">Privacy Policy</h1>
      <p className="text-muted-foreground mt-2 text-xs">Last updated September 1, 2026</p>

      <div className="text-foreground mt-6 space-y-8 text-sm leading-6">
        <section>
          <h2 className="font-serif text-xl font-semibold">Information we collect</h2>
          <p className="mt-2">
            Joshing collects account and profile information such as your phone number, phone
            verification status, display name, call sign, optional email address, interests, and
            privacy preferences. We also store the questions, answers, game activity, connections,
            and feedback you create while using the service. We collect basic request, device, and
            product-usage information needed to operate, secure, and improve Joshing.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">How we use information</h2>
          <p className="mt-2">
            We use information to verify accounts, provide and personalize the daily game, show
            content and activity to the people allowed by your settings, maintain safety and
            reliability, answer support requests, and improve the service. We do not sell your
            personal information.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Service providers</h2>
          <p className="mt-2">
            We use service providers to host the app, store data, deliver text messages and email,
            monitor performance, and help generate or evaluate game content. They receive only the
            information needed to perform those services for Joshing and are not authorized by us to
            use it for their own marketing.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">SMS and mobile information</h2>
          <div className="mt-2 space-y-3">
            <p>
              Joshing sends a one-time verification code when you request one and, only after your
              explicit opt-in, up to one daily reminder that your questions are ready. Message and
              data rates may apply. Reply STOP to opt out or HELP for assistance.
            </p>
            <p>
              Mobile information is not shared with third parties or affiliates for marketing or
              promotional purposes. Text-message opt-in data and consent are not shared except with
              providers necessary to deliver the messaging service.
            </p>
          </div>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Retention</h2>
          <p className="mt-2">
            We keep account and game information while your account is active and as needed to
            operate Joshing. If you delete your account, we delete or de-identify account data
            except where limited retention is needed for security, fraud prevention, legal
            obligations, or reliable backups.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Security</h2>
          <p className="mt-2">
            We use reasonable technical and organizational safeguards designed to protect your
            information. No online service can guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Your choices</h2>
          <p className="mt-2">
            You can update profile and discoverability settings, turn daily SMS or email reminders
            on or off, hide questions, and delete your account from your profile. You may also reply
            STOP to reminder texts. See the{' '}
            <Link
              href="/terms"
              className="font-medium text-[var(--brand-orange)] underline underline-offset-4"
            >
              Terms &amp; Disclaimer
            </Link>{' '}
            for the SMS program terms or the public{' '}
            <Link
              href="/sms-consent"
              className="font-medium text-[var(--brand-orange)] underline underline-offset-4"
            >
              SMS consent details
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-semibold">Contact</h2>
          <p className="mt-2">
            Questions or privacy requests can be sent to{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-[var(--brand-orange)] underline underline-offset-4"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
