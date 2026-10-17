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

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function friendColor(userId: string) {
  return FRIEND_COLORS[stableHash(userId) % FRIEND_COLORS.length]
}

const PRAISE = ['nailed', 'aced', 'knew their stuff on', 'rocked'] as const

function activityHeadlines(items: SharedAnswer[]) {
  // Stable across renders, with no identical praise on neighboring entries.
  const headlines: string[] = []
  let previousPraise = -1
  for (const item of items) {
    let praise = stableHash(item.questionId) % PRAISE.length
    if (praise === previousPraise) praise = (praise + 1) % PRAISE.length
    previousPraise = praise
    headlines.push(`${PRAISE[praise]} ${item.topic?.trim() || item.domain?.trim() || 'this one'}.`)
  }
  return headlines
}

export function SharedAnswerActivity({ items }: { items: SharedAnswer[] }) {
  if (!items.length) return (
    <p className="py-4 text-sm text-muted-foreground">
      No new shared answers this week. When a friend gets one you knew, it will appear here.
    </p>
  )
  const headlines = activityHeadlines(items)
  return (
    <div className="divide-y divide-[var(--brand-border)]" data-recent-activity="shared">
      {items.map((item, itemIndex) => (
        <article key={item.questionId} className="py-5 text-[var(--brand-ink)]">
          <h3 className="mb-3 text-base font-semibold">
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
            {' '}{headlines[itemIndex]}
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
