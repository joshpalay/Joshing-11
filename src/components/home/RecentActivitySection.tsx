import Link from 'next/link'

import { ActivityStream } from '@/components/activity/ActivityStream'
import type { StreamItem } from '@/lib/activity-stream'

// Homepage "What's Happening" — the curated HEAD of the one unified activity
// stream (D-4 CORRECTION 2). Same items, same source, same one-liner rendering
// as Lately / /activities; this surface just shows the top few and links to the
// full list. See buildActivityStream + ActivityStream.
export function RecentActivitySection({ items }: { items: StreamItem[] }) {
  return (
    <section className="px-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium tracking-[0.1em] uppercase">
        What&rsquo;s happening
      </p>
      {items.length === 0 ? (
        <p
          className="text-muted-foreground text-[12px] italic"
          style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
        >
          Nothing yet — your friends will show up here.
        </p>
      ) : (
        <>
          <ActivityStream items={items} variant="home" />
          <div className="mt-4 flex justify-end">
            <Link
              href="/activities"
              className="text-xs font-medium tracking-[0.08em] text-[var(--brand-link)] uppercase hover:opacity-70"
            >
              See all activity →
            </Link>
          </div>
        </>
      )}
    </section>
  )
}
