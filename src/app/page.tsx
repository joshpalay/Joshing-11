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
import { buildHomeEdition } from '@/server/home/build-edition'
import { DAILY_QUEUE_SIZE, isRoundComplete, type QueueSlot } from '@/server/daily/types'
import { getCatchupQuestions, getTodaysDailyQueue } from '@/server/db/queries/daily'
import { getDailyPreferences } from '@/server/db/queries/daily-preferences'
import { getLatestUnviewedCeremony, getNextCeremonyAt } from '@/server/db/queries/ceremony'
import { getNextDailyResetBoundary } from '@/lib/games/timezone'

const FEED_PAGE_SIZE = 20

export default async function Home() {
  const session = await getSession()

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      {/* Top triangle band (Variant4-TOP, grain baked in; lower portion
          transparent so cream shows through). Full-bleed and behind everything,
          rendered at its INTRINSIC size — it does not scale with the viewport or
          stretch to the content column. Centered and clipped; the first card
          sits over it ("over the top is fine because it's a card"). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/Variant4-TOP.png"
          alt=""
          className="relative left-1/2 block max-w-none -translate-x-1/2"
        />
      </div>

      {/* Today's Five — a card, so it can ride over the top triangle band. */}
      {session ? (
        <Suspense fallback={<CardSkeleton minHeight="9rem" />}>
          <TodaysFiveSection userId={session.userId} />
        </Suspense>
      ) : (
        <TodaysFiveCard />
      )}

      {/* Lower content (the weekly-reflection pin + the From-Friends / For-you
          feed). Wrapped so the triangle side-clusters and the cream readability
          backing both scope to it: the clusters are clipped to this block's
          height (no triangles fall below the last card), and the opaque cream
          rectangle keeps the section headers that sit between cards legible. */}
      <div className="relative flex flex-col gap-5">
        {/* Side clusters (Variant4-DUO / Variant4-SIDESQ) down both edges, pulled
            in close to the content column. Right-side copies are mirrored so the
            triangles point inward. The layer is clipped to this block
            (inset-y-0 + overflow-hidden), so clusters never appear below the
            cards. Behind the cream backing (-z-10). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden"
        >
          <div className="relative mx-auto h-full max-w-2xl">
            <span className="absolute top-[40px] left-0 -translate-x-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/Variant4-SIDESQ.png" alt="" className="block w-[104px] max-w-none" />
            </span>
            <span className="absolute top-[300px] right-0 translate-x-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/Variant4-DUO.png" alt="" className="block w-[104px] max-w-none -scale-x-100" />
            </span>
            <span className="absolute top-[560px] left-0 -translate-x-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/Variant4-DUO.png" alt="" className="block w-[104px] max-w-none" />
            </span>
            <span className="absolute top-[820px] right-0 translate-x-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/Variant4-SIDESQ.png" alt="" className="block w-[104px] max-w-none -scale-x-100" />
            </span>
            <span className="absolute top-[1080px] left-0 -translate-x-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/Variant4-SIDESQ.png" alt="" className="block w-[104px] max-w-none" />
            </span>
            <span className="absolute top-[1340px] right-0 translate-x-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/Variant4-DUO.png" alt="" className="block w-[104px] max-w-none -scale-x-100" />
            </span>
          </div>
        </div>

        {/* Opaque cream rectangle behind this block — above the triangles
            (-z-[1]) but below the cards, so the headers that sit between cards
            stay readable over the art. On non-triangle surfaces it is
            cream-on-cream (invisible). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-[1] bg-[var(--brand-cream-page)]"
        />

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
      </div>
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
  // The standalone Catch up card is suppressed entirely — when the round is in
  // progress the TodaysFiveCard now shows a small catch-up link under the play
  // button; when the round is complete, Branch A on the card owns that entry point.
  const showStandaloneCatchup = false

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
  // D-HOME-PACING-01: the unified "What's Happening" home feed is now a fixed-
  // budget EDITION, not a render of everything. The server-side selection layer
  // computes the served slice of each zone (Direct 3, Playables 4, Texture ~5),
  // the overflow counts the question zones window against, the one rotating
  // panel, and the all-empty switch. FeedList renders this pre-budgeted edition
  // (no client-side selection, no infinite scroll, no temporal buckets).
  const { edition, feedMeta } = await buildHomeEdition(userId)

  // Seed FeedList with the served direct slice and the same meta the empty-state
  // copy / surface tabs read. has_more is false: the budget is the page; the
  // remainder is reached via the overflow affordances, not by paging.
  const initialPage = {
    viewer_user_id: userId,
    meta: feedMeta,
    items: edition.direct.served,
    has_more: false,
    next_cursor: null,
  }

  return (
    <>
      {/* Sit the header on the feed's left gutter — the same 2px the activity
          rows pad in (where the fixed icon column / shape marks begin), so the
          header and the shapes share one left edge. The day labels indent
          further (pl-9, past the icon column) to meet the row copy.
          Only rendered when the directed "For you" zone actually has content —
          an empty section should not carry a heading (it read as a stranded
          eyebrow above the "From Friends" band). */}
      {edition.direct.served.length > 0 ? (
        <p className="mb-2 pl-0.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
          For you
        </p>
      ) : null}
      <FeedList
        pageSize={FEED_PAGE_SIZE}
        initialPage={initialPage}
        showContributeFooter
        unifiedHome
        activityItems={[...edition.playables.served, ...edition.texture]}
        budget={{
          directOverflowCount: edition.direct.overflowCount,
          playablesOverflowCount: edition.playables.overflowCount,
          panel: edition.panel,
          isAllEmpty: edition.isAllEmpty,
          // D-HOME-DASHBOARD-MODEL-01 point 4 — per-section empty signal drives
          // the honest per-section empty states under the "Past 7 days" band.
          emptySections: edition.emptySections,
        }}
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
