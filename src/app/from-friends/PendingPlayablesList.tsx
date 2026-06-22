'use client';

import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem';
import { formatRelativeTime } from '@/components/feed/visual';
import type { StreamItem } from '@/lib/activity-stream';

// The full From Friends queue, each streak shown as the compact triangle bundle
// summary — the exact treatment Home uses — that EXPANDS in place to its
// questions in the new card styling (category eyebrow + per-card answer/dismiss).
// Home and this overflow list read identically.
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
        />
      ))}
    </section>
  );
}
