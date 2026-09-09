import { describe, expect, it } from 'vitest';

import {
  hasValidInviteLinkCategories,
  inviteAcceptanceLabel,
  inviteGreatestHitsTitle,
  inviteLinkBroadCategorySummary,
  inviteLinkCardTitle,
  safeInviteName,
  sanitizeInviteLinkCategories,
} from '@/lib/invite-links';

describe('invite-link presentation guards', () => {
  it('removes placeholders, blanks, malformed entries, and duplicates', () => {
    expect(
      sanitizeInviteLinkCategories([
        null,
        '',
        'No category',
        'undefined',
        { label: ' Jazz ', broad_category: 'Music' },
        { label: 'jazz' },
        { nope: 'Poetry' },
      ]),
    ).toEqual([{ label: 'Jazz', broadCategory: 'Music' }]);
  });

  it('requires at least one valid category', () => {
    expect(hasValidInviteLinkCategories(['No category', ' '])).toBe(false);
    expect(hasValidInviteLinkCategories([{ label: 'Sondheim' }])).toBe(true);
  });

  it('never treats a phone or handle as an inviter name', () => {
    expect(safeInviteName('+1 (734) 555-0123')).toBeNull();
    expect(safeInviteName('@private-id')).toBeNull();
    expect(inviteGreatestHitsTitle('+1 (734) 555-0123')).toBe('Play the greatest hits');
    expect(inviteGreatestHitsTitle(null, true)).toBe('Play your greatest hits');
  });

  it('builds a recipient action from a safe inviter name with a neutral fallback', () => {
    expect(inviteAcceptanceLabel('Duo Prova')).toBe('Accept Duo Prova’s invitation');
    expect(inviteAcceptanceLabel(null)).toBe('Accept invitation');
    expect(inviteAcceptanceLabel('+1 (734) 555-0123')).toBe('Accept invitation');
  });

  it('summarizes a link’s categories by their broad group, deduped', () => {
    expect(inviteLinkBroadCategorySummary([{ label: 'Jazz' }])).toBe('Jazz');
    expect(
      inviteLinkBroadCategorySummary([
        { label: 'Ulysses (Joyce Novel)', broadCategory: 'Literature' },
        { label: 'Hamlet', broadCategory: 'Literature' },
        { label: 'Bach', broadCategory: 'Music' },
      ]),
    ).toBe('Literature & Music');
    expect(inviteLinkBroadCategorySummary([])).toBe('Invitation link');
  });

  it('titles the default link with the greatest-hits phrase and other links by broad category', () => {
    expect(
      inviteLinkCardTitle([{ label: 'Jazz' }], { isDefaultLink: true, creatorName: 'Josh' }),
    ).toBe('Josh’s greatest hits');
    expect(inviteLinkCardTitle([{ label: 'Jazz' }], { isDefaultLink: true })).toBe(
      'Your greatest hits',
    );
    expect(
      inviteLinkCardTitle([{ label: 'Music' }, { label: 'Star Wars' }], {
        isDefaultLink: false,
      }),
    ).toBe('Music & Star Wars');
  });
});
