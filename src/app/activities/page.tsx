import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CreatorNoteReadButton } from '@/app/activities/CreatorNoteReadButton'
import { FriendRequestActions } from '@/app/activities/FriendRequestActions'
import { MarkActivitiesRead } from '@/app/activities/MarkActivitiesRead'
import { ReactionGotItButton } from '@/app/activities/ReactionGotItButton'
import { DayDivider } from '@/components/lately/DayDivider'
import { LatelyFeed } from '@/components/lately/LatelyFeed'
import {
  CREAM,
  FH,
  FM,
  FS,
  HILITE,
  INK,
  INK2,
  INK3,
  RULE,
} from '@/components/lately/tokens'
import { creatorNoteSubmittedAnswerText } from '@/lib/creator-note-submitted-answer'
import { getSession } from '@/server/auth/session'
import {
  getActivitiesForUser,
  type ActivityItemView,
} from '@/server/db/queries/activity'
import { getLatelyMoments } from '@/server/db/queries/lately'
import { getUserById } from '@/server/db/queries/users'

function formatActivityTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function actorName(item: ActivityItemView) {
  return item.actor?.displayName ?? 'Someone'
}

function isUnread(item: ActivityItemView) {
  if (item.type === 'reaction_received')
    return !item.reference.reaction?.repliedAt
  return !item.read
}

function ActivityCopy({ item }: { item: ActivityItemView }) {
  const game = item.reference.game
  const title = game?.title ?? 'a Joshing Game'
  const masteryEvent = item.reference.masteryEvent

  if (item.type === 'received_joshing_game') {
    if (game?.viewerStatus === 'complete') {
      return (
        <>
          {actorName(item)} sent you {title}{' '}
          <span className="text-muted-foreground">
            · You got {game.viewerScore}/{game.totalQuestions}
          </span>
        </>
      )
    }

    return (
      <>
        {actorName(item)} sent you a Joshing Game: {title}
      </>
    )
  }

  if (item.type === 'joshing_game_progress') {
    return (
      <>
        {actorName(item)} played {title}{' '}
        <span className="text-muted-foreground">
          · {game?.completedCount ?? 0} of {game?.totalRecipients ?? 0} have
          played
        </span>
      </>
    )
  }

  if (item.type === 'joshing_game_result') {
    return <>Everyone played {title}</>
  }

  if (item.type === 'friend_mastery') {
    return (
      <>
        {actorName(item)} reached {masteryEvent?.tier ?? 'a new tier'} in{' '}
        {masteryEvent?.domain ?? 'a domain'}
      </>
    )
  }

  if (item.type === 'ceremony_ready') {
    return <>Your weekly reflection is ready</>
  }

  if (item.type === 'friend_request') {
    return <>{actorName(item)} thought of you for Joshing.</>
  }

  if (item.type === 'friend_request_accepted') {
    return <>You and {actorName(item)} are now friends</>
  }

  if (item.type === 'reaction_received') {
    return <>{actorName(item)} reacted to your question</>
  }

  if (item.type === 'received_direct_question') {
    return <>{actorName(item)} sent you a question</>
  }

  if (item.type === 'question_curated') {
    return <>{actorName(item)} saved your question</>
  }

  if (item.type === 'creator_note_received') {
    return <>{actorName(item)} sent you a note about a question you missed</>
  }

  if (item.type === 'authored_question_shared') {
    const shared = item.reference.authoredSharedQuestion
    const count = shared?.recipientCount ?? 0
    const friendWord = count === 1 ? 'friend' : 'friends'
    const domain = shared?.domain ?? 'a domain'
    return (
      <>
        You shared a question with {count} {friendWord} — {domain}
      </>
    )
  }

  if (item.type === 'friend_answered_your_question') {
    const faq = item.reference.friendAnsweredQuestion
    const domain = faq?.domain
    const domainText = domain ? ` ${domain}` : ''
    return faq?.result === 'correct' ? (
      <>
        {actorName(item)} got your{domainText} question right
      </>
    ) : (
      <>
        {actorName(item)} answered your{domainText} question — couldn&apos;t get
        it
      </>
    )
  }

  if (item.type === 'declared_promoted') {
    const dp = item.reference.declaredPromoted
    const domain = dp?.domain
    return domain ? (
      <>
        {actorName(item)} answered your {domain} question — that domain is now
        proven territory on your map
      </>
    ) : (
      <>
        {actorName(item)} answered your question — a domain is now proven
        territory on your map
      </>
    )
  }

  if (item.type === 'grade_dispute_filed') {
    return (
      <>
        {actorName(item)} asked for a re-look at your question
      </>
    )
  }

  return <>Something happened on Joshing</>
}

