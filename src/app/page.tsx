import { Suspense } from 'react'
import Link from 'next/link'
import FeedList from '@/components/FeedList'
import TodaysFiveCard, {
  type DailyPreferences,
  type DailyStatus,
} from '@/components/TodaysFiveCard'
import { getSession } from '@/server/auth/session'
import { DAILY_QUEUE_SIZE, type QueueSlot } from '@/server/daily/types'
import { getCatchupQuestions, getTodaysDailyQueue } from '@/server/db/queries/daily'
import { getDailyPreferences } from '@/server/db/queries/daily-preferences'
import { getCeremonyBanner } from '@/server/db/queries/ceremony'
import { getFeedPagePayload } from '@/server/feed/get-feed-page'
import { getNextDailyResetBoundary } from '@/lib/games/timezone'

const FEED_PAGE_SIZE = 20

export default async function Home() {
  const session = await getSession()

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-24 md:py-10">
      <section className="space-y-6 border-b pb-6">
        <div className="w-full">
          <h1 className="text-foreground font-serif text-4xl leading-tight font-semibold md:text-5xl">
            You contain multitudes.
          </h1>
        </div>
        <div className="w-full space-y-3">
          {session ? (
            <Suspense fallback={<CardSkeleton minHeight="9rem" />}>
              <TodaysFiveSection userId={session.userId} />
            </Suspense>
          ) : (
            <TodaysFiveCard />
          )}
          {session ? (
            <Suspense fallback={null}>
              <MissedQuestionsSection userId={session.userId} />
            </Suspense>
          ) : null}
          <div>
            <p className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.1em] uppercase">
              What&apos;s happening
            </p>
            {session ? (
              <Suspense fallback={<FeedSkeleton />}>
                <FeedSection userId={session.userId} />
              </Suspense>
            ) : (
              <FeedList pageSize={FEED_PAGE_SIZE} infinite />
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

async function TodaysFiveSection({ userId }: { userId: string }) {
  const [queue, preferences] = await Promise.all([
    getTodaysDailyQueue(userId),
    getDailyPreferences(userId),
  ])

  const status = buildDailyStatusSnapshot(queue)
  const cardPreferences: DailyPreferences = {
    difficulty: preferences.difficulty,
    domainMode: preferences.domainMode,
    selectedDomains: preferences.selectedDomains,
  }

  return (
    <TodaysFiveCard
      initialStatus={status}
      initialPreferences={cardPreferences}
    />
  )
}

async function MissedQuestionsSection({ userId }: { userId: string }) {
  const catchupItems = await getCatchupQuestions(userId)
  const count = catchupItems.length
  if (count === 0) return null
  const expiringCount = catchupItems.filter((item) => item.expiresSoon).length
  return <MissedQuestionsCard count={count} expiringCount={expiringCount} />
}

async function FeedSection({ userId }: { userId: string }) {
  const [feedPage, banner] = await Promise.all([
    getFeedPagePayload(userId, { limit: FEED_PAGE_SIZE, cursor: null, filter: 'all' }),
    getCeremonyBanner(userId),
  ])

  return (
    <FeedList
      pageSize={FEED_PAGE_SIZE}
      infinite
      initialPage={feedPage}
      initialBanner={banner ? { id: banner.id, firedAt: banner.firedAt.toISOString() } : null}
    />
  )
}

function buildDailyStatusSnapshot(queue: Awaited<ReturnType<typeof getTodaysDailyQueue>>): DailyStatus {
  const nextRoundAt = getNextDailyResetBoundary().toISOString()
  if (!queue) {
    return {
      questionsRemaining: DAILY_QUEUE_SIZE,
      questionsAnswered: 0,
      isComplete: false,
      nextRoundAt,
      queueId: null,
    }
  }

  const slots: QueueSlot[] = Array.isArray(queue.slots) ? (queue.slots as QueueSlot[]) : []
  const answered = slots.filter((slot) => slot.answered).length
  const questionsAnswered = Math.min(answered, DAILY_QUEUE_SIZE)
  const questionsRemaining = Math.max(DAILY_QUEUE_SIZE - questionsAnswered, 0)
  const isComplete = questionsAnswered >= DAILY_QUEUE_SIZE
  return {
    questionsRemaining,
    questionsAnswered,
    isComplete,
    nextRoundAt,
    queueId: queue.id,
  }
}

function CardSkeleton({ minHeight }: { minHeight: string }) {
  return (
    <div
      className="bg-card rounded-lg border p-4"
      style={{ minHeight }}
      aria-hidden="true"
    />
  )
}

function FeedSkeleton() {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
      Loading feed…
    </div>
  )
}

function MissedQuestionsCard({
  count,
  expiringCount,
}: {
  count: number
  expiringCount: number
}) {
  if (count === 0) return null
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
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Reinforce what you learned
      </p>
      <p className="text-foreground mt-2 text-sm font-semibold">
        {count === 1 ? '1 question to revisit' : `${count} questions to revisit`}
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
