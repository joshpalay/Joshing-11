import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type FeedDismissButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

/**
 * The quiet, secondary dismiss control on an unanswered question card, sitting
 * bottom-left opposite the primary "Answer →" (FeedActionLink). Deliberately
 * lighter than Answer — a muted-foreground text label, no underline — so it
 * stays discoverable without competing. The consequence of pressing it is the
 * caller's concern: on the From Friends streak card (dismiss-as-answered) it
 * consumes and persists the question; elsewhere it may be view-state only.
 */
export function FeedDismissButton({ className, type, ...props }: FeedDismissButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'text-muted-foreground inline-flex min-h-11 items-center text-sm font-medium transition',
        'hover:opacity-70 active:opacity-90',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none focus-visible:ring-2',
        'disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      {...props}
    >
      Dismiss
    </button>
  )
}
