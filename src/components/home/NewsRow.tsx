import Link from 'next/link'

import type { ActivityItemView } from '@/server/db/queries/activity'

type NewsRowCopy = {
  headline: React.ReactNode
  secondLine: string | null
  accentColor: string
  href: string | null
}

function actorName(item: ActivityItemView): string {
  return item.actor?.displayName ?? 'Someone'
}

function relativeTime(value: Date): string {
  const diffMs = Date.now() - value.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w`
  const months = Math.floor(days / 30)
  return `${months}mo`
}

// Compact second-line copy for Home — full subcopy lives on /activities.
function buildCopy(item: ActivityItemView): NewsRowCopy {
  const actor = actorName(item)

  switch (item.type) {
    case 'friend_answered_your_question': {
      const faq = item.reference.friendAnsweredQuestion
      const correct = faq?.result === 'correct'
      return {
        headline: (
          <>
            <b>{actor}</b> {correct ? 'got your question' : 'answered your question'}
          </>
        ),
        secondLine: faq?.domain ?? null,
        accentColor: correct ? '#d97706' : '#a8a29e',
        href: '/activities',
      }
    }

    case 'declared_promoted': {
      const dp = item.reference.declaredPromoted
      return {
        headline: (
          <>
            <b>{actor}</b> proved a domain on your map
          </>
        ),
        secondLine: dp?.domain ?? null,
        accentColor: '#16a34a',
        href: dp?.domain
          ? `/knowledge/${encodeURIComponent(dp.domain)}`
          : '/knowledge',
      }
    }

    case 'friend_mastery': {
      const mastery = item.reference.masteryEvent
      const tier = mastery?.tier ?? 'a new tier'
      return {
        headline: (
          <>
            <b>{actor}</b> reached {tier}
          </>
        ),
        secondLine: mastery?.domain ?? null,
        accentColor: '#ca8a04',
        href: '/activities',
      }
    }

    case 'reaction_received': {
      const reaction = item.reference.reaction
      const label = reaction?.reactionLabel
        ? `${reaction.reactionEmoji ? `${reaction.reactionEmoji} ` : ''}${reaction.reactionLabel}`
        : null
      return {
        headline: (
          <>
            <b>{actor}</b> reacted to your question
          </>
        ),
        secondLine: label,
        accentColor: '#ea580c',
        href: '/activities',
      }
    }

    case 'creator_note_received':
      return {
        headline: (
          <>
            <b>{actor}</b> sent a note about a question you missed
          </>
        ),
        secondLine: null,
        accentColor: '#2563eb',
        href: '/activities',
      }

    case 'question_curated': {
      const curated = item.reference.curatedQuestion
      return {
        headline: (
          <>
            <b>{actor}</b> saved your question
          </>
        ),
        secondLine: curated?.questionText ?? null,
        accentColor: '#7c3aed',
        href: '/activities',
      }
    }

    case 'authored_question_shared': {
      const shared = item.reference.authoredSharedQuestion
      const count = shared?.recipientCount ?? 0
      const friendWord = count === 1 ? 'friend' : 'friends'
      return {
        headline: (
          <>
            You shared a question with {count} {friendWord}
          </>
        ),
        secondLine: shared?.domain ?? null,
        accentColor: '#78716c',
        href: '/activities',
      }
    }

    default:
      return {
        headline: <>Something happened on Joshing</>,
        secondLine: null,
        accentColor: '#78716c',
        href: '/activities',
      }
  }
}

export function NewsRow({ item }: { item: ActivityItemView }) {
  const copy = buildCopy(item)
  const timestamp = relativeTime(item.createdAt)

  const inner = (
    <div className="flex items-start justify-between gap-3 py-2.5 pl-3 pr-1">
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm leading-snug">{copy.headline}</p>
        {copy.secondLine ? (
          <p
            className="text-muted-foreground mt-0.5 truncate text-[13px] italic"
            style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
          >
            {copy.secondLine}
          </p>
        ) : null}
      </div>
      <span className="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-[0.06em]">
        {timestamp}
      </span>
    </div>
  )

  const className = 'block border-l-[3px] transition hover:bg-muted/30'
  const style = { borderLeftColor: copy.accentColor }

  if (copy.href) {
    return (
      <Link href={copy.href} className={className} style={style}>
        {inner}
      </Link>
    )
  }

  return (
    <div className={className} style={style}>
      {inner}
    </div>
  )
}
