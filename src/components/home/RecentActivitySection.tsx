import Link from 'next/link'

import { NewsRow } from '@/components/home/NewsRow'
import type { ActivityItemView } from '@/server/db/queries/activity'

export function RecentActivitySection({
  items,
}: {
  items: ActivityItemView[]
}) {
  return (
    <section>
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
          <div className="divide-y rounded-lg border bg-card">
            {items.map((item) => (
              <NewsRow key={item.id} item={item} />
            ))}
          </div>
          <div className="mt-2 flex justify-end">
            <Link
              href="/activities"
              className="text-muted-foreground hover:text-foreground text-xs font-medium tracking-[0.06em] uppercase"
            >
              See all activity →
            </Link>
          </div>
        </>
      )}
    </section>
  )
}
