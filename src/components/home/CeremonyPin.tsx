import Link from 'next/link'

export type CeremonyPinStatus = {
  nextFireAt: string
  latestUnviewed: { id: string; firedAt: string } | null
}

// One ceremonial editorial marker, in the same visual family as the existing
// weekly-summary countdown: centered, gold, uppercase, calm. No card, no border,
// no box, no CTA button — the line itself is the moment. A subtle opacity-only
// fade-in on first paint (no movement, no pulse), gated to motion-safe. When a
// reflection is ready the whole row is the tap target; the future-state
// countdown is the same treatment with only the text changed.
const MARKER_CLASS =
  'flex items-center justify-center gap-2 py-3 text-center text-xs font-medium tracking-[0.08em] text-[var(--tri-amber)] uppercase motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700'

/**
 * Top-of-home ceremony slot. Lifted out of FeedList so Home can render it
 * directly (above the feed) and FeedList stays focused on the playable stream.
 *
 * Three states, ONE treatment (always the calm gold marker, never a dashboard
 * card):
 *   1. Unviewed ceremony → tappable "Your weekly reflection is ready"
 *   2. Today is Sunday (UTC) → hidden (cron is firing; nothing to anticipate)
 *   3. Otherwise → countdown "Weekly Reflection in N days"
 */
export function CeremonyPin({ status }: { status: CeremonyPinStatus | null }) {
  if (!status) return null

  if (status.latestUnviewed) {
    return (
      <Link href={`/ceremony/${status.latestUnviewed.id}`} className={MARKER_CLASS}>
        <span aria-hidden>✦</span>
        <span>Your weekly reflection is ready</span>
      </Link>
    )
  }

  const now = new Date()
  if (now.getUTCDay() === 0) return null

  const nextFireAt = new Date(status.nextFireAt)
  const todayUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const fireUtcMidnight = Date.UTC(
    nextFireAt.getUTCFullYear(),
    nextFireAt.getUTCMonth(),
    nextFireAt.getUTCDate(),
  )
  const daysUntil = Math.max(
    1,
    Math.round((fireUtcMidnight - todayUtcMidnight) / 86_400_000),
  )
  const label =
    daysUntil === 1
      ? 'Weekly Reflection tomorrow'
      : `Weekly Reflection in ${daysUntil} days`

  return (
    <div className={MARKER_CLASS}>
      <span aria-hidden>✦</span>
      <span>{label}</span>
    </div>
  )
}
