import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type FeedActionLinkProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * 'lg' (default) — the primary action (Answer → / Try again →). 14px sans
   * medium, matching the Today's Five card's link treatment (TodaysFiveCard's
   * "See today's recap" link) so every inline link reads the same.
   * 'sm' — the quiet 13px sans secondary action (Play these → / View N more).
   */
  size?: 'lg' | 'sm'
}

/**
 * The feed's primary inline action (Answer → / Try again → / Recheck →).
 *
 * Standardizes what used to be three hand-rolled text buttons across FeedCard,
 * SparkleEnvelope, and AnsweredByYouCard: one 14px sans link size (matching the
 * Today's Five card), a 44px minimum tap target (`min-h-11`), a visible keyboard
 * `focus-visible` ring, and a consistent active/disabled treatment. The face is
 * the sans (Montserrat): a link is something you act on (Interface voice), so it
 * never takes the Editorial serif — see _docs/STYLE-GUIDE-TYPE.md §3. Renders a
 * real <button>, so callers just pass `onClick`, `disabled`, and the label as
 * children. The 'sm' size is the secondary register ("View N more") at 13px.
 */
export function FeedActionLink({ className, type, size = 'lg', ...props }: FeedActionLinkProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex min-h-11 items-center text-[var(--brand-link)] underline underline-offset-4 transition',
        size === 'lg'
          ? 'text-sm font-medium'
          : 'text-quiet font-medium tracking-normal',
        'hover:opacity-70 active:opacity-90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-card)]',
        'disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
