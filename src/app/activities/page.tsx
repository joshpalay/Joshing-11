import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CreatorNoteReadButton } from '@/app/activities/CreatorNoteReadButton';
import { MarkActivitiesRead } from '@/app/activities/MarkActivitiesRead';
import { ReactionGotItButton } from '@/app/activities/ReactionGotItButton';
import { getSession } from '@/server/auth/session';
import { getActivitiesForUser, type ActivityItemView } from '@/server/db/queries/activity';

function formatActivityTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
}

function actorName(item: ActivityItemView) {
  return item.actor?.displayName ?? 'Someone';
}

function isUnread(item: ActivityItemView) {
  if (item.type === 'reaction_received') return !item.reference.reaction?.repliedAt;
  return !item.read;
}

function ActivityCopy({ item }: { item: ActivityItemView }) {
  const game = item.reference.game;
  const title = game?.title ?? 'a Joshing Game';
  const masteryEvent = item.reference.masteryEvent;

  if (item.type === 'received_joshing_game') {
    if (game?.viewerStatus === 'complete') {
      return (
        <>
          {actorName(item)} sent you {title} <span className="text-muted-foreground">· You got {game.viewerScore}/{game.totalQuestions}</span>
        </>
      );
    }

    return <>{actorName(item)} sent you a Joshing Game: {title}</>;
  }

  if (item.type === 'joshing_game_progress') {
    return <>{actorName(item)} played {title} <span className="text-muted-foreground">· {game?.completedCount ?? 0} of {game?.totalRecipients ?? 0} have played</span></>;
  }

  if (item.type === 'joshing_game_result') {
    return <>Everyone played {title}</>;
  }

  if (item.type === 'friend_mastery') {
    return <>{actorName(item)} reached {masteryEvent?.tier ?? 'a new tier'} in {masteryEvent?.domain ?? 'a domain'}</>;
  }

  if (item.type === 'ceremony_ready') {
    return <>Your two-week reflection is ready</>;
  }

  if (item.type === 'friend_request') {
    return <>{actorName(item)} wants to be friends on Joshing</>;
  }

  if (item.type === 'friend_request_accepted') {
    return <>You and {actorName(item)} are now friends</>;
  }

  if (item.type === 'reaction_received') {
    return <>{actorName(item)} reacted to your question</>;
  }

  if (item.type === 'received_direct_question') {
    return <>{actorName(item)} sent you a question</>;
  }

  if (item.type === 'question_curated') {
    return <>{actorName(item)} saved your question</>;
  }

  if (item.type === 'creator_note_received') {
    return <>{actorName(item)} sent you a note about a question you missed</>;
  }

  return <>Something happened on Joshing</>;
}

function ActivitySubcopy({ item }: { item: ActivityItemView }) {
  if (item.type === 'creator_note_received') {
    const note = item.reference.creatorNote;
    if (!note) return null;
    return (
      <CreatorNoteReadButton noteId={note.id}>
        <div className="rounded-md border bg-background p-3 text-sm leading-6">
          <p><span className="font-medium text-foreground">Question:</span> {note.questionText}</p>
          <p className="mt-1 text-muted-foreground">
            <span className="font-medium text-foreground">Answer:</span> {note.correctAnswer}
          </p>
          <p className="mt-1 text-muted-foreground">
            <span className="font-medium text-foreground">You said:</span>{' '}
            {note.submittedAnswer?.trim() || 'Your answer was not saved.'}
          </p>
          <blockquote className="mt-3 border-l-4 border-primary/40 bg-muted/50 px-3 py-2 text-foreground">
            {note.noteText}
          </blockquote>
        </div>
      </CreatorNoteReadButton>
    );
  }

  if (item.type === 'received_direct_question') {
    const directQuestion = item.reference.directQuestion;
    if (!directQuestion) return null;

    return (
      <div className="mt-1 space-y-1 text-sm text-muted-foreground">
        {directQuestion.personalMessage ? (
          <p className="italic">&ldquo;{directQuestion.personalMessage}&rdquo;</p>
        ) : null}
        <p className="line-clamp-2">{directQuestion.questionText}</p>
      </div>
    );
  }

  if (item.type === 'question_curated') {
    const curatedQuestion = item.reference.curatedQuestion;
    if (!curatedQuestion) return null;
    return <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{curatedQuestion.questionText}</p>;
  }

  if (item.type !== 'reaction_received') return null;
  const reaction = item.reference.reaction;
  if (!reaction) return null;

  return (
    <div className="mt-1 space-y-1 text-sm text-muted-foreground">
      <p>
        {reaction.reactionEmoji ? `${reaction.reactionEmoji} ` : ''}{reaction.reactionLabel}
        {reaction.customMessage ? ` - ${reaction.customMessage}` : ''}
      </p>
      <p className="line-clamp-2 italic">{reaction.questionText}</p>
    </div>
  );
}

function ActivityCta({ item }: { item: ActivityItemView }) {
  if (!item.referenceId) return null;

  if (item.type === 'received_joshing_game') {
    const complete = item.reference.game?.viewerStatus === 'complete';
    return (
      <Link href={complete ? `/games/${item.referenceId}/summary` : `/games/${item.referenceId}`} className="btn-primary">
        {complete ? 'See results' : 'Play'}
      </Link>
    );
  }

  if (item.type === 'joshing_game_progress') {
    return <Link href={`/games/${item.referenceId}/summary`} className="btn-primary">See so far</Link>;
  }

  if (item.type === 'joshing_game_result') {
    return <Link href={`/games/${item.referenceId}/summary`} className="btn-primary">See results</Link>;
  }

  if (item.type === 'ceremony_ready') {
    return <Link href={`/ceremony/${item.referenceId}`} className="btn-primary">See it now</Link>;
  }

  if (item.type === 'reaction_received') {
    return (
      <ReactionGotItButton
        reactionId={item.reference.reaction?.id ?? item.referenceId}
        replied={Boolean(item.reference.reaction?.repliedAt)}
      />
    );
  }

  if (item.type === 'received_direct_question') {
    return <Link href="/feed" className="btn-primary">Answer</Link>;
  }

  return null;
}

export default async function ActivitiesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const items = await getActivitiesForUser(session.userId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <MarkActivitiesRead />
      <header className="mb-5 border-b pb-4">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Activities</p>
        <h1 className="font-serif text-2xl font-semibold text-foreground">What happened lately</h1>
      </header>

      {items.length === 0 ? (
        <section className="flex flex-1 items-center justify-center py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            Nothing here yet. Play some questions and send a Joshing Game.
          </p>
        </section>
      ) : (
        <section className="space-y-3 pb-8">
          {items.map((item) => (
            <article
              key={item.id}
              className={[
                'rounded-lg border bg-card p-4 text-card-foreground transition',
                isUnread(item) ? 'border-l-[3px] border-l-primary' : 'border-l-transparent opacity-75',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base leading-7">
                    <ActivityCopy item={item} />
                  </p>
                  <ActivitySubcopy item={item} />
                  <p className="mt-1 text-xs text-muted-foreground">{formatActivityTime(item.createdAt)}</p>
                </div>
                <ActivityCta item={item} />
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
