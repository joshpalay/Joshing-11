import Link from 'next/link'

import { SendOnwardMenu } from '@/components/SendOnwardMenu'
import type { SharedAnswerActivity as SharedAnswer } from '@/lib/shared-answer-activity'

// Key the cue to identity, never row position, topic, or the friend's display name.
const FRIEND_COLORS = [
  'var(--exploring-accent-red)',
  'var(--exploring-accent-blue)',
  'var(--tri-darkteal)',
  'var(--brand-ink-700)',
] as const

function friendColor(userId: string) {
  let hash = 2166136261
  for (let index = 0; index < userId.length; index++) {
    hash ^= userId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return FRIEND_COLORS[(hash >>> 0) % FRIEND_COLORS.length]
}

export function SharedAnswerActivity({ items }: { items: SharedAnswer[] }) {
  if (!items.length) return (
    <p className="py-4 text-sm text-muted-foreground">
      No new shared answers this week. When a friend gets one you knew, it will appear here.
    </p>
  )
  return (
    <div className="divide-y divide-[var(--brand-border)]" data-recent-activity="shared">
      {items.map((item) => (
        <article key={item.questionId} className="py-5 text-[var(--brand-ink)]">
          <h3 className="mb-3 text-base font-semibold">
            {item.friends.every((friend) => friend.fromYourFeed) ? '' : 'You and '}
            {item.friends.map((friend, index) => (
              <span key={friend.userId}>
                {index ? index === item.friends.length - 1 ? ' and ' : ', ' : ''}
                <Link href={`/users/${encodeURIComponent(friend.userId)}`} className="text-[var(--brand-link)] underline underline-offset-4 hover:opacity-70">
                  <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12" className="mr-1.5 inline-block h-3 w-3" fill={friendColor(friend.userId)}>
                    <path d="M1 1 L11 6 L1 11 Z" />
                  </svg>
                  {friend.name}
                </Link>
              </span>
            ))}
            {' rocked '}{item.topic?.trim() || item.domain?.trim() || 'this one'}
            {item.friends.every((friend) => friend.fromYourFeed) ? ' too.' : '.'}
          </h3>
          <p className="font-serif text-xl leading-relaxed font-medium">{item.questionText}</p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 pt-2 text-base font-medium">
              <span className="mr-2 text-xs font-normal text-muted-foreground">Answer</span>
              {item.correctAnswer}
            </p>
            <SendOnwardMenu
              question={{ id: item.questionId, text: item.questionText, domain: item.domain ?? '' }}
              answer={item.correctAnswer}
              buttonClassName="text-[var(--brand-ink)] hover:opacity-70"
            />
          </div>
          {item.friends.every((friend) => friend.fromYourFeed) ? (
            <p className="mt-4 text-xs text-muted-foreground">From your feed.</p>
          ) : null}
        </article>
      ))}
    </div>
  )
}