export function ActivitySubcopy({ item }: { item: ActivityItemView }) {
  if (item.type === 'creator_note_received') {
    const note = item.reference.creatorNote
    if (!note) return null
    return (
      <CreatorNoteReadButton noteId={note.id}>
        <div className="bg-background rounded-md border p-3 text-sm leading-6">
          <p>
            <span className="text-foreground font-medium">Question:</span>{' '}
            {note.questionText}
          </p>
          <p className="text-muted-foreground mt-1">
            <span className="text-foreground font-medium">Answer:</span>{' '}
            {note.correctAnswer}
          </p>
          <p className="text-muted-foreground mt-1">
            <span className="text-foreground font-medium">You said:</span>{' '}
            {creatorNoteSubmittedAnswerText(note.submittedAnswer, 'Your')}
          </p>
          <blockquote className="border-primary/40 bg-muted/50 text-foreground mt-3 border-l-4 px-3 py-2">
            {note.noteText}
          </blockquote>
        </div>
      </CreatorNoteReadButton>
    )
  }

  if (item.type === 'received_direct_question') {
    const directQuestion = item.reference.directQuestion
    if (!directQuestion) return null

    return (
      <div className="text-muted-foreground mt-1 space-y-1 text-sm">
        {directQuestion.personalMessage ? (
          <p className="italic">
            &ldquo;{directQuestion.personalMessage}&rdquo;
          </p>
        ) : null}
        <p className="line-clamp-2">{directQuestion.questionText}</p>
      </div>
    )
  }

  if (item.type === 'question_curated') {
    const curatedQuestion = item.reference.curatedQuestion
    if (!curatedQuestion) return null
    return (
      <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
        {curatedQuestion.questionText}
      </p>
    )
  }

  if (item.type === 'friend_request') {
    const interests = item.reference.friendshipRequest?.suggestedInterests ?? []
    if (interests.length === 0) return null

    const label =
      interests.length === 1
        ? interests[0]
        : interests.length === 2
          ? `${interests[0]} and ${interests[1]}`
          : `${interests[0]}, ${interests[1]}, and ${interests[2]}`

    return (
      <p className="text-muted-foreground mt-1 text-sm">
        They left a few ideas: {label}. Keep, edit, or ignore them.
      </p>
    )
  }

  if (item.type === 'grade_dispute_filed') {
    const dispute = item.reference.gradeDispute
    if (!dispute) return null
    return (
      <div className="bg-background mt-1 space-y-1 rounded-md border p-3 text-sm leading-6">
        <p>
          <span className="text-foreground font-medium">Question:</span>{' '}
          {dispute.questionText}
        </p>
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">Canonical answer:</span>{' '}
          {dispute.canonicalAnswer}
        </p>
        {/* §8.22 dispute path: the answerer initiated the dispute, which is
            the consent gate that lets the author see their literal text. */}
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">They wrote:</span>{' '}
          {dispute.submittedAnswer || '(no text)'}
        </p>
        <p className="text-muted-foreground text-xs">
          {disputeStatusLabel(dispute.status, dispute.acceptedAlternative)}
        </p>
      </div>
    )
  }

  if (item.type !== 'reaction_received') return null
  const reaction = item.reference.reaction
  if (!reaction) return null

  return (
    <div className="text-muted-foreground mt-1 space-y-1 text-sm">
      <p>
        {reaction.reactionEmoji ? `${reaction.reactionEmoji} ` : ''}
        {reaction.reactionLabel}
        {reaction.customMessage ? ` - ${reaction.customMessage}` : ''}
      </p>
      <p className="line-clamp-2 italic">{reaction.questionText}</p>
      {/* §8.22 opt-in: rendered only when the answerer explicitly chose to
          include their submitted text. */}
      {reaction.submittedAnswer ? (
        <p>
          <span className="text-foreground font-medium">They wrote:</span>{' '}
          {reaction.submittedAnswer}
        </p>
      ) : null}
    </div>
  )
}

function disputeStatusLabel(
  status: string,
  acceptedAlternative: string | null,
): string {
  if (status === 'alternative_added') {
    return acceptedAlternative
      ? `Accepted — added "${acceptedAlternative}" as an alternative.`
      : 'Accepted — alternative added.'
  }
  if (status === 'dismissed') return 'Dismissed — grade stands.'
  if (status === 'reviewed') return 'Reviewed.'
  return 'Pending review.'
}

