import Link from 'next/link'

import { SendOnwardMenu } from '@/components/SendOnwardMenu'
import type { SharedAnswerActivity as SharedAnswer } from '@/lib/shared-answer-activity'

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
                  {friend.name}
                </Link>
              </span>
            ))}
            {item.friends.every((friend) => friend.fromYourFeed)
              ? ' nailed this too.'
              : item.friends.length === 1 ? ' both rocked this.' : ' all rocked this.'}
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
