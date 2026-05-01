import { notFound, redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getJoshingGame } from '@/server/db/queries/joshing-game';
import { JoshingGamePlayClient } from './play-client';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function JoshingGamePage({ params }: PageProps) {
  const session = await getSession();
  if (!session) notFound();

  const { id } = await params;
  const view = await getJoshingGame({ gameId: id, requestingUserId: session.userId });
  if (!view) notFound();
  if (view.game.creatorId !== session.userId && !view.recipients.some((recipient) => recipient.userId === session.userId)) {
    notFound();
  }
  if (view.viewerStatus === 'complete') redirect(`/games/${id}/summary`);

  return <JoshingGamePlayClient game={JSON.parse(JSON.stringify(view))} viewerId={session.userId} />;
}
