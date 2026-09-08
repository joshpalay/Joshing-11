import { describe, expect, it } from 'vitest';

import {
  hasValidInviteLinkCategories,
  inviteGreatestHitsTitle,
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
});
