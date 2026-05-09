import Link from 'next/link';
import FeedList from '@/components/FeedList';
import TodaysFiveCard from '@/components/TodaysFiveCard';
import { getSession } from '@/server/auth/session';
import { getCatchupQuestions } from '@/server/db/queries/daily';

export default async function Home() {
  const session = await getSession();
  const catchupItems = session ? await getCatchupQuestions(session.userId) : [];
  const catchupCount = catchupItems.length;
  const expiringCount = catchupItems.filter((item) => item.expiresSoon).length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 py-6 pb-24 md:py-10">
      <section className="border-b pb-6 md:flex md:items-end md:justify-between md:gap-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Joshing
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight text-foreground md:text-5xl">
            Today&apos;s five is ready when you are.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            Play five questions, build your knowledge map, and keep the day moving.
          </p>
        </div>
        <div className="mt-6 w-full space-y-3 md:mt-0 md:max-w-xs">
          <TodaysFiveCard />
          {catchupCount > 0 ? <CatchupCard count={catchupCount} expiringCount={expiringCount} /> : null}
          <div className="rounded-lg border bg-card p-4 text-card-foreground">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">What&apos;s happening</p>
            <FeedList limit={3} />
            <div className="mt-2 flex justify-end">
              <Link href="/feed" className="text-sm font-medium underline-offset-4 hover:underline">
                Feed
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function CatchupCard({ count, expiringCount }: { count: number; expiringCount: number }) {
  return (
    <div
      className="rounded-lg border bg-card p-4 text-card-foreground"
      style={expiringCount > 0 ? {
        borderColor: 'color-mix(in srgb, #b45309 32%, var(--border))',
        boxShadow: '0 0 0 1px color-mix(in srgb, #b45309 10%, transparent)',
      } : undefined}
    >
      <p className="text-sm font-semibold text-foreground">
        {count} {count === 1 ? 'question' : 'questions'} you missed
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">Catch up - 0.25x points</p>
      {expiringCount > 0 ? (
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.08em]" style={{ color: '#b45309' }}>
          {expiringCount} expires tomorrow
        </p>
      ) : null}
      <Link href="/daily/catchup" className="btn-ghost mt-4 min-h-11 w-full justify-center">
        Catch up →
      </Link>
    </div>
  );
}
