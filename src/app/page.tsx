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
      {/* Full-bleed triangle background, behind all content and non-interactive.
          This layer breaks out of the centered max-w-2xl column (w-screen +
          left-1/2 + -translate-x-1/2) so the artwork sits at the true screen
          edges, and scrolls with the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-full w-screen -translate-x-1/2 overflow-hidden"
      >
        {/* Top band (Variant4-TOP, grain baked in; lower portion transparent so
            cream shows through). Rendered with the SAME object-cover sizing the
            login screen uses (TriangleBackground), anchored to the top — so the
            triangles render at the exact size they do on login rather than being
            shrunk to fit the content column. The first card overlaps it ("over
            the top is fine because it's a card"). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/Variant4-TOP.png"
          alt=""
          className="absolute top-0 left-1/2 h-dvh w-screen max-w-none -translate-x-1/2 object-cover object-top"
        />
        {/* Side clusters (Variant4-DUO / Variant4-SIDESQ) interspersed down the
            left and right edges. Right-side copies are mirrored (scale-x-[-1])
            so the triangles point inward. Sized to match the login triangle
            scale. They sit in the side margins on wide screens and tuck behind
            the cards on mobile. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Variant4-SIDESQ.png" alt="" className="absolute top-[360px] left-0 w-[104px] max-w-none" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Variant4-DUO.png" alt="" className="absolute top-[600px] right-0 w-[104px] max-w-none -scale-x-100" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Variant4-DUO.png" alt="" className="absolute top-[920px] left-0 w-[104px] max-w-none" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Variant4-SIDESQ.png" alt="" className="absolute top-[1180px] right-0 w-[104px] max-w-none -scale-x-100" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Variant4-SIDESQ.png" alt="" className="absolute top-[1500px] left-0 w-[104px] max-w-none" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Variant4-DUO.png" alt="" className="absolute top-[1780px] right-0 w-[104px] max-w-none -scale-x-100" />
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
