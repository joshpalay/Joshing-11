import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import OnboardingFlow from '@/app/onboarding/OnboardingFlow';
import { IncomingRequestCard } from '@/components/FriendsList';
import { FindFriendsSearch } from '../FindFriendsSearch';
import { AddFriendButton } from '../AddFriendButton';
import { InvitationLandingContent } from '@/components/invite/InvitationLanding';

describe('honest invitation and friendship language', () => {
  const interests = [{ domain: 'Renaissance Florence', broadCategory: 'History' }];
  function onboarding(seedSource: 'named' | 'link', catalog = false) {
    return renderToStaticMarkup(<OnboardingFlow previewMode seedSource={seedSource}
      initialDisplayName="Audit" initialHandle="auditfixture" inviterName="Audit friend"
      preSeededInterests={catalog ? [...interests, { domain: 'Tennis', broadCategory: 'Sports', fromCatalog: true }] : interests} />);
  }
  it.each([false, true])('does not claim reusable topics were personally picked (catalog=%s)', (catalog) => {
    const html = onboarding('link', catalog);
    expect(html).toContain('These starting topics come from Audit friend');
    expect(html).not.toContain('picked');
    expect(html).toContain('Remove Renaissance Florence'); // defaults are unchanged
    if (catalog) {
      expect(html).toContain('From Joshing');
      expect(html).not.toContain('Remove Tennis'); // system top-up still requires selection
    }
  });
  it('preserves actual named-inviter credit', () => {
    expect(onboarding('named')).toContain('picked these for you');
  });
  it('distinguishes named and reusable invitation landing provenance', () => {
    const render = (seedSource: 'named' | 'link') => renderToStaticMarkup(
      <InvitationLandingContent seedSource={seedSource} inviterName="Audit friend" categories={interests} action={<button>Continue</button>} />);
    expect(render('link')).not.toContain('picked');
    expect(render('link')).toContain('These topics come with this invitation');
    expect(render('named')).toContain('picked a few categories');
  });
  it('explains an actual mutual friendship and a silent decline in the hub', () => {
    const html = renderToStaticMarkup(<IncomingRequestCard request={{ id: 'request', requesterId: 'fixture',
      requesterName: 'Audit friend', personalNote: null, suggestedInterests: [], createdAt: new Date().toISOString() }}
      pendingRequestId={null} onApprove={() => {}} onIgnore={() => {}} />);
    expect(html).toContain('Wants to be friends');
    expect(html).toContain('Declining won’t notify them');
    expect(html).toContain('Accept friend request from Audit friend');
    expect(html).toContain('Decline friend request from Audit friend');
    expect(html).not.toContain('follow you');
  });
  it('matches search/profile incoming actions to Home and the hub', () => {
    const html = renderToStaticMarkup(<AddFriendButton targetUserId="fixture" targetDisplayName="Audit friend"
      relationship={{ state: 'pending_inbound', friendshipId: 'request', formedAt: null, isBlocked: false }} />);
    expect(html).toContain('Accept');
    expect(html).toContain('Decline');
    expect(html).not.toContain('Not now');
  });
  it('names the exact-search input and announces asynchronous state', () => {
    const html = renderToStaticMarkup(<FindFriendsSearch />);
    expect(html).toContain('aria-label="Find a player by username or US phone number"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Find an existing player');
  });
  it('uses username in account setup', () => {
    const html = renderToStaticMarkup(<OnboardingFlow previewMode preSeededInterests={[]} />);
    expect(html).toContain('Your username');
    expect(html).not.toContain('call sign');
  });
});
