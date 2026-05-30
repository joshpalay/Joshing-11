'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { visibleFeedCategory } from './category'

type AnswerSheetProps = {
  question: string
  category?: string | null
  onSubmit: (answer: string) => void
  onClose: () => void
  loading?: boolean
}

export function AnswerSheet({
  question,
  category,
  onSubmit,
  onClose,
  loading = false,
}: AnswerSheetProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const visibleCategory = visibleFeedCategory(category)

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || loading) return
    onSubmit(trimmed)
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Dismiss"
      />
      <div className="relative w-full max-w-lg rounded-t-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          {visibleCategory ? (
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] uppercase text-stone-500">
              {visibleCategory.toUpperCase()}
            </p>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="px-5 pb-5 font-serif text-xl leading-8 text-stone-950">
          {question}
        </p>

        <form onSubmit={handleSubmit} className="px-5 pb-8">
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your answer…"
            disabled={loading}
            autoComplete="off"
            className="w-full min-h-11 rounded-xl border border-stone-300 bg-stone-50 px-4 text-base outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
          >
            {loading ? 'Submitting…' : 'Submit answer'}
          </button>
        </form>
      </div>
    </div>
  )
}
