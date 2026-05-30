import Link from 'next/link'

import type { ActivityItemView } from '@/server/db/queries/activity'

type NewsRowCopy = {
  headline: React.ReactNode
  secondLine: string | null
  accentColor: string
}

function actorName(item: ActivityItemView): string {
  return item.actor?.displayName ?? 'Someone'
}

// The actor's name is the only link in a news row — it points at their
// profile. When we don't have a user id (e.g. "You shared…" rows) it stays
// plain bold text.
function ActorName({ item }: { item: ActivityItemView }) {
  const name = actorName(item)
  if (!item.actorUserId) {
    return <b>{name}</b>
  }
  return (
    <Link
      href={`/users/${item.actorUserId}`}
      className="font-bold text-[var(--brand-link)] transition hover:opacity-70"
    >
      {name}
    </Link>
  )
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
// `actor` is the rendered actor name node (a profile link when we have a user
// id); it's the only interactive element in the row.
function buildCopy(item: ActivityItemView, actor: React.ReactNode): NewsRowCopy {
  switch (item.type) {
    case 'friend_answered_your_question': {
      const faq = item.reference.friendAnsweredQuestion
      const correct = faq?.result === 'correct'
      const verb = correct ? 'got' : 'answered'
      const domain = faq?.domain?.trim() || null
      return {
        headline: (
          <>
            {actor} {verb} your question
          </>
        ),
        secondLine: domain,
        accentColor: correct ? '#d97706' : '#a8a29e',
      }
    }

    case 'declared_promoted': {
      const dp = item.reference.declaredPromoted
      const domain = dp?.domain?.trim() || null
      return {
        headline: (
          <>
            {actor}{' '}
            {domain ? 'opened a new domain in' : 'opened up a new domain on your map'}
          </>
        ),
        secondLine: domain,
        accentColor: '#16a34a',
      }
    }

    case 'friend_mastery': {
      const mastery = item.reference.masteryEvent
      const tier = mastery?.tier ?? 'a new tier'
      return {
        headline: (
          <>
            {actor} reached {tier}
          </>
        ),
        secondLine: mastery?.domain ?? null,
        accentColor: '#ca8a04',
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
            {actor} reacted to your question
          </>
        ),
        secondLine: label,
        accentColor: '#ea580c',
      }
    }

    case 'creator_note_received':
      return {
        headline: (
          <>
            {actor} sent a note about a question you missed
          </>
        ),
        secondLine: null,
        accentColor: '#2563eb',
      }

    case 'question_curated':
      return {
        headline: (
          <>
            {actor} saved your question
          </>
        ),
        secondLine: null,
        accentColor: '#7c3aed',
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
      }
    }

    default:
      return {
        headline: <>Something happened on Joshing</>,
        secondLine: null,
        accentColor: '#78716c',
      }
  }
}

export function NewsRow({ item }: { item: ActivityItemView }) {
  const copy = buildCopy(item, <ActorName item={item} />)
  const timestamp = relativeTime(item.createdAt)

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-[23px] text-[var(--brand-ink)] [&_b]:font-bold [&_b]:text-[var(--brand-link)]">
          {copy.headline}
        </p>
        {copy.secondLine ? (
          <p className="mt-0.5 line-clamp-2 font-serif text-[14px] leading-[22px] tracking-[0.04em] text-[var(--brand-ink-700)]">
            {copy.secondLine}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-sm leading-[23px] text-[var(--brand-ink-400)]">
        {timestamp}
      </span>
    </div>
  )
}
