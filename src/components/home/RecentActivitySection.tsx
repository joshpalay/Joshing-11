import Link from 'next/link'

import { NewsRow } from '@/components/home/NewsRow'
import type { ActivityItemView } from '@/server/db/queries/activity'

export function RecentActivitySection({
  items,
}: {
  items: ActivityItemView[]
}) {
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
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <NewsRow key={item.id} item={item} />
            ))}
          </div>
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
