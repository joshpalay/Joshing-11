'use client'

import { MoreHorizontal, X } from 'lucide-react'
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
  // Gentle down-weight: nudge this domain to "Blue Moon" (see it rarely) instead
  // of a hard hide. Replaces the old onHideCategory per owner direction.
  onSeeLessOften?: () => void
  onHidePerson?: () => void
  // PRD-D-6 §6.6: the two problem-named items replace the old generic "Report".
  // Both require a question target, so they only render when `question` is set.
  onReportIncorrect?: () => void
  onReportInappropriate?: () => void
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
    ...(visibleCategory ? [`See questions about ${visibleCategory} less often`] : []),
    `Hide questions from ${sourceName || 'this person'}`,
    ...(hasQuestion && !isInBank ? ['Add to bank'] : []),
    ...(hasQuestion ? ['Send to friend'] : []),
    // The content-report items target a question, so they only appear when one
    // is present — same gate as Add to bank / Send to friend.
    ...(hasQuestion ? ['This is incorrect', 'This is inappropriate'] : []),
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
  onSeeLessOften,
  onHidePerson,
  onReportIncorrect,
  onReportInappropriate,
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
        className="-mr-1 flex size-9 items-center justify-center rounded-md transition hover:bg-black/5 disabled:opacity-50"
        style={{ color: 'var(--ink)' }}
      >
        <MoreHorizontal className="size-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/20 px-3 pt-16 pb-3 sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:block sm:bg-transparent sm:p-0">
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
                onClick={wrapAction(onSeeLessOften)}
              >
                See questions about {visibleCategory} less often
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
            {question ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={wrapAction(onReportIncorrect)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm transition disabled:opacity-50"
                >
                  This is incorrect
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={wrapAction(onReportInappropriate)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm transition disabled:opacity-50"
                >
                  This is inappropriate
                </button>
              </>
            ) : null}
            {children}
          </div>
        </div>
      ) : null}
    </div>
  )
}

