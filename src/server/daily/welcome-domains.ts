// Pure "welcome slot" rule for newly added areas (random mode). Kept free of
// DB/network imports so it can be unit-tested in isolation; the random-mode
// domain selection in ./generate-questions.ts calls selectWelcomeDomains.
//
// Why (prod, 2026-10-01 — Chiann): a player who adds new areas expects to be
// asked about them soon. Random-mode selection gave a freshly added area no
// head start — it competed equally with ~30 older areas for the ~2 slots left
// after friend + house picks, and declared areas are even sampled at 50%
// (DECLARED_DOMAIN_WEIGHT). Areas added Sept 25–26 had still never appeared a
// week later. A welcome area leads the round palette, so the bank pass (which
// walks the palette in order) and generation both reach it first.

import { domainKey } from '@/lib/knowledge/domain-key';

// An area counts as "new" for this many days after it was added.
export const WELCOME_WINDOW_DAYS = 7;

// At most this many welcome areas lead any one round, so a player who adds five
// areas at once meets them over a few days instead of losing a whole Five.
export const WELCOME_MAX_PER_ROUND = 2;

export type WelcomeCandidate = { domain: string; declaredAt: Date };

// Returns the newly added areas to lead this round's palette, newest first.
//
// declared: the player's active declared interests.
// eligibleDomains: the round's eligible knowledge-base domains (not resting,
//   not excluded) — a welcome area must be one of these, and the returned
//   spelling is the knowledge-base one.
// recentCounts: per-domainKey generation counts over the last week (see
//   getRecentDomainCounts). A count above zero means the area has already been
//   served recently, so it has had its welcome.
export function selectWelcomeDomains(
  declared: readonly WelcomeCandidate[],
  eligibleDomains: readonly string[],
  recentCounts: ReadonlyMap<string, number>,
  now: Date,
  max: number = WELCOME_MAX_PER_ROUND,
): string[] {
  if (max <= 0) return [];
  const windowStart = now.getTime() - WELCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const eligibleByKey = new Map(eligibleDomains.map((domain) => [domainKey(domain), domain]));

  const picked: string[] = [];
  const seen = new Set<string>();
  const newestFirst = [...declared].sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime());
  for (const row of newestFirst) {
    if (picked.length >= max) break;
    if (row.declaredAt.getTime() < windowStart) continue;
    const key = domainKey(row.domain);
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = eligibleByKey.get(key);
    if (!domain) continue;
    if ((recentCounts.get(key) ?? 0) > 0) continue;
    picked.push(domain);
  }
  return picked;
}
