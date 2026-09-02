import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  NotificationsForm,
  smsOptInForChecked,
} from '@/components/profile/settings/NotificationsForm';
import type { ReminderState } from '@/server/db/queries/account';

const initialState: ReminderState = {
  smsOptIn: 'not_asked',
  emailOptIn: 'not_asked',
  emailVerified: false,
  email: null,
  pendingEmail: null,
  phoneNumber: '+17345550123',
  smsOptInAt: null,
  smsOptOutAt: null,
  smsConsentSource: null,
  smsConsentPolicyVersion: null,
  reminderPromptDismissedAt: null,
  reminderInterstitialSeenAt: null,
};

describe('NotificationsForm SMS consent', () => {
  it('defaults an unasked user off and shows the complete disclosure and policy links', () => {
    const html = renderToStaticMarkup(
      <NotificationsForm initialState={initialState} phone="(734) 555-0123" />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain(
      'By turning on SMS reminders, you agree to receive automated Joshing reminder texts',
    );
    expect(html).toContain('up to one message per day');
    expect(html).toContain('Message and data rates may apply');
    expect(html).toContain('Reply <strong>STOP</strong> to unsubscribe');
    expect(html).toContain('<strong>HELP</strong> for help');
    expect(html).toContain('Consent is not a condition of purchase');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('Coming soon');
  });

  it('maps switch changes to the exact API values', () => {
    expect(smsOptInForChecked(true)).toBe('opted_in');
    expect(smsOptInForChecked(false)).toBe('opted_out');
  });
});
