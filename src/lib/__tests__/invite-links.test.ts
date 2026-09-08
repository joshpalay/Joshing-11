import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INVITE_LINK_TITLE,
  hasValidInviteLinkCategories,
  inviteAcceptanceLabel,
  inviteGreatestHitsTitle,
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

  it('sanitizes stored card titles and falls back for legacy links', () => {
    expect(inviteLinkCardTitle('  Movie   night  ')).toBe('Movie night');
    expect(inviteLinkCardTitle(null)).toBe(DEFAULT_INVITE_LINK_TITLE);
    expect(inviteLinkCardTitle('   ')).toBe(DEFAULT_INVITE_LINK_TITLE);
  });
});
