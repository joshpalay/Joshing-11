import { notFound, redirect } from 'next/navigation';

import { FromFriendsStreak } from '@/components/feed/FromFriendsStreak';
import { streakPageTitle } from '@/components/feed/streak-meta';
import { OverflowSubpageHeader } from '@/components/home/OverflowSubpageHeader';
import { getSession } from '@/server/auth/session';
import { buildFriendActivityQueue } from '@/server/home/build-edition';

// B-FROMFRIENDS-STREAK-PAGE-01 — a single friend's streak on its own page.
// Home (and the /from-friends overflow) show each streak as a compact triangle
// bundle summary; tapping it lands here, where the streak's questions render in
// the full answer/dismiss card treatment under a "{Friend}'s questions about …"
// header. The streak id is the StreamItem id, looked up in the same friend-
// activity queue Home windows from, so the page can never drift from Home.
export default async function FromFriendsStreakPage({
  params,
}: {
  params: Promise<{ streakId: string }>;
}) {
  const { streakId } = await params;
  const session = await getSession();
  if (!session) redirect('/login');

  const items = await buildFriendActivityQueue(session.userId);
  const streak = items.find((item) => item.id === decodeURIComponent(streakId));
  // Gone (or never a milestone) → fall back to the overflow list rather than a
  // hard 404; a streak the viewer has fully exhausted simply isn't here anymore.
  if (!streak) redirect('/from-friends');
  if (streak.expand?.kind !== 'milestone') notFound();

  const title = streakPageTitle(streak.expand.friendName, streak.expand.questions);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      <OverflowSubpageHeader eyebrow="From Friends" title={title} />
      <FromFriendsStreak item={streak} elevated headerless />
    </main>
  );
}
