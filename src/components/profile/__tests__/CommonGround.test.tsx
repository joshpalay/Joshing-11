import { describe, expect, it } from 'vitest';

import type { CommonGroundDomain } from '@/server/db/queries/common-ground';

import { latentFootnote } from '../CommonGround';

// QA 2026-10-17 S1: a latent domain is shared but not proven by BOTH people, so
// "neither of you has been tested" was wrong whenever one side had proven it.

const domain = (
  name: string,
  viewerProven: boolean,
  friendProven: boolean,
): CommonGroundDomain => ({
  canonical_subcategory: name,
  broad_category: null,
  viewer: {
    mastery_points: viewerProven ? 80 : 0,
    current_tier: 'establishing',
    proven: viewerProven,
  },
  friend: {
    mastery_points: friendProven ? 80 : 0,
    current_tier: 'establishing',
    proven: friendProven,
  },
  kind: 'latent',
});

describe('latentFootnote', () => {
  it('says "neither" only when neither person has proven the domain', () => {
    expect(latentFootnote([domain('Tudor Dynasty', false, false)], 'Duo')).toBe(
      "You both claim Tudor Dynasty — neither's been tested yet.",
    );
    expect(latentFootnote([domain('A', false, false), domain('B', false, false)], 'Duo')).toBe(
      'Domains you both claim but neither of you has been tested on yet.',
    );
  });

  it('names who is still untested when one side has proven it', () => {
    expect(latentFootnote([domain('Tudor Dynasty', false, true)], 'Duo')).toBe(
      "You both claim Tudor Dynasty — you haven't been tested on it yet.",
    );
    expect(latentFootnote([domain('Tudor Dynasty', true, false)], 'Duo')).toBe(
      "You both claim Tudor Dynasty — Duo hasn't been tested on it yet.",
    );
    expect(latentFootnote([domain('A', false, true), domain('B', false, true)], 'Duo')).toBe(
      "Domains you both claim that Duo has proven and you haven't been tested on yet.",
    );
  });

  it('falls back to "at least one of you" for a mixed list', () => {
    expect(latentFootnote([domain('A', false, false), domain('B', false, true)], 'Duo')).toBe(
      "Domains you both claim that at least one of you hasn't been tested on yet.",
    );
  });
});
