import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getReminderState } from '@/server/db/queries/account';
import { formatUsPhoneInput } from '@/lib/phone-e164';

import { RemindersLinkCard } from './RemindersLinkCard';

// D-REMINDER-LINK-01 — a standalone "turn on texts" page, reached two ways:
// straight after a successful OTP login (verify-otp's offerReminders flag
// routes here instead of home), or by a link shared by hand.
//
// Why it exists: SMS opt-in is gated on phone_verified
// (deriveReminderAcquisitionState returns 'unavailable' without it), and
// accounts created while the OTP was universally bypassable never verified a
// real handset — they typed a number and a code that always worked. For those
// players every reminder ask in the product has been silently suppressed
// since signup: neither the onboarding ask nor the daily-summary interstitial
// ever ran. A genuine OTP is the first moment the offer can be accepted,
// which is why login routes here rather than nudging them later.
//
// Consent itself is unchanged: same PATCH /api/account/reminders write path
// and same disclosure copy as every other ask. Logging in never opts anyone
// in — it only makes the button possible to press.
//
// The Twilio A2P campaign is deliberately narrow (see isSmsMessageTypeEnabled
// in src/server/sms.ts) and does not include invitation texts, so this page
// is never linked BY an SMS the app sends — only shared by hand.
export default async function RemindersLinkPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const state = await getReminderState(session.userId);
  if (!state) redirect('/login');

  return (
    <main className="min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <RemindersLinkCard
        phoneNumber={state.phoneVerified ? formatUsPhoneInput(state.phoneNumber) : null}
        phoneVerified={state.phoneVerified}
        alreadyOptedIn={state.smsOptIn === 'opted_in'}
      />
    </main>
  );
}
