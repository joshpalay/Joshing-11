'use client'

import Link from 'next/link'
import { useState } from 'react'

import { ReminderInterstitial } from '../ReminderInterstitial'

// Preview harness for the one-time SMS-reminder interstitial
// (D-REMINDER-INTERSTITIAL-01), so it can be reviewed from the profile's
// developer tools without having to finish a daily and land on a fresh account
// with reminder_interstitial_seen_at still null. The interstitial is rendered in
// `preview` mode — signing up or skipping here mutates nothing.
//
type Preview = null | 'sms'

export default function ReminderInterstitialPreviewPage() {
  const [preview, setPreview] = useState<Preview>(null)

  if (preview) {
    return (
      <ReminderInterstitial
        preview
        phoneNumber="+17345550123"
        onProceed={() => setPreview(null)}
      />
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
      <div className="mb-5">
        <Link
          href="/users/me"
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Profile
        </Link>
      </div>

      <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
        Reminder interstitial preview
      </h1>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        The one-time full-screen SMS-reminder ask, shown when a player leaves the daily-Five
        summary via a <code>/</code> exit (the ✕, the &ldquo;Session recap&rdquo; link, or
        &ldquo;Back home&rdquo;). It renders in preview mode &mdash; &ldquo;Text me&rdquo; and
        &ldquo;Not now&rdquo; change nothing on your account.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setPreview('sms')}
          className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-card)] px-4 py-3 text-left transition hover:bg-[var(--brand-cream-page)]"
        >
          <span className="block text-sm font-semibold text-[var(--brand-ink)]">
            Preview SMS reminder
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            &ldquo;Text me&rdquo; opts in with the verified account phone in one tap.
          </span>
        </button>
      </div>
    </main>
  )
}
