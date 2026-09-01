import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}));

import PrivacyPage from '@/app/privacy/page';
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
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/login"');
  });
});
