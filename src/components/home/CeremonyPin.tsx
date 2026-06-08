import Link from 'next/link'

export type CeremonyPinStatus = {
  nextFireAt: string
  latestUnviewed: { id: string; firedAt: string } | null
}

/**
 * Top-of-home ceremony slot. Lifted out of FeedList so Home can render it
 * directly (above RecentActivity) and FeedList stays focused on the playable
 * stream.
 *
 * Three states:
 *   1. Unviewed ceremony → amber link card "Your weekly reflection is ready"
 *   2. Today is Sunday (UTC) → hidden (cron is firing; nothing to nag about)
 *   3. Otherwise → countdown "Weekly Summary in N days"
 */
export function CeremonyPin({ status }: { status: CeremonyPinStatus | null }) {
  if (!status) return null

  if (status.latestUnviewed) {
    return (
      <Link
        href={`/ceremony/${status.latestUnviewed.id}`}
        className="block rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-4 text-[var(--warm-ink)] shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg" aria-hidden>
            ✦
          </span>
          <div>
            <p className="font-medium">Your weekly reflection is ready</p>
            <p className="mt-1 text-sm text-stone-700">
              See what you&rsquo;ve been up to {'->'}
            </p>
          </div>
        </div>
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
      ? 'Weekly Summary tomorrow'
      : `Weekly Summary in ${daysUntil} days`

  return (
    <div className="-my-2 flex items-center justify-center gap-2 text-xs font-medium tracking-[0.08em] text-[var(--tri-amber)] uppercase">
      <span aria-hidden>✦</span>
      <span>{label}</span>
    </div>
  )
}
