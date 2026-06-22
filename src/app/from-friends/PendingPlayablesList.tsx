'use client'

import { useRouter } from 'next/navigation'

import { FromFriendsStreak } from '@/components/feed/FromFriendsStreak'
import type { StreamItem } from '@/lib/activity-stream'

// The full pending-playables queue, answerable in place. Each streak renders
// through the exact home-zone treatment (B-FROMFRIENDS-STREAK-HEADER-01: a
// header + per-question answer/dismiss cards in the DirectSentCard register),
// so the From Friends zone reads identically on Home and on this overflow page.
// Resolving a question refreshes the router cache so Home recomputes its
// served top-4 and overflow count on return (D-HOME-PACING-01 §7); the cards
// themselves stay in place as their in-session spent state.
export function PendingPlayablesList({ items }: { items: StreamItem[] }) {
  const router = useRouter()
  return (
    <section className="space-y-3">
      {items.map((item) => (
        <FromFriendsStreak
          key={item.id}
          item={item}
          elevated
          onQuestionResolved={() => router.refresh()}
        />
      ))}
    </section>
  )
}
