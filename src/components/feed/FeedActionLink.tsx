import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type FeedActionLinkProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * 'lg' (default) — the 18px sans primary action (Answer → / Try again →).
   * 'sm' — the quiet 13px sans secondary action (Play these → / View N more).
   */
  size?: 'lg' | 'sm'
}

/**
 * The feed's primary inline action (Answer → / Try again → / Recheck →).
 *
 * Standardizes what used to be three hand-rolled text buttons across FeedCard,
 * SparkleEnvelope, and AnsweredByYouCard: one 18px sans size, a 44px minimum
 * tap target (`min-h-11`), a visible keyboard `focus-visible` ring, and a
 * consistent active/disabled treatment. The face is the sans (Montserrat): a
 * link is something you act on (Interface voice), so it never takes the
 * Editorial serif — see _docs/STYLE-GUIDE-TYPE.md §3. Renders a real <button>,
 * so callers just pass `onClick`, `disabled`, and the label as children. The
 * 'sm' size is the secondary register (territory-card CTA, "View N more") at 13px.
 */
export function FeedActionLink({ className, type, size = 'lg', ...props }: FeedActionLinkProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex min-h-11 items-center text-[var(--brand-link)] underline underline-offset-4 transition',
        size === 'lg'
          ? 'text-lg font-semibold tracking-[0.05em]'
          : 'text-[13px] font-medium tracking-[0.04em]',
        'hover:opacity-70 active:opacity-90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-card)]',
        'disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
