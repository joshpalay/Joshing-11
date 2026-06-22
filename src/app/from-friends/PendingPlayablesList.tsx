'use client'

import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem'
import { formatRelativeTime } from '@/components/feed/visual'
import type { StreamItem } from '@/lib/activity-stream'

// The full From Friends queue, each streak shown as the compact triangle bundle
// summary (B-FROMFRIENDS-STREAK-PAGE-01) — the exact treatment Home uses — that
// links into the streak's own page where its questions are answerable. Keeping
// the overflow list and Home identical means the surface reads the same in both
// places; the per-streak page is the one place you actually play.
export function PendingPlayablesList({ items }: { items: StreamItem[] }) {
  return (
    <section className="space-y-3">
      {items.map((item) => (
        <ActivityStreamItem
          key={item.id}
          item={item}
          timestamp={formatRelativeTime(item.sortAt)}
          showTimestamp={false}
          elevated
          playHref={
            item.expand?.kind === 'milestone'
              ? `/from-friends/${encodeURIComponent(item.id)}`
              : undefined
          }
        />
      ))}
    </section>
  )
}
