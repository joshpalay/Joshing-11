import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  commonGroundPromoToStreamItem,
  type StreamEmbed,
  type StreamItem,
} from '@/lib/activity-stream';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The common-ground embed draws the overlapping-circle SVG motif; mock it so the
// test stays focused on the row chrome (panel + timestamp), not the geometry.
vi.mock('@/components/profile/common-ground-circles', () => ({
  circleDatasetMax: () => 100,
  DomainCircleSvg: () => <svg data-mock="domain-circle" />,
}));

// Heavy children of ActivityStreamItem a promo row never renders — mocked so the
// module imports cleanly in the node test environment.
vi.mock('@/components/activity/InlineAnswerFlow', () => ({
  InlineAnswerFlow: () => <div data-mock="inline-answer" />,
}));
vi.mock('@/components/SendQuestionDrawer', () => ({
  SendQuestionDrawer: () => <div data-mock="send-drawer" />,
}));
vi.mock('@/app/activities/FriendRequestActions', () => ({
  FriendRequestActions: () => <div data-mock="friend-request" />,
}));
vi.mock('@/app/activities/ReactionGotItButton', () => ({
  ReactionGotItButton: () => <div data-mock="reaction" />,
}));

// Imported AFTER the mocks are registered.
import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem';

const COMMON_GROUND_EMBED: Extract<StreamEmbed, { kind: 'common_ground' }> = {
  kind: 'common_ground',
  friendId: 'friend-1',
  friendFirstName: 'Robyn',
  friendHref: '/users/friend-1',
  domains: [
    {
      label: 'Film & TV',
      viewer: { points: 40, tier: 'familiar' },
      friend: { points: 60, tier: 'solid' },
    },
  ],
};

// A plain (non-promo) activity one-liner: no embed, so it keeps the standard row
// chrome (cream-on-cream, timestamp shown).
const PLAIN_ITEM: StreamItem = {
  id: 'plain-1',
  sortAt: new Date('2026-05-20T12:00:00Z'),
  tier: 0,
  homeEligible: false,
  line: [{ t: 'text', v: 'Robyn answered a question' }],
  secondLine: null,
  anchorId: null,
  action: null,
  expand: null,
  icon: null,
  embed: null,
};

describe('ActivityStreamItem — discovery promo rows (embed-bearing)', () => {
  it('sets the common-ground promo apart on a warm panel and drops the timestamp', () => {
    const promo = commonGroundPromoToStreamItem(
      COMMON_GROUND_EMBED,
      new Date('2026-05-20T12:00:00Z'),
      'cg-promo:1',
    );
    const html = renderToStaticMarkup(
      <ActivityStreamItem item={promo} timestamp="just now" />,
    );
    // The one-liner still renders…
    expect(html).toContain('share ground worth testing');
    // …on the subtly warmer parchment panel (PROMO_BG)…
    expect(html).toContain('f7f1e6');
    // …with the borrowed/meaningless row timestamp suppressed.
    expect(html).not.toContain('just now');
  });

  it('leaves ordinary activity rows unchanged — no panel, timestamp shown', () => {
    const html = renderToStaticMarkup(
      <ActivityStreamItem item={PLAIN_ITEM} timestamp="just now" />,
    );
    expect(html).toContain('Robyn answered a question');
    expect(html).toContain('just now');
    expect(html).not.toContain('f7f1e6');
  });
});
