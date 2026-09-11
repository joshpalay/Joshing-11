import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VISIBLE,
  MutualFriendSuggestionsSection,
  deriveDisplayedSuggestions,
  deriveVisibleSuggestions,
  mutualFriendCountLabel,
  type MutualFriendSuggestionRow,
} from '@/components/friends/MutualFriendSuggestionsSection';

function suggestion(overrides: Partial<MutualFriendSuggestionRow> = {}): MutualFriendSuggestionRow {
  return {
    id: 's1',
    displayName: 'Priya',
    mutualFriendCount: 3,
    interestsPreview: null,
    ...overrides,
  };
}

describe('mutualFriendCountLabel', () => {
  it('uses the singular for exactly 1', () => {
    expect(mutualFriendCountLabel(1)).toBe('1 mutual friend');
  });
  it('uses the plural for 0 and for 2+', () => {
    expect(mutualFriendCountLabel(0)).toBe('0 mutual friends');
    expect(mutualFriendCountLabel(2)).toBe('2 mutual friends');
  });
});

describe('deriveVisibleSuggestions (pure)', () => {
  it('filters out ids present in sentIds', () => {
    const all = [suggestion({ id: 'a' }), suggestion({ id: 'b' }), suggestion({ id: 'c' })];
    const result = deriveVisibleSuggestions(all, new Set(['b']));
    expect(result.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('returns everything unchanged when sentIds is empty', () => {
    const all = [suggestion({ id: 'a' }), suggestion({ id: 'b' })];
    expect(deriveVisibleSuggestions(all, new Set())).toEqual(all);
  });
});

describe('deriveDisplayedSuggestions (pure)', () => {
  const six = Array.from({ length: 6 }, (_, i) => suggestion({ id: `s${i}` }));

  it('caps at the default visible count and reports hasMore when collapsed', () => {
    const { displayed, hasMore } = deriveDisplayedSuggestions(six, false);
    expect(displayed).toHaveLength(DEFAULT_VISIBLE);
    expect(hasMore).toBe(true);
  });

  it('shows everything and hasMore is false once expanded', () => {
    const { displayed, hasMore } = deriveDisplayedSuggestions(six, true);
    expect(displayed).toHaveLength(6);
    expect(hasMore).toBe(false);
  });

  it('hasMore is false when the list already fits within the default cap', () => {
    const three = six.slice(0, 3);
    const { displayed, hasMore } = deriveDisplayedSuggestions(three, false);
    expect(displayed).toHaveLength(3);
    expect(hasMore).toBe(false);
  });
});

describe('MutualFriendSuggestionsSection rendering', () => {
  it('renders nothing when there are no suggestions at all', () => {
    const html = renderToStaticMarkup(
      <MutualFriendSuggestionsSection initialSuggestions={[]} />,
    );
    expect(html).toBe('');
  });

  it('renders the eyebrow label, name, mutual-friend count, and a Request button', () => {
    const html = renderToStaticMarkup(
      <MutualFriendSuggestionsSection
        initialSuggestions={[suggestion({ displayName: 'Priya', mutualFriendCount: 3 })]}
      />,
    );
    expect(html).toContain('People you may know');
    expect(html).toContain('Priya');
    expect(html).toContain('3 mutual friends');
    expect(html).toContain('+ Request');
  });

  it('omits the "Into ..." interests line entirely when there is no interests preview', () => {
    const html = renderToStaticMarkup(
      <MutualFriendSuggestionsSection
        initialSuggestions={[suggestion({ interestsPreview: null })]}
      />,
    );
    expect(html).not.toContain('Into ');
  });

  it('renders the "Into X, Y, Z" line when an interests preview is present', () => {
    const html = renderToStaticMarkup(
      <MutualFriendSuggestionsSection
        initialSuggestions={[suggestion({ interestsPreview: 'Astronomy, Baking, Chess' })]}
      />,
    );
    expect(html).toContain('Into Astronomy, Baking, Chess');
  });

  it('shows no avatar element -- name and text only', () => {
    const html = renderToStaticMarkup(
      <MutualFriendSuggestionsSection initialSuggestions={[suggestion()]} />,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('aria-hidden');
  });

  it('shows "See more" only when there are more than the default-visible count', () => {
    const five = Array.from({ length: 5 }, (_, i) => suggestion({ id: `s${i}` }));
    const six = Array.from({ length: 6 }, (_, i) => suggestion({ id: `s${i}` }));

    expect(renderToStaticMarkup(<MutualFriendSuggestionsSection initialSuggestions={five} />)).not.toContain(
      'See more',
    );
    expect(renderToStaticMarkup(<MutualFriendSuggestionsSection initialSuggestions={six} />)).toContain(
      'See more',
    );
  });

  it('renders exactly DEFAULT_VISIBLE rows by default even with more candidates', () => {
    const ten = Array.from({ length: 10 }, (_, i) => suggestion({ id: `s${i}`, displayName: `Person${i}` }));
    const html = renderToStaticMarkup(<MutualFriendSuggestionsSection initialSuggestions={ten} />);
    for (let i = 0; i < DEFAULT_VISIBLE; i++) expect(html).toContain(`Person${i}`);
    for (let i = DEFAULT_VISIBLE; i < 10; i++) expect(html).not.toContain(`Person${i}`);
  });

  it('the "See more" affordance is a plain underlined text link, not a bordered button (no border/bg classes)', () => {
    const six = Array.from({ length: 6 }, (_, i) => suggestion({ id: `s${i}` }));
    const html = renderToStaticMarkup(<MutualFriendSuggestionsSection initialSuggestions={six} />);
    const match = html.match(/<button[^>]*>See more<\/button>/);
    expect(match).not.toBeNull();
    const seeMoreTag = match![0];
    expect(seeMoreTag).toContain('underline');
    expect(seeMoreTag).not.toMatch(/class="[^"]*\bborder\b/);
  });
});
