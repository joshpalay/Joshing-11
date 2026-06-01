import type { DomainMastery } from '@/server/db/queries/knowledge'

/**
 * A single domain surfaced in the "Recently exploring" presence section on a
 * friend's profile. Activity-based (recent `masteryEvents`), distinct from the
 * historical knowledge map and from declared interests.
 */
export type RecentlyExploringDomain = {
  displayName: string
  domain: string
  lastActivityAt: string
}

const DEFAULT_WINDOW_DAYS = 30
const DEFAULT_LIMIT = 5

type SelectOptions = {
  now?: number
  windowDays?: number
  limit?: number
}

/**
 * Derive the "Recently exploring" list from the domains the profile page
 * already loads via `getKnowledgePageData`. Pure transform — no DB access.
 *
 * Each `DomainMastery.lastActivityAt` is the max `masteryEvents.createdAt` for
 * that domain (the same recency signal `getFriendsHub` uses for `lastActiveAt`,
 * surfaced as *which* domains, recently). We keep only domains the viewer is
 * allowed to see (`!isHidden`) that have activity inside the recency window,
 * sort most-recent-first, and cap the list.
 */
export function selectRecentlyExploring(
  allDomains: DomainMastery[],
  opts: SelectOptions = {},
): RecentlyExploringDomain[] {
  const now = opts.now ?? Date.now()
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS
  const limit = opts.limit ?? DEFAULT_LIMIT
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000

  return allDomains
    .filter((domain): domain is DomainMastery & { lastActivityAt: string } => {
      if (domain.isHidden) return false
      if (!domain.lastActivityAt) return false
      const activityAt = new Date(domain.lastActivityAt).getTime()
      if (Number.isNaN(activityAt)) return false
      return activityAt >= cutoff
    })
    .sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime(),
    )
    .slice(0, limit)
    .map((domain) => ({
      displayName: domain.displayName,
      domain: domain.domain,
      lastActivityAt: domain.lastActivityAt,
    }))
}
