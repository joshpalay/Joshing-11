import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type FeedActionLinkProps = ButtonHTMLAttributes<HTMLButtonElement>

/**
 * The feed's primary inline action (Answer → / Try again → / Recheck →).
 *
 * Standardizes what used to be three hand-rolled text buttons across FeedCard,
 * SparkleEnvelope, and AnsweredByYouCard: one 18px serif size, a 44px minimum
 * tap target (`min-h-11`), a visible keyboard `focus-visible` ring, and a
 * consistent active/disabled treatment. Renders a real <button>, so callers
 * just pass `onClick`, `disabled`, and the label as children.
 */
export function FeedActionLink({ className, type, ...props }: FeedActionLinkProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex min-h-11 items-center font-serif text-[18px] font-semibold tracking-[0.05em] text-[var(--brand-link)] underline underline-offset-4 transition',
        'hover:opacity-70 active:opacity-90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-card)]',
        'disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
