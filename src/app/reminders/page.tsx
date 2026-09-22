import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getReminderState } from '@/server/db/queries/account';
import { formatUsPhoneInput } from '@/lib/phone-e164';

import { RemindersLinkCard } from './RemindersLinkCard';

// D-REMINDER-LINK-01 — a standalone, shareable "turn on texts" page. Every
// in-app reminder ask fires at most once per account
// (deriveReminderAcquisitionState retires the ask after onboarding or the one
// daily-summary interstitial), so an inviter who wants to nudge people who
// already joined but skipped reminders has no in-app surface to point them
// at. This route is that surface: it reuses the same consent write path
// (PATCH /api/account/reminders) and disclosure copy as every other ask, just
// reachable by a link an inviter can paste into a text or group chat.
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
