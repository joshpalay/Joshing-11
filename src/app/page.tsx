import { Suspense } from 'react'
import FeedList from '@/components/FeedList'
import LoadingScreen from '@/components/LoadingScreen'
import TodaysFiveCard, {
  type DailyPreferences,
  type DailyStatus,
  type SlotOutcome,
} from '@/components/TodaysFiveCard'
import { CeremonyPin } from '@/components/home/CeremonyPin'
import { MissedQuestionsCard } from '@/components/home/MissedQuestionsCard'
import { getSession } from '@/server/auth/session'
import { buildActivityStream } from '@/server/activity/build-stream'
import { DAILY_QUEUE_SIZE, isRoundComplete, type QueueSlot } from '@/server/daily/types'
import { getCatchupQuestions, getTodaysDailyQueue } from '@/server/db/queries/daily'
import { getDailyPreferences } from '@/server/db/queries/daily-preferences'
import { getLatestUnviewedCeremony, getNextCeremonyAt } from '@/server/db/queries/ceremony'
import { getFeedPagePayload } from '@/server/feed/get-feed-page'
import { getNextDailyResetBoundary } from '@/lib/games/timezone'

const FEED_PAGE_SIZE = 20

export default async function Home() {
  const session = await getSession()

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-2xl flex-col gap-[18px] px-4 py-6 pb-32 md:py-10">
      {/* Triangle banner (Figma Mask group): the SAME Variant4 pattern as the
          login background, rendered at the same full-viewport-cover scale and
          clipped to a band so the triangles match login in size. No gradient —
          a clean band the cards overlap. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 overflow-hidden"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/Variant4.png"
          alt=""
          className="absolute inset-x-0 top-0 h-screen w-full object-cover object-center"
        />
      </div>

      {session ? (
        <Suspense fallback={<CardSkeleton minHeight="9rem" />}>
          <TodaysFiveSection userId={session.userId} />
        </Suspense>
      ) : (
        <TodaysFiveCard />
      )}

      {session ? (
        <Suspense fallback={null}>
          <CeremonyPinSection userId={session.userId} />
        </Suspense>
      ) : null}

      <section id="feed">
        {session ? (
          <Suspense fallback={<FeedSkeleton />}>
            <FromYourFriendsSection userId={session.userId} />
          </Suspense>
        ) : (
          <FeedList pageSize={FEED_PAGE_SIZE} infinite />
        )}
      </section>
    </main>
  )
}

async function TodaysFiveSection({ userId }: { userId: string }) {
  const [queue, preferences, catchupItems] = await Promise.all([
    getTodaysDailyQueue(userId),
    getDailyPreferences(userId),
    getCatchupQuestions(userId),
  ])

  const status = buildDailyStatusSnapshot(queue)
  const cardPreferences: DailyPreferences = {
    difficulty: preferences.difficulty,
    domainMode: preferences.domainMode,
    selectedDomains: preferences.selectedDomains,
  }

  const missedCount = catchupItems.length
  const expiringCount = catchupItems.filter((item) => item.expiresSoon).length
  // Suppress the standalone Catch up card in the missed>0 completed state — the
  // completed hero's Branch A already owns that entry point, so showing both
  // would be a duplicate. When the round is still in progress (hero is in its
  // play state, not Branch A), the standalone card stays.
  const showStandaloneCatchup = missedCount > 0 && !status.isComplete

  return (
    <>
      <TodaysFiveCard
        initialStatus={status}
        initialPreferences={cardPreferences}
        initialMissedCount={missedCount}
      />
      {showStandaloneCatchup ? (
        <MissedQuestionsCard count={missedCount} expiringCount={expiringCount} />
      ) : null}
    </>
  )
}

async function CeremonyPinSection({ userId }: { userId: string }) {
  const latestUnviewed = await getLatestUnviewedCeremony(userId)
  return (
    <CeremonyPin
      status={{
        nextFireAt: getNextCeremonyAt().toISOString(),
        latestUnviewed: latestUnviewed
          ? { id: latestUnviewed.id, firedAt: latestUnviewed.firedAt.toISOString() }
          : null,
      }}
    />
  )
}

async function FromYourFriendsSection({ userId }: { userId: string }) {
  // The unified "What's Happening" home feed: the question feed merged with the
  // full activity/Lately stream, interleaved chronologically inside FeedList.
  // Filter 'all' (not 'from-friends') so directly-sent questions thread in; the
  // prefetch matches FeedList's unifiedHome seeding for a no-round-trip paint.
  const [feedPage, activityItems] = await Promise.all([
    getFeedPagePayload(userId, {
      limit: FEED_PAGE_SIZE,
      cursor: null,
      filter: 'all',
    }),
    buildActivityStream(userId),
  ])
  return (
    <>
      <p className="mb-2 px-3 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
        What&rsquo;s happening
      </p>
      <FeedList
        pageSize={FEED_PAGE_SIZE}
        infinite
        initialPage={feedPage}
        showContributeFooter
        unifiedHome
        activityItems={activityItems}
      />
    </>
  )
}

function buildSlotOutcomes(slots: QueueSlot[]): SlotOutcome[] {
  const outcomes: SlotOutcome[] = Array.from({ length: DAILY_QUEUE_SIZE }, () => 'unanswered')
  for (const slot of slots) {
    const idx = slot.slot_index
    if (!Number.isInteger(idx) || idx < 0 || idx >= DAILY_QUEUE_SIZE) continue
    if (slot.answered) {
      outcomes[idx] = slot.answer_state === 'incorrect' ? 'incorrect' : 'correct'
    } else if (slot.skipped) {
      outcomes[idx] = 'skipped'
    }
  }
  return outcomes
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
      slotOutcomes: buildSlotOutcomes([]),
    }
  }

  const slots: QueueSlot[] = Array.isArray(queue.slots) ? (queue.slots as QueueSlot[]) : []
  const answered = slots.filter((slot) => slot.answered).length
  const questionsAnswered = Math.min(answered, DAILY_QUEUE_SIZE)
  // Mirror the /api/daily/status predicate: a round is complete when no slot is
  // pending (answered or skipped), not when 5 are answered. Skipped slots whose
  // replacement failed to generate left the home card stuck on "Resume round"
  // while /daily bounced straight to the summary.
  const isComplete = isRoundComplete(slots)
  const questionsRemaining = isComplete
    ? 0
    : Math.max(DAILY_QUEUE_SIZE - questionsAnswered, 0)
  return {
    questionsRemaining,
    questionsAnswered,
    isComplete,
    nextRoundAt,
    queueId: queue.id,
    slotOutcomes: buildSlotOutcomes(slots),
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
    <div className="overflow-hidden rounded-lg">
      <LoadingScreen label="Loading feed" />
    </div>
  )
}
