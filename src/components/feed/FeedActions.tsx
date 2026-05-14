'use client'

import { MoreHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'

export type UnansweredFeedActionsProps = {
  onAnswer: () => void
  disabled?: boolean
  onDismiss?: () => void
}

export function UnansweredFeedActions({
  onAnswer,
  disabled = false,
  onDismiss,
}: UnansweredFeedActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={onAnswer}
        disabled={disabled}
        className="bg-stone-950 text-white hover:bg-stone-800"
      >
        Answer
      </Button>
      <div className="relative">
        <details className="group">
          <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg border border-stone-300 bg-white/70 text-stone-700 transition hover:bg-white [&::-webkit-details-marker]:hidden">
            <MoreHorizontal className="size-4" aria-label="More options" />
          </summary>
          <div className="absolute right-0 z-10 mt-2 min-w-32 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                disabled={disabled}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
              >
                Dismiss
              </button>
            ) : (
              <p className="text-muted-foreground px-2 py-1.5 text-sm">
                More soon
              </p>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}

export type AnswerFormProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  disabled?: boolean
}

export function AnswerForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
}: AnswerFormProps) {
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <input
        className="min-h-11 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Your answer..."
        disabled={disabled}
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          disabled={disabled || !value.trim()}
          className="bg-stone-950 text-white hover:bg-stone-800"
        >
          Submit answer
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="px-2 text-sm font-medium text-sky-700 hover:underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
