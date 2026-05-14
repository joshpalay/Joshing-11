import Link from 'next/link'
import FeedList from '@/components/FeedList'
import TodaysFiveCard from '@/components/TodaysFiveCard'
import { getSession } from '@/server/auth/session'
import { getCatchupQuestions } from '@/server/db/queries/daily'

export default async function Home() {
  const session = await getSession()
  const catchupItems = session ? await getCatchupQuestions(session.userId) : []
  const catchupCount = catchupItems.length
  const expiringCount = catchupItems.filter((item) => item.expiresSoon).length

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-24 md:py-10">
      <section className="space-y-6 border-b pb-6">
        <div className="w-full">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
            Joshing
          </p>
          <h1 className="text-foreground mt-3 font-serif text-4xl leading-tight font-semibold md:text-5xl">
            You contain multitudes.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-base leading-7">
            A small daily game for seeing what you know, what your friends know,
            and how your map keeps changing.
          </p>
        </div>
        <div className="w-full space-y-3">
          <TodaysFiveCard />
          {catchupCount > 0 ? (
            <CatchupCard count={catchupCount} expiringCount={expiringCount} />
          ) : null}
          <div className="bg-card text-card-foreground rounded-lg border p-4">
            <p className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.1em] uppercase">
              What&apos;s happening
            </p>
            <FeedList pageSize={3} />
            <div className="mt-2 flex justify-end">
              <Link
                href="/feed"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Feed
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function CatchupCard({
  count,
  expiringCount,
}: {
  count: number
  expiringCount: number
}) {
  return (
    <div
      className="bg-card text-card-foreground rounded-lg border p-4"
      style={
        expiringCount > 0
          ? {
              borderColor: 'color-mix(in srgb, #b45309 32%, var(--border))',
              boxShadow:
                '0 0 0 1px color-mix(in srgb, #b45309 10%, transparent)',
            }
          : undefined
      }
    >
      <p className="text-foreground text-sm font-semibold">
        {count} {count === 1 ? 'question' : 'questions'} you missed
      </p>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        Catch up - 0.25x points
      </p>
      {expiringCount > 0 ? (
        <p
          className="mt-1 text-xs font-medium tracking-[0.08em] uppercase"
          style={{ color: '#b45309' }}
        >
          {expiringCount} expires tomorrow
        </p>
      ) : null}
      <Link
        href="/daily/catchup"
        className="btn-ghost mt-4 min-h-11 w-full justify-center"
      >
        Catch up →
      </Link>
    </div>
  )
}
