'use client'

import { useMemo, useState } from 'react'

type SharedInterestsOverlapProps = {
  viewerSoloInterests: string[]
  friendSoloInterests: string[]
  sharedInterests: string[]
  friendFirstName: string
}

const MAX_CHIPS_PER_SIDE = 8
const MAX_SHARED_CHIPS = 10

export function SharedInterestsOverlap({
  viewerSoloInterests,
  friendSoloInterests,
  sharedInterests,
  friendFirstName,
}: SharedInterestsOverlapProps) {
  const [showAll, setShowAll] = useState(false)
  const sharedCount = sharedInterests.length

  const headline = useMemo(() => {
    if (sharedCount === 0) {
      return `No interest overlap with ${friendFirstName} yet.`
    }
    if (sharedCount === 1) {
      return `You and ${friendFirstName} share 1 interest.`
    }
    return `You and ${friendFirstName} share ${sharedCount} interests.`
  }, [sharedCount, friendFirstName])

  const visibleShared = showAll
    ? sharedInterests
    : sharedInterests.slice(0, MAX_SHARED_CHIPS)
  const sharedOverflow = sharedInterests.length - visibleShared.length

  const visibleViewer = showAll
    ? viewerSoloInterests
    : viewerSoloInterests.slice(0, MAX_CHIPS_PER_SIDE)
  const viewerOverflow = viewerSoloInterests.length - visibleViewer.length

  const visibleFriend = showAll
    ? friendSoloInterests
    : friendSoloInterests.slice(0, MAX_CHIPS_PER_SIDE)
  const friendOverflow = friendSoloInterests.length - visibleFriend.length

  const hasOverlap = sharedCount > 0
  const hasAnyExpandable =
    sharedOverflow > 0 || viewerOverflow > 0 || friendOverflow > 0

  const ariaLabel =
    sharedCount > 0
      ? `You and ${friendFirstName} share ${sharedInterests.join(', ')}. You also have ${viewerSoloInterests.length} other interests, they have ${friendSoloInterests.length}.`
      : `You and ${friendFirstName} have no shared interests yet.`

  return (
    <section
      className="mt-5"
      aria-label="Shared interests"
    >
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Common ground
      </p>
      <h2 className="mt-1 font-serif text-2xl font-semibold">{headline}</h2>

      <div
        className="relative mx-auto mt-6 aspect-[5/3] w-full max-w-xl"
        role="img"
        aria-label={ariaLabel}
      >
        <div
          className={
            hasOverlap
              ? 'absolute inset-y-0 left-0 w-[62%] rounded-full bg-sky-200/55'
              : 'absolute inset-y-0 left-0 w-[48%] rounded-full bg-sky-200/55'
          }
          aria-hidden="true"
        />
        <div
          className={
            hasOverlap
              ? 'absolute inset-y-0 right-0 w-[62%] rounded-full bg-rose-200/55'
              : 'absolute inset-y-0 right-0 w-[48%] rounded-full bg-rose-200/55'
          }
          aria-hidden="true"
        />

        <div className="absolute inset-x-0 top-1 flex justify-between px-3 text-[10px] font-semibold tracking-[0.16em] uppercase">
          <span className="text-sky-900/70">You</span>
          <span className="text-rose-900/70">{friendFirstName}</span>
        </div>

        <div className="relative grid h-full grid-cols-3 items-center gap-1">
          <InterestColumn
            align="start"
            interests={visibleViewer}
            overflowCount={viewerOverflow}
            emptyCopy="You haven't added any interests yet."
            toneClass="text-sky-950"
          />

          <SharedColumn
            interests={visibleShared}
            overflowCount={sharedOverflow}
            hasOverlap={hasOverlap}
          />

          <InterestColumn
            align="end"
            interests={visibleFriend}
            overflowCount={friendOverflow}
            emptyCopy={`${friendFirstName} hasn't added any interests yet.`}
            toneClass="text-rose-950"
          />
        </div>
      </div>

      {hasAnyExpandable ? (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline"
          >
            {showAll ? 'Show less' : 'Show all'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function InterestColumn({
  align,
  interests,
  overflowCount,
  emptyCopy,
  toneClass,
}: {
  align: 'start' | 'end'
  interests: string[]
  overflowCount: number
  emptyCopy: string
  toneClass: string
}) {
  if (interests.length === 0) {
    return (
      <div
        className={`flex flex-col gap-1.5 px-2 text-[11px] italic ${
          align === 'start' ? 'items-start' : 'items-end'
        } ${toneClass} opacity-70`}
      >
        <span>{emptyCopy}</span>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col gap-1.5 px-2 ${
        align === 'start' ? 'items-start' : 'items-end'
      } ${toneClass}`}
    >
      {interests.map((interest) => (
        <span
          key={interest}
          className="max-w-full truncate rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-medium shadow-sm"
        >
          {interest}
        </span>
      ))}
      {overflowCount > 0 ? (
        <span className="text-[11px] font-medium opacity-70">
          +{overflowCount} more
        </span>
      ) : null}
    </div>
  )
}

function SharedColumn({
  interests,
  overflowCount,
  hasOverlap,
}: {
  interests: string[]
  overflowCount: number
  hasOverlap: boolean
}) {
  if (!hasOverlap) {
    return (
      <div className="flex flex-col items-center justify-center px-1 text-center">
        <span className="text-xs font-medium text-stone-500">
          No overlap yet
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-1">
      {interests.map((interest) => (
        <span
          key={interest}
          className="max-w-full truncate rounded-full bg-white px-3 py-1 text-center text-sm font-semibold text-stone-900 shadow"
        >
          {interest}
        </span>
      ))}
      {overflowCount > 0 ? (
        <span className="text-[11px] font-semibold text-stone-700">
          +{overflowCount} more shared
        </span>
      ) : null}
    </div>
  )
}
