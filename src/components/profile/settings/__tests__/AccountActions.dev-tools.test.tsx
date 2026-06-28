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
  it('renders the three eyebrow groups', () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin />);
    expect(html).toContain('First-time experience');
    expect(html).toContain('Game &amp; session');
    expect(html).toContain('Diagnostics &amp; flags');
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

  it('always renders the inline action tool (Create test game) regardless of the available set', () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin availableToolHrefs={[]} />);
    expect(html).toContain('Create test game');
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
