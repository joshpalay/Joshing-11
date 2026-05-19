'use client'

import { useCallback, useState, type ReactNode } from 'react'

import { KnowledgeCircle } from '@/components/knowledge/CategoryCircles'
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles'

import { visibleFeedCategory } from './category'
import type { AnsweredByYouFeedItem, AnsweredByYouPairedFriend } from './types'
import { colorForCategory, colorForUser, initialsFor, isDarkColor } from './visual'

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

function AvatarDisc({
  initials,
  bg,
  size = 28,
  ring = false,
}: {
  initials: string
  bg: string
  size?: number
  ring?: boolean
}) {
  const onDark = isDarkColor(bg)
  return (
    <div
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full text-[10px] font-semibold"
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        color: onDark ? 'var(--cream)' : 'var(--ink)',
        boxShadow: ring ? '0 0 0 2px var(--cream)' : undefined,
      }}
    >
      {initials}
    </div>
  )
}

function AnsweredAvatarStack({
  pairedFriend,
  categoryColor,
}: {
  pairedFriend?: AnsweredByYouPairedFriend | null
  categoryColor: string
}) {
  const viewerInitials = 'You'
  if (!pairedFriend) {
    return (
      <AvatarDisc initials={viewerInitials} bg={categoryColor} size={32} />
    )
  }
  const friendColor = colorForUser(pairedFriend.userId)
  const friendInitials = initialsFor(pairedFriend.displayName)
  return (
    <div className="relative shrink-0" style={{ width: 44, height: 28 }}>
      <div className="absolute left-0 top-0">
        <AvatarDisc initials={viewerInitials} bg={categoryColor} size={28} />
      </div>
      <div className="absolute left-[16px] top-0">
        <AvatarDisc initials={friendInitials} bg={friendColor} size={28} ring />
      </div>
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
  const [recheckAccepted, setRecheckAccepted] = useState(false)

  const requestRecheck = useCallback(async () => {
    if (!recheckAction || recheckState === 'submitting') return
    setRecheckState('submitting')
    setRecheckMessage(null)
    setRecheckAccepted(false)
    try {
      const outcome = await recheckAction.onSubmit()
      setRecheckState('done')
      setRecheckMessage(outcome.message)
      setRecheckAccepted(outcome.accepted)
    } catch {
      setRecheckState('error')
      setRecheckMessage('Could not recheck that answer.')
      setRecheckAccepted(false)
    }
  }, [recheckAction, recheckState])

  const summaryClass = item.isCorrect
    ? 'text-[14px] font-medium text-emerald-700'
    : 'text-[14px] font-medium text-stone-800'

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className={summaryClass}>
          {item.answerSummary ?? 'You answered this question.'}
        </p>
        {item.isCorrect ? <KnowledgeGainIndicator item={item} /> : null}
      </div>
      {!item.isCorrect && item.correctAnswer ? (
        <p
          className="text-[13px] italic"
          style={{
            fontFamily: 'var(--font-literata)',
            color: 'var(--ink)',
            opacity: 0.7,
          }}
        >
          {item.correctAnswer}
        </p>
      ) : null}
      {!item.isCorrect && item.quip ? (
        <p
          className="text-[13px]"
          style={{ color: 'var(--ink)', opacity: 0.6 }}
        >
          {item.quip}
        </p>
      ) : null}
      {recheckAction && recheckState !== 'done' ? (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => void requestRecheck()}
            disabled={recheckState === 'submitting'}
            className="inline-flex items-center border-[1.5px] border-[var(--ink)] bg-[var(--cream)] px-[8px] py-[4px] text-[12px] text-[var(--ink)] transition-transform hover:translate-x-[1px] hover:translate-y-[1px] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-default disabled:opacity-60"
            style={{ boxShadow: '3px 3px 0 var(--ink)' }}
          >
            {recheckState === 'submitting' ? 'Rechecking...' : 'Recheck →'}
          </button>
        </div>
      ) : null}
      {recheckMessage ? (
        recheckAccepted ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium"
            style={{
              backgroundColor: 'color-mix(in srgb, #047857 10%, var(--cream))',
              borderColor: 'color-mix(in srgb, #047857 35%, var(--border-warm))',
              color: '#065f46',
            }}
          >
            <span aria-hidden className="text-[15px] leading-none">✓</span>
            <span>{recheckMessage}</span>
          </div>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="text-[11px]"
            style={{
              color: recheckState === 'error' ? '#b91c1c' : 'var(--ink)',
              opacity: recheckState === 'error' ? 1 : 0.6,
            }}
          >
            {recheckMessage}
          </p>
        )
      ) : null}
    </div>
  )
}

export function AnsweredByYouCard({ item, recheckAction, overflow }: AnsweredByYouCardProps) {
  const category = visibleFeedCategory(item.category)
  const categoryColor = colorForCategory(item.category)

  return (
    <article className="relative overflow-hidden rounded-2xl border border-[var(--border-warm)] bg-[var(--cream)]">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ backgroundColor: categoryColor }}
      />
      <div className="p-[14px]">
        <div className="flex items-center gap-3">
          <AnsweredAvatarStack
            pairedFriend={item.pairedFriend}
            categoryColor={categoryColor}
          />

          <div className="min-w-0 flex-1">
            <p
              className="text-[11px] uppercase leading-none tracking-[0.08em]"
              style={{ color: 'var(--ink)', opacity: 0.7 }}
            >
              You answered
            </p>
            {category ? (
              <p
                className="mt-1 truncate text-[12px] italic leading-tight"
                style={{
                  fontFamily: 'var(--font-literata)',
                  color: 'var(--ink)',
                  opacity: 0.7,
                }}
              >
                {category}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {item.timestamp ? (
              <span
                className="text-[11px] leading-none"
                style={{ color: 'var(--ink)', opacity: 0.6 }}
              >
                {item.timestamp}
              </span>
            ) : null}
            {overflow ? overflow : null}
          </div>
        </div>

        <p
          className="mt-3 text-[16px] leading-snug"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: 'var(--ink)',
            opacity: 0.65,
          }}
        >
          &ldquo;{item.question}&rdquo;
        </p>

        {item.personalMessage ? (
          <p
            className="mt-2 text-[13px] italic leading-snug"
            style={{
              fontFamily: 'var(--font-literata)',
              color: 'var(--ink)',
              opacity: 0.65,
            }}
          >
            {item.personalMessage}
          </p>
        ) : null}

        <div className="mt-3 border-t border-[var(--border-light)] pt-3">
          <AnsweredResult item={item} recheckAction={recheckAction} />
        </div>
      </div>
    </article>
  )
}
