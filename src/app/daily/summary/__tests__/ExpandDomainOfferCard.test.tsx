import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ExpandDomainOfferCard } from '../ExpandDomainOfferCard';
import type { ExpansionOffer } from '@/server/db/queries/daily-summary';

const offer: ExpansionOffer = {
  sourceDomain: 'Pride',
  sourceDisplayName: 'Pride',
  candidates: [
    { label: 'Moral Philosophy', broadCategory: 'Philosophy', kind: 'broader' },
    { label: 'The Seven Deadly Sins', broadCategory: 'Philosophy', kind: 'broader' },
    { label: 'Greed', broadCategory: 'Philosophy', kind: 'wider' },
  ],
};

describe('ExpandDomainOfferCard — wider/broader grouping', () => {
  it('renders a Go broader and a Branch wider group with their candidates', () => {
    const html = renderToStaticMarkup(<ExpandDomainOfferCard offer={offer} preview />);
    expect(html).toContain('Go broader');
    expect(html).toContain('Branch wider');
    expect(html).toContain('Moral Philosophy');
    expect(html).toContain('The Seven Deadly Sins');
    expect(html).toContain('Greed');
    // No confirmation pill on the initial (chooser) render — no false "you expanded".
    expect(html).not.toContain('Branching out');
  });

  it('omits a group with no candidates', () => {
    const broaderOnly: ExpansionOffer = {
      ...offer,
      candidates: offer.candidates.filter((c) => c.kind === 'broader'),
    };
    const html = renderToStaticMarkup(<ExpandDomainOfferCard offer={broaderOnly} preview />);
    expect(html).toContain('Go broader');
    expect(html).not.toContain('Branch wider');
  });
});
