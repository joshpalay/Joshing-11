import { describe, expect, it } from 'vitest';

import {
  composeDiscoveryAttribution,
  type DiscoveryItemInput,
  type DiscoveryPerson,
} from '@/server/feed/discovery-attribution';

const VIEWER = 'viewer';

// A name resolver that returns a stable person for any id (the DB layer would
// have filtered to resolvable ids before calling compose).
const person = (userId: string): DiscoveryPerson => ({
  userId,
  displayName: userId.toUpperCase(),
  href: `/users/${userId}`,
});

function compose(
  items: DiscoveryItemInput[],
  opts: {
    strangers?: string[];
    authorOptedIn?: string[];
    forwardOptedIn?: string[];
  } = {},
) {
  return composeDiscoveryAttribution(items, {
    viewerUserId: VIEWER,
    strangerIds: new Set(opts.strangers ?? []),
    authorOptedIn: new Set(opts.authorOptedIn ?? []),
    forwardOptedIn: new Set(opts.forwardOptedIn ?? []),
    person,
  });
}

describe('composeDiscoveryAttribution', () => {
  it('surfaces both author and via when each is a stranger + opted-in + public', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: true }],
      { strangers: ['maria', 'butt'], authorOptedIn: ['maria'], forwardOptedIn: ['butt'] },
    );
    expect(result.get('f1')).toEqual({
      author: person('maria'),
      via: person('butt'),
    });
  });

  it('drops a non-public question entirely (gates both signals)', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: false }],
      { strangers: ['maria', 'butt'], authorOptedIn: ['maria'], forwardOptedIn: ['butt'] },
    );
    expect(result.has('f1')).toBe(false);
  });

  it('excludes the viewer from their own author/via slots', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: VIEWER, viaUserId: VIEWER, isPublic: true }],
      { strangers: [VIEWER], authorOptedIn: [VIEWER], forwardOptedIn: [VIEWER] },
    );
    expect(result.has('f1')).toBe(false);
  });

  it('drops a non-stranger (existing relationship) even when opted in', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: true }],
      { strangers: ['maria'], authorOptedIn: ['maria'], forwardOptedIn: ['butt'] }, // butt not a stranger
    );
    expect(result.get('f1')).toEqual({ author: person('maria') });
  });

  it('drops a stranger who has not opted in', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'maria', viaUserId: 'butt', isPublic: true }],
      { strangers: ['maria', 'butt'], authorOptedIn: [], forwardOptedIn: ['butt'] }, // maria not opted in
    );
    expect(result.get('f1')).toEqual({ via: person('butt') });
  });

  it('collapses to author only when author and via are the same person (author leads)', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: 'butt', viaUserId: 'butt', isPublic: true }],
      { strangers: ['butt'], authorOptedIn: ['butt'], forwardOptedIn: ['butt'] },
    );
    expect(result.get('f1')).toEqual({ author: person('butt') });
    expect(result.get('f1')?.via).toBeUndefined();
  });

  it('omits items with neither signal surviving', () => {
    const result = compose(
      [{ feedItemId: 'f1', authorUserId: null, viaUserId: null, isPublic: true }],
      { strangers: [] },
    );
    expect(result.size).toBe(0);
  });
});
