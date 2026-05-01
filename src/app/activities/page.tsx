import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MarkActivitiesRead } from '@/app/activities/MarkActivitiesRead';
import { getSession } from '@/server/auth/session';
import { getActivitiesForUser, type ActivityItemView } from '@/server/db/queries/activity';

function formatActivityTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
}

function actorName(item: ActivityItemView) {
  return item.actor?.displayName ?? 'Someone';
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

  return <>Something happened on Joshing</>;
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
                item.read ? 'border-l-transparent opacity-75' : 'border-l-[3px] border-l-primary',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base leading-7">
                    <ActivityCopy item={item} />
                  </p>
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
