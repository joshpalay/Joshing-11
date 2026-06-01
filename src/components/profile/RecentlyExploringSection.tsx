import { formatRelativeTime } from '@/components/feed/visual'
import type { RecentlyExploringDomain } from '@/server/profile/recently-exploring'

type RecentlyExploringSectionProps = {
  domains: RecentlyExploringDomain[]
  friendFirstName: string
}

/**
 * "Recently exploring" presence section on a friend's profile. Shows which
 * domains the friend has been answering in lately, derived from `masteryEvents`
 * recency. Distinct from the historical knowledge map (sorted by points) and
 * from declared shared interests. Renders nothing when there is no recent
 * activity (the page also guards on a non-empty list).
 */
export function RecentlyExploringSection({
  domains,
  friendFirstName,
}: RecentlyExploringSectionProps) {
  if (domains.length === 0) return null

  return (
    <section className="mt-5" aria-label="Recently exploring">
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Recently exploring
      </p>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        What {friendFirstName}’s been answering lately.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {domains.map((domain) => (
          <li
            key={domain.domain}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="text-foreground text-sm font-medium">
              {domain.displayName}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatRelativeTime(domain.lastActivityAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
