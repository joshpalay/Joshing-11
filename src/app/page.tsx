import { Suspense } from 'react'
import FeedList from '@/components/FeedList'
import { Skeleton } from '@/components/ui/Skeleton'
import TodaysFiveCard, {
  type DailyStatus,
  type SlotOutcome,
} from '@/components/TodaysFiveCard'
import { CeremonyPin } from '@/components/home/CeremonyPin'
import { MissedQuestionsCard } from '@/components/home/MissedQuestionsCard'
import { getSession } from '@/server/auth/session'
import { buildHomeEdition } from '@/server/home/build-edition'
import { DAILY_QUEUE_SIZE, isRoundComplete, type QueueSlot } from '@/server/daily/types'
import { getCatchupQuestions, getTodaysDailyQueue } from '@/server/db/queries/daily'
import { getLatestUnviewedCeremony, getNextCeremonyAt } from '@/server/db/queries/ceremony'
import { getNextDailyResetBoundary } from '@/lib/games/timezone'

const FEED_PAGE_SIZE = 20

export default async function Home() {
  const session = await getSession()

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      {/* Top triangle band (Variant4-TOP, grain baked in; lower portion
          transparent so cream shows through). Bounded to the content-column
          width (inset-x-0 inside the max-w-2xl main) — the same width the
          original banner used — and rendered at its INTRINSIC size (centered &
          clipped, never scaled). The first card sits over it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden"
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
          feed). Wrapped so the triangle side-clusters scope to it: the clusters
          are confined to the TOP of this block (beside the From-Friends cards,
          never below Recent activity). */}
      <div className="relative flex flex-col gap-5">
        {/* Side clusters (Variant4-DUO / Variant4-SIDESQ), native size so the
            triangles match the top band. Bounded to the SAME width as the top
            band: the layer spans the content-column width (-left-4/-right-4
            cancels the main's px-4 so its edges line up with the top band's
            inset-x-0 edges), and the clusters hang from those left/right edges,
            pointing inward. Capped to the top region (h-[760px] +
            overflow-hidden) so none fall beside or below Recent activity. Right
            copy mirrored. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 -left-4 -right-4 -z-10 h-[760px] overflow-hidden"
        >
          {/* One cluster on the left and one on the right, at different heights
              (not mirrored pairs) — a single module per side, sat in the open
              spaces around the card sections rather than behind the card bodies:
              the left peeks in the space above the first section, the right
              lower down toward the gap below it. Native size (unchanged). */}
          <span className="absolute top-0 left-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/Variant4-SIDESQ.png" alt="" className="block w-[140px] max-w-none" />
          </span>
          <span className="absolute top-[580px] right-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/Variant4-DUO.png" alt="" className="block w-[140px] max-w-none -scale-x-100" />
          </span>
        </div>

        {session ? (
          <Suspense fallback={null}>
            <CeremonyPinSection userId={session.userId} />
          </Suspense>
        ) : null}

        <section id="feed">
          {session ? (
            <Suspense fallback={null}>
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
  const [queue, catchupItems] = await Promise.all([
    getTodaysDailyQueue(userId),
    getCatchupQuestions(userId),
  ])

  const status = buildDailyStatusSnapshot(queue)

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
  return <Skeleton className="border" style={{ minHeight }} />
}
