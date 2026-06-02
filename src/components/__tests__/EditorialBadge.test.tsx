import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorialBadge } from '@/components/EditorialBadge';
import { HOUSE_AUTHOR } from '@/lib/questions-types';

describe('EditorialBadge', () => {
  it('renders the house label from the single HOUSE_AUTHOR constant', () => {
    const rendered = renderToStaticMarkup(<EditorialBadge />);
    expect(rendered).toContain(HOUSE_AUTHOR.label);
    expect(rendered).toContain('editorial-badge');
  });

  it('merges caller style overrides', () => {
    const rendered = renderToStaticMarkup(<EditorialBadge style={{ marginLeft: '6px' }} />);
    expect(rendered).toContain('margin-left:6px');
  });
});
