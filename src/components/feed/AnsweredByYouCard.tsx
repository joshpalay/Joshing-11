'use client'

import { useCallback, useState, type ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import { visibleFeedCategory } from './category'
import type { AnsweredByYouFeedItem } from './types'

export type FeedRecheckAction = {
  onSubmit: () => Promise<{ accepted: boolean; message: string }>
}

type AnsweredByYouCardProps = {
  item: AnsweredByYouFeedItem
  recheckAction?: FeedRecheckAction | null
  overflow?: ReactNode
}

function AnsweredResult({
  item,
  recheckAction,
}: {
  item: AnsweredByYouFeedItem
  recheckAction?: FeedRecheckAction | null
}) {
  const [recheckState, setRecheckState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null)

  const requestRecheck = useCallback(async () => {
    if (!recheckAction || recheckState === 'submitting') return
    setRecheckState('submitting')
    setRecheckMessage(null)
    try {
      const outcome = await recheckAction.onSubmit()
      setRecheckState('done')
      setRecheckMessage(outcome.message)
    } catch {
      setRecheckState('error')
      setRecheckMessage('Could not recheck that answer.')
    }
  }, [recheckAction, recheckState])

  const marker = item.isCorrect ? '✓' : '✗'
  const markerClass = item.isCorrect ? 'text-emerald-700' : 'text-stone-500'
  const summaryClass = item.isCorrect
    ? 'text-sm font-medium text-emerald-700'
    : 'text-sm font-medium text-stone-800'

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className={summaryClass}>
          <span className={markerClass}>{marker}</span>{' '}
          {item.answerSummary ?? 'You answered this question.'}
        </p>
        {item.isCorrect && typeof item.awardedPoints === 'number' ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            +{item.awardedPoints} pts
          </span>
        ) : null}
      </div>
      {!item.isCorrect && item.correctAnswer ? (
        <p className="text-sm text-stone-500 italic">{item.correctAnswer}</p>
      ) : null}
      {!item.isCorrect && item.quip ? (
        <p className="text-sm text-stone-500">{item.quip}</p>
      ) : null}
      {recheckAction && recheckState !== 'done' ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => void requestRecheck()}
            disabled={recheckState === 'submitting'}
            className="rounded-full border border-stone-300 bg-white px-3 py-1 font-mono text-xs uppercase tracking-wide text-stone-600 hover:bg-stone-50 disabled:cursor-default disabled:opacity-60"
          >
            {recheckState === 'submitting' ? 'Rechecking...' : 'Recheck my answer'}
          </button>
        </div>
      ) : null}
      {recheckMessage ? (
        <p className={`text-xs ${recheckState === 'error' ? 'text-red-600' : 'text-stone-500'}`}>
          {recheckMessage}
        </p>
      ) : null}
    </div>
  )
}

export function AnsweredByYouCard({ item, recheckAction, overflow }: AnsweredByYouCardProps) {
  const category = visibleFeedCategory(item.category)
  const categoryClause = category ? <> about {category}</> : null
  const socialSignal: ReactNode = <>You answered this{categoryClause}.</>

  return (
    <FeedCard
      item={item}
      tone={item.isCorrect ? 'green' : 'gray'}
      socialSignal={socialSignal}
      overflow={overflow}
      resultContent={<AnsweredResult item={item} recheckAction={recheckAction} />}
    />
  )
}
