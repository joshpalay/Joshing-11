/**
 * Homepage "Your world is expanding" promo.
 *
 * Produces a single, optional `StreamItem` (the inline recently-expanding embed)
 * that the home feed splices a few rows down — a condensed mirror of the
 * /knowledge "Recently Expanding" module (the viewer's fastest-growing
 * territories), capped at three rows with a link through to /knowledge. This is a
 * HOME-ONLY surface — assembled here, NOT inside buildActivityStream, so
 * /activities and Lately stay free of the promo.
 *
 * Gating is stateless/probabilistic (~1 in 5 visits) so it needs no per-user
 * counter cookie or DB row — the same approach as the common-ground promo.
 */

import {
  recentlyExpandingPromoToStreamItem,
  type StreamEmbed,
  type StreamItem,
} from '@/lib/activity-stream';
import { getExpandingDomains, type ExpandingDomain } from '@/server/db/queries/knowledge';

const MAX_PROMO_DOMAINS = 3;

// The letter shown in the row's colored badge: the first meaningful character of
// the domain name (mirrors getDomainInitial in the RecentlyExpanding module).
function initialFor(domain: string): string {
  const firstMeaningfulWord = domain
    .replace(/&/g, ' ')
    .split(/\s+/)
    .find((word) => /^[a-z0-9]/i.test(word));
  return (firstMeaningfulWord?.[0] ?? domain[0] ?? '?').toUpperCase();
}

// The row's supporting line. Mirrors getRowActivity in the RecentlyExpanding
// module: prefer the server's real supportingText, but swap the "territory moved
// recently" placeholder for a qualitative label so the promo never shows it.
function captionFor(domain: ExpandingDomain): string {
  if (domain.supportingText && !/territory moved recently/i.test(domain.supportingText)) {
    return domain.supportingText;
  }
  switch (domain.reason) {
    case 'new-discovery':
      return 'New territory';
    case 'social-overlap':
      return 'People answered yours';
    case 'saved-questions':
      return 'New questions explored';
    case 'mastery-shift':
      return 'Leveling up';
    case 'active-play':
    default:
      return 'Revisited and growing';
  }
}

export async function getRecentlyExpandingPromo(
  userId: string,
  now: Date = new Date(),
): Promise<StreamItem | null> {
  // First-class module: render deterministically whenever the viewer has
  // expanding territories to show (the data-existence guard below is the gate).
  const expanding = await getExpandingDomains(userId);
  if (expanding.length === 0) return null;

  const domains = expanding.slice(0, MAX_PROMO_DOMAINS).map((domain) => ({
    label: domain.domain,
    caption: captionFor(domain),
    initial: initialFor(domain.domain),
  }));

  // Stable id within a UTC day so the row's React key doesn't churn across
  // re-renders, but advances day to day. Also seeds the headline rotation (Pool
  // 4) so the headline cycles day to day instead of always showing line 1.
  const daySeed = Math.floor(now.getTime() / 86_400_000);
  const embed: Extract<StreamEmbed, { kind: 'recently_expanding' }> = {
    kind: 'recently_expanding',
    href: '/knowledge',
    domains,
    headlineIndex: daySeed,
  };

  return recentlyExpandingPromoToStreamItem(embed, now, `recently-expanding-promo-${daySeed}`);
}
