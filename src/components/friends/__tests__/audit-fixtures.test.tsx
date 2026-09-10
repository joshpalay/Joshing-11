import { mkdirSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import OnboardingFlow from '@/app/onboarding/OnboardingFlow';
import { IncomingRequestCard } from '@/components/FriendsList';
import { FindFriendsSearch } from '@/components/friends/FindFriendsSearch';

// Optional, synthetic visual evidence. No auth, requests or player data. Static
// rendering deliberately cannot verify interactive or cross-account behavior.
it('renders the real invitation and request components with synthetic data', () => {
  const social = renderToStaticMarkup(<main className="mx-auto max-w-2xl space-y-5 p-4">
    <FindFriendsSearch />
    <IncomingRequestCard request={{ id: 'fixture', requesterId: 'fixture-player',
      requesterName: 'Audit friend with a long display name', personalNote: 'Let’s compare what surprised us today.',
      suggestedInterests: ['Renaissance Florence'], createdAt: new Date().toISOString() }}
      pendingRequestId={null} onApprove={() => {}} onIgnore={() => {}} />
  </main>);
  const onboarding = renderToStaticMarkup(<OnboardingFlow previewMode seedSource="link"
    initialDisplayName="Audit player" initialHandle="auditfixture" inviterName="Audit friend"
    preSeededInterests={[
      { domain: 'Renaissance Florence', broadCategory: 'History' },
      { domain: 'Tennis', broadCategory: 'Sports' },
      { domain: 'Classic films', broadCategory: 'Pop Culture', fromCatalog: true },
    ]} />);
  expect(social).toContain('Renaissance Florence');
  expect(onboarding).toContain('Add your own');
  if (process.env.AUDIT_CAPTURE) {
    mkdirSync('public/images/audit-fixtures', { recursive: true });
    for (const [name, html] of Object.entries({ social, onboarding })) {
      writeFileSync(`public/images/audit-fixtures/${name}.html`, `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic audit fixture</title><link rel="stylesheet" href="/_next/static/chunks/src_app_globals_css_bad6b30c._.single.css"><body><p style="padding:12px;background:#222;color:white">SYNTHETIC COMPONENT FIXTURE · ${process.env.AUDIT_CAPTURE} · no account or network actions</p>${html}</body></html>`);
    }
  }
});
