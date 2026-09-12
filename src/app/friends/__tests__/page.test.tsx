import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  dbSelectMock,
  listInviteReflectionsMock,
  listContactMatchesMock,
  getLastContactHashUploadMock,
  listLiveInviteLinksMock,
  getInviteLinkSeedTopicsMock,
  getMutualFriendSuggestionsMock,
  getActiveDeclaredInterestsBulkMock,
  redirectMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  dbSelectMock: vi.fn(),
  listInviteReflectionsMock: vi.fn(async () => [] as unknown[]),
  listContactMatchesMock: vi.fn(async () => [] as unknown[]),
  getLastContactHashUploadMock: vi.fn(async () => null),
  listLiveInviteLinksMock: vi.fn(async () => [] as unknown[]),
  getInviteLinkSeedTopicsMock: vi.fn(async () => [] as unknown[]),
  getMutualFriendSuggestionsMock: vi.fn(async () => [] as unknown[]),
  getActiveDeclaredInterestsBulkMock: vi.fn(async () => new Map()),
  redirectMock: vi.fn(() => {
    throw new Error('__REDIRECT__');
  }),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db', () => ({
  db: { select: dbSelectMock },
  users: { id: 'id', handle: 'handle', displayName: 'displayName', discoverableByContacts: 'dbc' },
}));
vi.mock('@/server/db/queries/contact-hashes', () => ({
  listContactMatches: listContactMatchesMock,
  getLastContactHashUpload: getLastContactHashUploadMock,
  isRefreshDue: () => false,
  markDiscoveryChecked: vi.fn(async () => {}),
}));
vi.mock('@/server/db/queries/friend-invitations', () => ({
  listInviteReflections: listInviteReflectionsMock,
}));
vi.mock('@/server/db/queries/invite-links', () => ({
  listLiveInviteLinks: listLiveInviteLinksMock,
}));
vi.mock('@/server/db/queries/friends', () => ({
  getMutualFriendSuggestions: getMutualFriendSuggestionsMock,
}));
vi.mock('@/server/db/queries/declared-interests', () => ({
  getActiveDeclaredInterestsBulk: getActiveDeclaredInterestsBulkMock,
}));
vi.mock('@/server/friends/user-invite-token', () => ({
  getInviteLinkSeedTopics: getInviteLinkSeedTopicsMock,
  buildInviteUrl: (base: string, handle: string, token: string) => `${base}/u/${handle}/${token}`,
  getBaseUrl: () => 'https://example.com',
}));
// Client islands are stubbed: this test is about which SECTIONS the server
// component renders, not their internals.
vi.mock('@/components/friends/ContactMatchBlock', () => ({
  ContactMatchBlock: () => <div data-stub="contact-match" />,
}));
vi.mock('@/components/friends/FindFriendsSearch', () => ({
  FindFriendsSearch: () => <div data-stub="find-friends-search" />,
}));
vi.mock('@/components/friends/InviteLinksSection', () => ({
  InviteLinksSection: () => <div data-stub="invite-links" />,
}));
vi.mock('@/components/friends/PersonalInviteFlow', () => ({
  PersonalInviteFlow: () => <div data-stub="personal-invite" />,
}));
vi.mock('@/components/FriendsList', () => ({ default: () => <div data-stub="friends-list" /> }));
// Captures the props the page computed (dedup + interests preview) as a JSON
// blob in the DOM, so the test can assert on them without needing the real
// client component's own interactive behavior (that's covered by
// MutualFriendSuggestionsSection.test.tsx).
vi.mock('@/components/friends/MutualFriendSuggestionsSection', () => ({
  MutualFriendSuggestionsSection: ({ initialSuggestions }: { initialSuggestions: unknown }) => (
    <div data-stub="mutual-friend-suggestions" data-props={JSON.stringify(initialSuggestions)} />
  ),
}));

import FriendsPage from '@/app/friends/page';

function mockViewer(discoverableByContacts = true) {
  dbSelectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [{ handle: 'jpalay', displayName: 'Josh', discoverableByContacts }],
      }),
    }),
  });
}

async function render() {
  const element = await FriendsPage();
  return renderToStaticMarkup(element);
}