function ActivityCta({ item }: { item: ActivityItemView }) {
  if (!item.referenceId) return null

  if (item.type === 'received_joshing_game') {
    const complete = item.reference.game?.viewerStatus === 'complete'
    return (
      <Link
        href={
          complete
            ? `/games/${item.referenceId}/summary`
            : `/games/${item.referenceId}`
        }
        className="btn-primary"
      >
        {complete ? 'See results' : 'Play'}
      </Link>
    )
  }

  if (item.type === 'joshing_game_progress') {
    return (
      <Link href={`/games/${item.referenceId}/summary`} className="btn-primary">
        See so far
      </Link>
    )
  }

  if (item.type === 'joshing_game_result') {
    return (
      <Link href={`/games/${item.referenceId}/summary`} className="btn-primary">
        See results
      </Link>
    )
  }

  if (item.type === 'ceremony_ready') {
    return (
      <Link href={`/ceremony/${item.referenceId}`} className="btn-primary">
        See it now
      </Link>
    )
  }

  if (item.type === 'reaction_received') {
    return (
      <ReactionGotItButton
        reactionId={item.reference.reaction?.id ?? item.referenceId}
        replied={Boolean(item.reference.reaction?.repliedAt)}
      />
    )
  }

  if (item.type === 'received_direct_question') {
    return (
      <Link href="/" className="btn-primary">
        Answer
      </Link>
    )
  }

  if (item.type === 'friend_request') {
    const request = item.reference.friendshipRequest
    if (
      !request ||
      request.status !== 'pending' ||
      request.requestedByUserId === item.userId
    ) {
      return null
    }

    return <FriendRequestActions friendshipId={request.id} />
  }

  if (item.type === 'authored_question_shared') {
    return null
  }

  if (item.type === 'declared_promoted') {
    const domain = item.reference.declaredPromoted?.domain
    const href = domain
      ? `/knowledge/${encodeURIComponent(domain)}`
      : '/knowledge'
    return (
      <Link href={href} className="btn-primary">
        See your map
      </Link>
    )
  }

  return null
}

export default async function ActivitiesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [items, moments, viewer] = await Promise.all([
    getActivitiesForUser(session.userId),
    getLatelyMoments(session.userId),
    getUserById(session.userId),
  ])
  const tz = viewer?.timezone ?? 'America/New_York'

  return (
    <main
      style={{
        background: CREAM,
        color: INK,
        minHeight: '100dvh',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          margin: '0 auto',
          padding: '18px 20px 100px',
          boxSizing: 'border-box',
        }}
      >
        <MarkActivitiesRead />

        <div style={{ marginBottom: 6 }}>
          <h1
            style={{
              fontSize: 52,
              fontFamily: FS,
              fontWeight: 400,
              fontStyle: 'italic',
              lineHeight: 1,
              margin: 0,
              letterSpacing: -1.5,
              position: 'relative',
              display: 'inline-block',
            }}
          >
            Lately.
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: '30%',
                bottom: 4,
                height: 8,
                background: HILITE,
                zIndex: -1,
                opacity: 0.85,
              }}
            />
          </h1>
        </div>
        <div
          style={{
            fontSize: 13,
            color: INK2,
            fontStyle: 'italic',
            lineHeight: 1.5,
            marginBottom: 4,
          }}
        >
          Moments of connection from across your games.
        </div>
        <div
          style={{
            fontFamily: FH,
            fontSize: 18,
            color: INK2,
            marginTop: 6,
            marginLeft: 2,
            transform: 'rotate(-1deg)',
            display: 'inline-block',
          }}
        >
          — the people who get you, getting you.
        </div>

        <LatelyFeed moments={moments} tz={tz} />

        {items.length > 0 ? (
          <>
            <DayDivider label="EARLIER ACTIVITY" />
            <section className="space-y-3 pb-8">
              {items.map((item) => (
                <article
                  key={item.id}
                  id={
                    item.type === 'friend_request'
                      ? `friendship-${item.referenceId}`
                      : undefined
                  }
                  className={[
                    'bg-card text-card-foreground rounded-lg border p-4 transition',
                    isUnread(item)
                      ? 'border-l-primary border-l-[3px]'
                      : 'border-l-transparent opacity-75',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base leading-7">
                        <ActivityCopy item={item} />
                      </p>
                      <ActivitySubcopy item={item} />
                      <p className="text-muted-foreground mt-1 text-xs">
                        {formatActivityTime(item.createdAt)}
                      </p>
                    </div>
                    <ActivityCta item={item} />
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}

        {moments.length > 0 || items.length > 0 ? (
          <div
            style={{
              marginTop: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <div style={{ width: 40, height: 1, background: RULE }} />
            <div
              style={{
                fontSize: 9,
                fontFamily: FM,
                color: INK3,
                letterSpacing: 3,
              }}
            >
              END OF FEED
            </div>
            <div style={{ width: 40, height: 1, background: RULE }} />
          </div>
        ) : null}
      </div>
    </main>
  )
}
