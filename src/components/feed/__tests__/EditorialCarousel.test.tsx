import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { EditorialCarousel } from '@/components/feed/EditorialCarousel';
import { CommonGroundFeature } from '@/components/feed/EditorialPromos';
import type { StreamEmbed } from '@/lib/activity-stream';

describe('EditorialCarousel', () => {
  it('renders every provided slide', () => {
    const html = renderToStaticMarkup(
      <EditorialCarousel
        ariaLabel="Shared interests"
        slides={[
          <span key="a">First slide</span>,
          <span key="b">Second slide</span>,
          <span key="c">Invite someone</span>,
        ]}
      />,
    );
    expect(html).toContain('First slide');
    expect(html).toContain('Second slide');
    expect(html).toContain('Invite someone');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Shared interests"');
  });

  it('renders one pagination dot per slide, first active', () => {
    const html = renderToStaticMarkup(
      <EditorialCarousel
        slides={[<span key="a">A</span>, <span key="b">B</span>, <span key="c">C</span>]}
      />,
    );
    const dots = html.match(/aria-label="Go to item \d+ of 3"/g) ?? [];
    expect(dots).toHaveLength(3);
    // Initial state: the first dot is current.
    expect(html).toContain('aria-label="Go to item 1 of 3" aria-current="true"');
  });

  it('omits dots when there is a single slide', () => {
    const html = renderToStaticMarkup(<EditorialCarousel slides={[<span key="a">Only</span>]} />);
    expect(html).not.toContain('Go to item');
  });
});

describe('CommonGroundFeature carousel', () => {
  const embed: Extract<StreamEmbed, { kind: 'common_ground' }> = {
    kind: 'common_ground',
    friendId: 'sadie',
    friendFirstName: 'Sadie',
    friendHref: '/users/sadie',
    domains: [
      {
        label: 'Simpsons Catchphrases',
        viewer: { points: 40, tier: 'solid' },
        friend: { points: 30, tier: 'familiar' },
      },
      {
        label: 'Bikini Bottom',
        viewer: { points: 20, tier: 'familiar' },
        friend: { points: 20, tier: 'familiar' },
      },
    ],
  };

  it('renders a slide per domain plus a final "Invite someone" slide linking to /friends/find', () => {
    const html = renderToStaticMarkup(<CommonGroundFeature embed={embed} />);
    expect(html).toContain('Simpsons Catchphrases');
    expect(html).toContain('Bikini Bottom');
    expect(html).toContain('Invite someone');
    expect(html).toContain('href="/friends/find"');
    // Two domains + invite = three pagination dots.
    const dots = html.match(/aria-label="Go to item \d+ of 3"/g) ?? [];
    expect(dots).toHaveLength(3);
  });
});
