'use client'

import { useRouter } from 'next/navigation'

import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem'
import { formatRelativeTime } from '@/components/feed/visual'
import type { StreamItem } from '@/lib/activity-stream'

// The full pending-playables queue, answerable in place. Each bundle renders
// through the exact home-zone treatment (elevated cream card, timestamp-free,
// tap-to-open with the existing InlineAnswerFlow) — no new answer interaction.
// Resolving a question refreshes the router cache so Home recomputes its
// served top-4 and overflow count on return (D-HOME-PACING-01 §7); the card
// itself stays open here as its in-session answered state.
export function PendingPlayablesList({ items }: { items: StreamItem[] }) {
  const router = useRouter()
  return (
    <section className="space-y-3">
      {items.map((item) => (
        <ActivityStreamItem
          key={item.id}
          item={item}
          timestamp={formatRelativeTime(item.sortAt)}
          showTimestamp={false}
          elevated
          onQuestionResolved={() => router.refresh()}
        />
      ))}
    </section>
  )
}
