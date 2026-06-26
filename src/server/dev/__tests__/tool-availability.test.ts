import { describe, expect, it } from 'vitest';

import { getExistingDevToolHrefs } from '../tool-availability';

/**
 * The route-exists check backs the "Unavailable" state on the Developer-tools
 * section. It scans the real `src/app` tree, so these assertions double as a
 * guard that the dev routes the UI links to still exist on disk.
 */
describe('getExistingDevToolHrefs', () => {
  const hrefs = getExistingDevToolHrefs();

  it('finds real /dev routes that the dev-tools UI links to', () => {
    expect(hrefs).not.toBeNull();
    expect(hrefs).toContain('/dev/first-time-player');
    expect(hrefs).toContain('/dev/flags');
    // The nested onboarding stage the dev-tools UI links to directly (the
    // /dev/onboarding hub was consolidated into the profile dev tools).
    expect(hrefs).toContain('/dev/onboarding/intro');
    // The one tool that lives outside /dev.
    expect(hrefs).toContain('/daily/summary/expand-preview');
  });

  it('does not invent routes that have no page', () => {
    expect(hrefs).not.toContain('/dev/this-route-does-not-exist');
    // The hub page was removed; its bare folder route no longer resolves.
    expect(hrefs).not.toContain('/dev/onboarding');
  });
});
