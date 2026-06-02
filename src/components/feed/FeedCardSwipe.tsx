'use client'

import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { usePrefersReducedMotion } from './usePrefersReducedMotion'

// Distance the finger must travel horizontally before we treat the gesture as a
// swipe (below this it's a tap, so the Answer link / "…" menu / Dismiss button
// still receive their click).
const TAP_SLOP = 10
// Distance past which releasing commits the swipe.
const COMMIT_THRESHOLD = 80

type FeedCardSwipeProps = {
  /** Left-swipe commit — wired to the same dismiss handler as the Dismiss button. */
  onSwipeLeft: () => void
  /** Right-swipe commit — wired to the existing Answer action. Omit to disable. */
  onSwipeRight?: () => void
  disabled?: boolean
  children: ReactNode
}

/**
 * Wraps a single feed card with a horizontal swipe gesture: the card follows
 * the finger, snaps back below the commit threshold, and on commit fires
 * onSwipeLeft (dismiss) or onSwipeRight (answer). Hand-rolled on pointer events
 * — there is no gesture library in the repo. Respects prefers-reduced-motion by
 * dropping the snap-back transition.
 */
export function FeedCardSwipe({
  onSwipeLeft,
  onSwipeRight,
  disabled,
  children,
}: FeedCardSwipeProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const dxRef = useRef(0)
  const pointerId = useRef<number | null>(null)
  const swiping = useRef(false)

  const reset = () => {
    dxRef.current = 0
    swiping.current = false
    pointerId.current = null
    setDx(0)
    setDragging(false)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    startX.current = event.clientX
    pointerId.current = event.pointerId
    setDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return
    const delta = event.clientX - startX.current
    if (!swiping.current && Math.abs(delta) > TAP_SLOP) {
      swiping.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    if (!swiping.current) return
    // Block the right-swipe (answer) track when there is nothing to answer.
    const bounded = !onSwipeRight && delta > 0 ? 0 : delta
    dxRef.current = bounded
    setDx(bounded)
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return
    const delta = dxRef.current
    const wasSwiping = swiping.current
    reset()
    if (!wasSwiping) return
    if (delta <= -COMMIT_THRESHOLD) {
      onSwipeLeft()
    } else if (delta >= COMMIT_THRESHOLD && onSwipeRight) {
      onSwipeRight()
    }
  }

  return (
    <div
      className={cn(
        'touch-pan-y',
        !dragging && !reducedMotion && 'transition-transform duration-200 ease-out',
      )}
      style={dx !== 0 ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {children}
    </div>
  )
}
