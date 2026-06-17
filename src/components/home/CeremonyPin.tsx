import Link from 'next/link'

export type CeremonyPinStatus = {
  nextFireAt: string
  latestUnviewed: { id: string; firedAt: string } | null
}

// One ceremonial editorial marker, in the weekly-summary visual family:
// centered, gold, uppercase, calm. No card, no border, no box, no CTA button —
// the line itself is the moment. A subtle opacity-only fade-in on first paint
// (no movement, no pulse), gated to motion-safe. When a reflection is ready the
// whole row is the tap target.
const MARKER_CLASS =
  'flex items-center justify-center gap-2 py-3 text-center text-xs font-medium tracking-[0.08em] text-[var(--accent-gold)] uppercase motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700'

/**
 * Top-of-home ceremony slot. Lifted out of FeedList so Home can render it
 * directly (above the feed) and FeedList stays focused on the playable stream.
 *
 * Single state: the calm gold marker renders ONLY when a reflection is actually
 * ready to view (an unviewed ceremony) — a tappable "Your weekly reflection is
 * ready" flanked by a star on each side. The future-state countdown promo is
 * intentionally not shown.
 */
export function CeremonyPin({ status }: { status: CeremonyPinStatus | null }) {
  if (!status?.latestUnviewed) return null

  return (
    <Link href={`/ceremony/${status.latestUnviewed.id}`} className={MARKER_CLASS}>
      <span aria-hidden>✦</span>
      <span>Your weekly reflection is ready</span>
      <span aria-hidden>✦</span>
    </Link>
  )
}
