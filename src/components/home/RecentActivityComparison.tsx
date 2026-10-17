import Link from 'next/link'

export function RecentActivityComparison({ shared }: { shared: boolean }) {
  return (
    <nav aria-label="Recent activity version" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--brand-border)] bg-[var(--brand-card)] p-2">
      <span className="px-2 text-quiet text-muted-foreground">Recent activity</span>
      <div className="flex gap-1">
        <Link href="/?recentActivity=current" scroll={false} prefetch={false} aria-current={!shared ? 'page' : undefined} className={!shared ? 'btn-primary' : 'btn-ghost'}>Current</Link>
        <Link href="/?recentActivity=shared" scroll={false} prefetch={false} aria-current={shared ? 'page' : undefined} className={shared ? 'btn-primary' : 'btn-ghost'}>New version</Link>
      </div>
    </nav>
  )
}