describe('/friends page sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInviteReflectionsMock.mockResolvedValue([]);
    listContactMatchesMock.mockResolvedValue([]);
    getLastContactHashUploadMock.mockResolvedValue(null);
    listLiveInviteLinksMock.mockResolvedValue([]);
    getInviteLinkSeedTopicsMock.mockResolvedValue([]);
    getMutualFriendSuggestionsMock.mockResolvedValue([]);
    getActiveDeclaredInterestsBulkMock.mockResolvedValue(new Map());
    getSessionMock.mockResolvedValue({ userId: 'u1' });
    mockViewer();
  });

  it('omits the Suggested section ENTIRELY when there is nothing to suggest', async () => {
    // The heading used to render unconditionally, so with no contact matches
    // and no invite reflections the section was a title over a "Coming soon"
    // card -- roughly a third of the first screen saying nothing.
    const html = await render();
    expect(html).not.toContain('Suggested');
    // The rest of the page is unaffected.
    expect(html).toContain('data-stub="find-friends-search"');
    expect(html).toContain('data-stub="invite-links"');
    expect(html).toContain('data-stub="friends-list"');
  });

  it('omits the Suggested section when only contact matches exist and reflections are empty (B-FRIENDS-SAFETY-01 Phase 3)', async () => {
    // ContactMatchBlock renders unconditionally above this gate (its own
    // "data-stub" always appears), but the Suggested section's BODY only ever
    // maps `reflections` -- contactMatches never render inside it. Before this
    // fix, hasSuggestions included contactMatches.length > 0, so a viewer with
    // contact matches but zero reflections got a visible "Suggested" heading
    // over an empty card.
    listContactMatchesMock.mockResolvedValue([
      {
        id: 'u3',
        handle: 'maria',
        displayName: 'Maria',
        avatarColor: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        relationship: { state: 'none', friendshipId: null, formedAt: null, isBlocked: false },
      },
    ]);
    listInviteReflectionsMock.mockResolvedValue([]);

    const html = await render();
    expect(html).not.toContain('Suggested');
    expect(html).toContain('data-stub="contact-match"');
  });

  it('renders the Suggested section WITH its heading when reflections exist', async () => {
    // The guard must hide an empty section, not delete the label -- otherwise
    // users who DO have suggestions get an unlabelled block. This is the case
    // the browser pass could not reach (that account had no reflections).
    listInviteReflectionsMock.mockResolvedValue([
      {
        invitationId: 'inv-1',
        inviteeUserId: 'u2',
        handle: 'robyn',
        displayName: 'Robyn',
        avatarColor: '#7d2c3f',
        joinedAt: new Date('2026-09-01T00:00:00Z'),
        invitedAt: new Date('2026-08-30T00:00:00Z'),
        acceptedAt: new Date('2026-09-01T00:00:00Z'),
        relationship: { state: 'none', friendshipId: null, formedAt: null, isBlocked: false },
      },
    ]);

    const html = await render();
    expect(html).toContain('Suggested');
    expect(html).toContain('Robyn');
    // Provenance chip: a suggestion must never read as unexplained.
    expect(html).toContain('Joined from your invite');
  });

  it('never renders the retired "Coming soon" mutual-friends placeholder', async () => {
    listInviteReflectionsMock.mockResolvedValue([]);
    const html = await render();
    expect(html).not.toContain('Coming soon');
    expect(html).not.toContain('Suggested via mutual friends');
  });

  it('redirects a signed-out visitor', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('__REDIRECT__');
  });

  // B-MUTUAL-FRIEND-SUGGESTIONS-01 Phase 2a: the page's own responsibilities
  // are (1) calling the query, (2) deduping against invite reflections, and
  // (3) computing the interests preview -- all BEFORE handing off to
  // MutualFriendSuggestionsSection, whose own rendering/interaction logic is
  // covered separately in MutualFriendSuggestionsSection.test.tsx.
  describe('mutual-friend suggestions wiring', () => {
    it('always renders the section (its empty state lives inside the component, not the page)', async () => {
      getMutualFriendSuggestionsMock.mockResolvedValue([]);
      const html = await render();
      expect(html).toContain('data-stub="mutual-friend-suggestions"');
      expect(html).toContain('data-props="[]"');
    });

    it('passes displayName and mutualFriendCount through unchanged', async () => {
      getMutualFriendSuggestionsMock.mockResolvedValue([
        { id: 'u5', displayName: 'Devon', mutualFriendCount: 2 },
      ]);
      const html = await render();
      expect(html).toContain('&quot;id&quot;:&quot;u5&quot;');
      expect(html).toContain('&quot;displayName&quot;:&quot;Devon&quot;');
      expect(html).toContain('&quot;mutualFriendCount&quot;:2');
    });

    it('sets interestsPreview to null when the candidate has no active declared interests', async () => {
      getMutualFriendSuggestionsMock.mockResolvedValue([
        { id: 'u5', displayName: 'Devon', mutualFriendCount: 2 },
      ]);
      getActiveDeclaredInterestsBulkMock.mockResolvedValue(new Map());
      const html = await render();
      expect(html).toContain('&quot;interestsPreview&quot;:null');
    });

    it('computes interestsPreview as the first 3 domains, comma-joined', async () => {
      getMutualFriendSuggestionsMock.mockResolvedValue([
        { id: 'u5', displayName: 'Devon', mutualFriendCount: 2 },
      ]);
      getActiveDeclaredInterestsBulkMock.mockResolvedValue(
        new Map([
          [
            'u5',
            [
              { domain: 'Astronomy' },
              { domain: 'Baking' },
              { domain: 'Chess' },
              { domain: 'Dance' },
            ],
          ],
        ]),
      );
      const html = await render();
      expect(html).toContain('Astronomy, Baking, Chess');
      expect(html).not.toContain('Dance');
    });

    it('dedupes: a candidate already present as an invite reflection is excluded from the mutual-friend list', async () => {
      listInviteReflectionsMock.mockResolvedValue([
        {
          invitationId: 'inv-1',
          inviteeUserId: 'u2',
          handle: 'robyn',
          displayName: 'Robyn',
          avatarColor: '#7d2c3f',
          joinedAt: new Date('2026-09-01T00:00:00Z'),
          invitedAt: new Date('2026-08-30T00:00:00Z'),
          acceptedAt: new Date('2026-09-01T00:00:00Z'),
          relationship: { state: 'none', friendshipId: null, formedAt: null, isBlocked: false },
        },
      ]);
      getMutualFriendSuggestionsMock.mockResolvedValue([
        { id: 'u2', displayName: 'Robyn', mutualFriendCount: 5 }, // same id as the reflection
        { id: 'u5', displayName: 'Devon', mutualFriendCount: 2 },
      ]);

      const html = await render();
      // The reflection's own row still renders normally...
      expect(html).toContain('Joined from your invite');
      // ...but u2 is excluded from what's handed to the mutual-friend section.
      expect(html).not.toContain('&quot;id&quot;:&quot;u2&quot;');
      expect(html).toContain('&quot;id&quot;:&quot;u5&quot;');
    });
  });
});
