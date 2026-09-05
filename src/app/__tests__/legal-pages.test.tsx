import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}));

import PrivacyPage from '@/app/privacy/page';
import SmsConsentPage from '@/app/sms-consent/page';
import TermsPage from '@/app/terms/page';

describe('public legal pages', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(null);
  });

  it('renders the Privacy Policy for a signed-out visitor', async () => {
    const html = renderToStaticMarkup(await PrivacyPage());
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Reply STOP to opt out or HELP for assistance');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/login"');
  });

  it('renders Terms and SMS Terms for a signed-out visitor', async () => {
    const html = renderToStaticMarkup(await TermsPage());
    expect(html).toContain('Terms &amp; Disclaimer');
    expect(html).toContain('SMS Terms');
    expect(html).toContain('Consent to receive reminder texts is not a condition of purchase');
    expect(html).toContain('Carriers are not liable for delayed or undelivered messages');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/sms-consent"');
    expect(html).toContain('href="/login"');
  });

  it('renders the SMS consent program details for a signed-out visitor', async () => {
    const html = renderToStaticMarkup(await SmsConsentPage());
    expect(html).toContain('SMS Consent &amp; Program Details');
    expect(html).toContain('Daily reminders are separate from account verification');
    expect(html).toContain(
      'By selecting Continue, you agree to receive one automated Joshing verification text',
    );
    expect(html).toContain(
      'you agree to receive automated Joshing reminder texts',
    );
    expect(html).toContain('final onboarding screen');
    expect(html).toContain('Reply STOP to unsubscribe or HELP for help');
    expect(html).toContain('Consent is not a condition of purchase');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('src="/compliance/otp-request.png"');
    expect(html).toContain('src="/compliance/daily-sms-reminder.png"');
    expect(html).toContain('src="/compliance/onboarding-sms-reminder.png"');
    expect(html).toContain('src="/compliance/daily-summary-sms-reminder.png"');
    expect(html).toContain('reserved 555 demo number');
    expect(html).toContain('does not submit the number or request a code');
    expect(html).toContain('cannot opt anyone in');
    expect(html).toContain('SMS reminders visibly switched off');
    expect(html).toContain('never shown again whether accepted or declined');
    expect(html).toContain('Sign in to manage SMS reminders');
  });

  it('links authenticated readers directly to the real notification settings control', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    const html = renderToStaticMarkup(await SmsConsentPage());
    expect(html).toContain('href="/users/me#notifications"');
    expect(html).toContain('Manage SMS reminders');
  });
});
