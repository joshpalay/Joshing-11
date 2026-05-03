import Link from 'next/link';
import { Activity, Brain, Gamepad2, Rss } from 'lucide-react';
import FeedList from '@/components/FeedList';
import TodaysFiveCard from '@/components/TodaysFiveCard';
import { getSession } from '@/server/auth/session';
import { getCatchupQuestions } from '@/server/db/queries/daily';

const secondaryLinks = [
  {
    href: '/feed',
    label: 'Feed',
    description: 'See what friends are playing and sending.',
    Icon: Rss,
  },
  {
    href: '/knowledge',
    label: 'Knowledge',
    description: 'Track the areas you are building.',
    Icon: Brain,
  },
  {
    href: '/activities',
    label: 'Activities',
    description: 'Catch up on invites, answers, and friend activity.',
    Icon: Activity,
  },
  {
    href: '/new-game',
    label: 'New Game',
    description: 'Send up to five questions to someone else.',
    Icon: Gamepad2,
  },
];

export default async function Home() {
  const session = await getSession();
  const catchupCount = session ? (await getCatchupQuestions(session.userId)).length : 0;

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
          <div className="rounded-lg border bg-card p-4 text-card-foreground">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">What's happening</p>
            <FeedList limit={3} />
            <div className="mt-2 flex justify-end">
              <Link href="/feed" className="text-sm font-medium underline-offset-4 hover:underline">
                Feed
              </Link>
            </div>
          </div>
          {catchupCount > 0 ? <CatchupCard count={catchupCount} /> : null}
        </div>
      </section>

      <section className="grid gap-3 py-5 sm:grid-cols-2">
        {secondaryLinks.map(({ href, label, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-lg border bg-card p-4 text-card-foreground transition hover:border-foreground/25 hover:bg-muted/50"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  {description}
                </span>
              </span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}

function CatchupCard({ count }: { count: number }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground">
      <p className="text-sm font-semibold text-foreground">
        {count} {count === 1 ? 'question' : 'questions'} you missed
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">Catch up · 0.25× points</p>
      <Link href="/daily/catchup" className="btn-ghost mt-4 min-h-11 w-full justify-center">
        Catch up →
      </Link>
    </div>
  );
}
