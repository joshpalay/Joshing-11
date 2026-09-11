import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MutualFriendSuggestionsTeaser } from '@/components/home/MutualFriendSuggestionsTeaser';

describe('MutualFriendSuggestionsTeaser', () => {
  it('renders nothing at count 0 -- no empty-state card', () => {
    const html = renderToStaticMarkup(<MutualFriendSuggestionsTeaser count={0} />);
    expect(html).toBe('');
  });

  it('uses the singular for exactly 1', () => {
    const html = renderToStaticMarkup(<MutualFriendSuggestionsTeaser count={1} />);
    expect(html).toContain('1 person you may know');
  });

  it('uses the plural for 2+', () => {
    const html = renderToStaticMarkup(<MutualFriendSuggestionsTeaser count={4} />);
    expect(html).toContain('4 people you may know');
  });

  it('links to the Friends page, not an inline list', () => {
    const html = renderToStaticMarkup(<MutualFriendSuggestionsTeaser count={2} />);
    expect(html).toContain('href="/friends"');
  });

  it('carries no color/badge/icon emphasis -- no bg-* utility beyond the card surface, no svg icon', () => {
    const html = renderToStaticMarkup(<MutualFriendSuggestionsTeaser count={2} />);
    // Only the neutral card-surface classes should appear -- no accent/brand
    // color utility, no badge count pill, no <svg>.
    expect(html).not.toContain('<svg');
    expect(html).not.toMatch(/bg-\[var\(--brand-orange/);
    expect(html).not.toMatch(/bg-\[var\(--accent/);
  });
});
