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

function render(links: InviteLinkRowData[]) {
  return renderToStaticMarkup(
    <InviteLinksSection
      initialTopics={[{ label: 'Sondheim', broadCategory: 'Theater' }]}
      initialLinks={links}
    />,
  );
}

describe('InviteLinksSection', () => {
  it('titles each card from its own categories and shows the actual link', () => {
    const html = render([link('one', [{ label: 'Jazz' }])]);

    expect(html).toContain('>Jazz<');
    expect(html).toContain('We’ll recommend these categories to anyone who uses this link.');
    expect(html).toContain('https://example.com/u/josh/one');
  });

  it('joins multiple categories into a single generated title', () => {
    const html = render([link('one', [{ label: 'Music' }, { label: 'Star Wars' }, { label: 'Joyce' }])]);

    expect(html).toContain('Music, Star Wars &amp; Joyce');
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
    expect(html.match(/Jazz/g) ?? []).toHaveLength(2);
  });

  it('keeps each link’s title, categories, and url separate', () => {
    const html = render([link('one', [{ label: 'Jazz' }]), link('two', [{ label: 'Poetry' }])]);

    expect(html).toContain('>Jazz<');
    expect(html).toContain('>Poetry<');
    expect(html).toContain('https://example.com/u/josh/one');
    expect(html).toContain('https://example.com/u/josh/two');
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
