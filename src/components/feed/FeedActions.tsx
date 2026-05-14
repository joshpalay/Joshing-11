'use client'

import { Flag, MoreHorizontal, X } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { AddToBankAction } from '@/components/AddToBankAction'
import { SendQuestionAction } from '@/components/SendQuestionAction'
import { Button } from '@/components/ui/button'
import { visibleFeedCategory } from './category'

export type FeedOverflowQuestion = {
  id: string
  text: string
  domain?: string | null
}

export type FeedOverflowMenuProps = {
  sourceName: string
  category?: string | null
  question?: FeedOverflowQuestion | null
  isInBank?: boolean
  disabled?: boolean
  onHideCategory?: () => void
  onHidePerson?: () => void
  onReport?: () => void
  children?: ReactNode
}

export function getFeedOverflowMenuLabels({
  sourceName,
  category,
  hasQuestion,
  isInBank = false,
}: {
  sourceName: string
  category?: string | null
  hasQuestion: boolean
  isInBank?: boolean
}) {
  const visibleCategory = visibleFeedCategory(category)
  return [
    ...(visibleCategory ? ['Hide this category'] : []),
    `Hide questions from ${sourceName || 'this person'}`,
    ...(hasQuestion && !isInBank ? ['Add to bank'] : []),
    ...(hasQuestion ? ['Send to friend'] : []),
    'Report',
  ]
}

function MenuButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="text-foreground hover:bg-muted flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function FeedOverflowMenu({
  sourceName,
  category,
  question,
  isInBank = false,
  disabled = false,
  onHideCategory,
  onHidePerson,
  onReport,
  children,
}: FeedOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const visibleCategory = visibleFeedCategory(category)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const firstMenuItem = menuRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
    firstMenuItem?.focus()
  }, [open])

  const closeMenu = () => {
    setOpen(false)
  }

  const wrapAction = (action?: () => void) => {
    if (!action) return undefined
    return () => {
      action()
      closeMenu()
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More Feed actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-lg border border-stone-300 bg-white/70 text-stone-700 transition hover:bg-white disabled:opacity-50"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 px-3 pt-16 pb-3 sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:block sm:bg-transparent sm:p-0">
          <button
            className="absolute inset-0 cursor-default sm:hidden"
            type="button"
            aria-label="Close Feed actions"
            onClick={closeMenu}
          />
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label="More Feed actions"
            onKeyDown={handleMenuKeyDown}
            className="bg-background relative w-full max-w-md rounded-3xl border p-2 shadow-2xl sm:w-72 sm:rounded-2xl sm:shadow-xl"
          >
            <div className="flex items-center justify-between px-3 py-2 sm:hidden">
              <p className="text-foreground text-sm font-medium">
                More actions
              </p>
              <button
                type="button"
                aria-label="Close menu"
                onClick={closeMenu}
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-11 items-center justify-center rounded-full"
              >
                <X className="size-4" />
              </button>
            </div>
            {visibleCategory ? (
              <MenuButton
                disabled={disabled}
                onClick={wrapAction(onHideCategory)}
              >
                Hide this category
              </MenuButton>
            ) : null}
            <MenuButton disabled={disabled} onClick={wrapAction(onHidePerson)}>
              Hide questions from {sourceName || 'this person'}
            </MenuButton>
            {question && !isInBank ? (
              <AddToBankAction
                questionId={question.id}
                initialInBank={false}
                contextType="feed"
                label="Add to bank"
                className="hover:bg-muted flex min-h-10 w-full justify-start rounded-xl border-0 px-3 text-left text-sm"
              />
            ) : null}
            {question ? (
              <SendQuestionAction
                question={{
                  id: question.id,
                  text: question.text,
                  domain: question.domain ?? '',
                }}
                label="Send to friend"
                className="text-foreground hover:bg-muted flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm transition"
              />
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={wrapAction(onReport)}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition disabled:opacity-50"
            >
              <Flag className="size-4" />
              Report
            </button>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export type UnansweredFeedActionsProps = {
  onAnswer: () => void
  disabled?: boolean
  overflow: ReactNode
}

export function UnansweredFeedActions({
  onAnswer,
  disabled = false,
  overflow,
}: UnansweredFeedActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={onAnswer}
        disabled={disabled}
        aria-label="Answer this Feed question"
        className="bg-stone-950 text-white hover:bg-stone-800"
      >
        Answer
      </Button>
      {overflow}
    </div>
  )
}

export type AnswerFormProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  disabled?: boolean
  loading?: boolean
}

export function AnswerForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
  loading = false,
}: AnswerFormProps) {
  const answerInputId = useId()

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <label
          htmlFor={answerInputId}
          className="text-sm font-medium text-stone-800"
        >
          Your answer
        </label>
        <input
          id={answerInputId}
          aria-label="Your answer"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 disabled:cursor-not-allowed disabled:opacity-60"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Your answer..."
          disabled={disabled || loading}
        />
      </div>
      <div className="flex items-end gap-2">
        <Button
          type="submit"
          disabled={disabled || loading || !value.trim()}
          aria-disabled={disabled || loading || !value.trim()}
          className="bg-stone-950 text-white hover:bg-stone-800"
        >
          {loading ? 'Submitting...' : 'Submit answer'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled || loading}
          className="px-2 pb-2 text-sm font-medium text-sky-700 hover:underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
