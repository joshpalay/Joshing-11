import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { AccountActions } from '../AccountActions';

/**
 * The Developer-tools section is grouped under eyebrow labels, and each link
 * tool participates in a route-exists check driven by `availableToolHrefs`.
 */
describe('AccountActions — dev-tools grouping & availability', () => {
  it('renders the four eyebrow groups', () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin />);
    expect(html).toContain('First-time experience');
    expect(html).toContain('Growth');
    expect(html).toContain('Game &amp; session');
    expect(html).toContain('Diagnostics &amp; flags');
  });

  // Stage 6 of the invite-link build: entry points to the new screens/flows.
  it('the Growth group links to the invite-link previews and the live Friends pages', () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin />);
    expect(html).toContain('href="/dev/invite-login?screen=linkCard"');
    expect(html).toContain('href="/dev/onboarding/intro?seedSource=link"');
    expect(html).toContain('href="/friends"');
    expect(html).toContain('href="/friends/find"');
  });

  it('never dims /friends or /friends/find, even when availableToolHrefs omits them', () => {
    // getExistingDevToolHrefs only ever scans /dev/* and /admin/* — a real
    // core route like /friends was never a candidate for that WIP-existence
    // check. An unavailable row renders as a plain <div> with no href at all
    // (see SettingsRow), so the mere presence of these hrefs as real links
    // proves they weren't dimmed.
    const html = renderToStaticMarkup(
      <AccountActions isAdmin availableToolHrefs={['/dev/first-time-player']} />,
    );
    expect(html).toContain('href="/friends"');
    expect(html).toContain('href="/friends/find"');
  });

  it('fails open (no Unavailable pill) when availableToolHrefs is omitted', () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin />);
    expect(html).not.toContain('Unavailable');
  });

  it('marks a tool Unavailable when its href is absent from the available set', () => {
    // Provide a set that omits /dev/flags — it should render dimmed/inert.
    const html = renderToStaticMarkup(
      <AccountActions isAdmin availableToolHrefs={['/dev/first-time-player']} />,
    );
    expect(html).toContain('Unavailable');
    // The available one is a real link; the omitted one is not.
    expect(html).toContain('href="/dev/first-time-player"');
    expect(html).not.toContain('href="/dev/flags"');
  });

  it("always renders the inline action tool (Reset today's Daily Five) regardless of the available set", () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin availableToolHrefs={[]} />);
    expect(html).toContain('Reset today&#x27;s Daily Five');
    // B-10.1: the retired "Create test game" label must not come back.
    expect(html).not.toContain('Create test game');
  });

  it('surfaces the admin bulk-upload link only to admins', () => {
    const adminHtml = renderToStaticMarkup(<AccountActions isAdmin />);
    expect(adminHtml).toContain('Bulk upload questions');
    expect(adminHtml).toContain('href="/admin/bulk-upload"');

    // Non-admins (the ungated section still renders, but the Admin group does not).
    const nonAdminHtml = renderToStaticMarkup(<AccountActions isAdmin={false} />);
    expect(nonAdminHtml).not.toContain('Bulk upload questions');
  });
});
