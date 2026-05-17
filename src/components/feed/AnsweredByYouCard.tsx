'use client'

import { useCallback, useState, type ReactNode } from 'react'

import { KnowledgeCircle } from '@/components/knowledge/CategoryCircles'
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles'

import { FeedCard } from './FeedCard'
import { visibleFeedCategory } from './category'
import type { AnsweredByYouFeedItem } from './types'

const TIER_LABEL: Record<string, string> = {
  establishing: 'Establishing',
  familiar: 'Familiar',
  solid: 'Solid',
  mastery: 'Mastery',
}

function tierLabel(tier: string): string {
  return TIER_LABEL[tier.toLowerCase()] ?? tier
}

function KnowledgeGainIndicator({ item }: { item: AnsweredByYouFeedItem }) {
  const broad = item.broadCategory ?? item.category ?? 'General'
  const tooltipArea = visibleFeedCategory(item.category) ?? broad
  const dc = getPortraitDomainColor(broad)
  const tierChanged = Boolean(item.masteryDelta?.tierChanged)
  const tierLine = tierChanged && item.masteryDelta
    ? `${tierLabel(item.masteryDelta.previousTier)} → ${tierLabel(item.masteryDelta.newTier)}`
    : null

  return (
    <div
      className="flex shrink-0 flex-col items-end gap-1"
      title={`+ Knowledge in ${tooltipArea}`}
      aria-label={`Knowledge gained in ${tooltipArea}${tierLine ? `, ${tierLine}` : ''}`}
    >
      <KnowledgeCircle
        broadCategory={broad}
        pointsAfter={1}
        maxPoints={1}
        animate
        size={28}
      />
      {tierLine ? (
        <span
          className="font-mono text-[9px] uppercase tracking-[0.1em]"
          style={{ color: dc.primary }}
        >
          {tierLine}
        </span>
      ) : null}
    </div>
  )
}

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
        {item.isCorrect ? <KnowledgeGainIndicator item={item} /> : null}
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
