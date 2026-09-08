import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  InviteLinksSection,
  type InviteLinkRowData,
} from '@/components/friends/InviteLinksSection';

function link(id: string, categories: unknown, joinedCount = 0): InviteLinkRowData {
  return {
    id,
    slot: 0,
    categories: categories as InviteLinkRowData['categories'],
    url: `https://example.com/u/josh/${id}`,
    createdAt: '2026-09-07T00:00:00.000Z',
    joinedCount,
  };
}

function render(links: InviteLinkRowData[], creatorName: string | null = 'Josh') {
  return renderToStaticMarkup(
    <InviteLinksSection
      creatorName={creatorName}
      initialTopics={[{ label: 'Sondheim', broadCategory: 'Theater' }]}
      initialLinks={links}
    />,
  );
}

describe('InviteLinksSection', () => {
  it('renders the dynamic creator title and required supporting copy', () => {
    const html = render([link('one', [{ label: 'Jazz' }])]);

    expect(html).toContain('Play Josh’s greatest hits');
    expect(html).toContain('We’ll recommend these categories to anyone who uses this link.');
  });

  it('uses the creator fallback without exposing a phone-like value', () => {
    const html = render([link('one', [{ label: 'Jazz' }])], '+1 (734) 555-0123');

    expect(html).toContain('Play your greatest hits');
    expect(html).not.toContain('734');
  });

  it('filters blank, sentinel, malformed, and duplicate categories', () => {
    const html = render([
      link('one', [
        null,
        '',
        'No category',
        { label: 'Jazz' },
        { label: ' jazz ' },
        { nope: true },
      ]),
    ]);

    expect(html).toContain('Jazz');
    expect(html).not.toContain('No category');
    expect(html.match(/>Jazz</g) ?? []).toHaveLength(1);
  });

  it('keeps each link’s categories separate', () => {
    const html = render([link('one', [{ label: 'Jazz' }]), link('two', [{ label: 'Poetry' }])]);

    expect(html).toContain('Jazz');
    expect(html).toContain('Poetry');
    expect(html.match(/Play Josh’s greatest hits/g) ?? []).toHaveLength(2);
  });

  it('pluralizes joined counts correctly', () => {
    const html = render([
      link('zero', [{ label: 'Jazz' }], 0),
      link('one', [{ label: 'Poetry' }], 1),
      link('two', [{ label: 'Chess' }], 2),
    ]);

    expect(html).toContain('0 friends joined');
    expect(html).toContain('1 friend joined');
    expect(html).toContain('2 friends joined');
  });

  it('uses the zero-link create copy', () => {
    expect(render([])).toContain('Create an invite link');
  });

  it.each([1, 2])('uses the alternate create copy with %i active link(s)', (count) => {
    const links = Array.from({ length: count }, (_, index) =>
      link(`${index}`, [{ label: `Topic ${index}` }]),
    );
    expect(render(links)).toContain('Create a link with different categories');
  });

  it('does not offer a fourth link when three are active', () => {
    const html = render([
      link('one', [{ label: 'Jazz' }]),
      link('two', [{ label: 'Poetry' }]),
      link('three', [{ label: 'Chess' }]),
    ]);

    expect(html).not.toContain('Create a link with different categories');
    expect(html).toContain('You can keep up to three active invitation links.');
  });
});
