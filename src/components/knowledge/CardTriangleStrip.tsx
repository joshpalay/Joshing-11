import type { CSSProperties } from 'react';

/**
 * A slim full-bleed band of the JOSHING triangle motif, meant to sit directly
 * under the "Joshing" wordmark at the top of a card to bring some brand
 * character to the surface. Reuses the same artwork as the page-top band
 * (public/images/Variant4-TOP.png) so the palette stays consistent.
 *
 * The horizontal margin bleeds the strip out to the card's inner border edge;
 * both cards that use it (KnowledgeCard, RecentlyExpanding) carry a 0.95rem
 * horizontal padding, so the same negative margin lines the strip up flush on
 * each. Decorative only — hidden from assistive tech.
 */
export function CardTriangleStrip() {
  return <div aria-hidden="true" style={stripStyle} />;
}

const stripStyle: CSSProperties = {
  height: 10,
  marginInline: '-0.95rem',
  backgroundImage: 'url(/images/Variant4-TOP.png)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
};
