'use client'

import { useCallback, useState, type ReactNode } from 'react'

import { answerHeadingStyle } from '@/components/answer-heading'
import { CreatorNote, pickCreatorNote } from '@/components/CreatorNote'
import { KnowledgeCircle } from '@/components/knowledge/CategoryCircles'
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles'
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy'
import type { MasteryTier } from '@/types/db'

import { visibleFeedCategory } from './category'
import { FeedActionLink } from './FeedActionLink'
import { FeedCardShell } from './FeedCardShell'
import type { AnsweredByYouFeedItem, AnsweredByYouPairedFriend } from './types'
import { colorForCategory, colorForUser, initialsFor, isDarkColor } from './visual'

function tierLabel(tier: string): string {
  const normalized = tier.toLowerCase() as MasteryTier
  return KNOWLEDGE_TIER_LABEL[normalized] ?? tier
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
  // Optional retry handler for direct_sent wrong answers — opens the answer
  // sheet so the recipient can take another swing without leaving the feed.
  onRetry?: () => void
  overflow?: ReactNode
}

function AnsweredResult({
  item,
  recheckAction,
  onRetry,
}: {
  item: AnsweredByYouFeedItem
  recheckAction?: FeedRecheckAction | null
  onRetry?: () => void
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

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p
          className="text-sm font-medium"
          style={{ color: item.isCorrect ? 'var(--game-correct)' : 'var(--brand-ink)' }}
        >
          {item.answerSummary ?? 'You answered this question.'}
        </p>
        {item.isCorrect ? <KnowledgeGainIndicator item={item} /> : null}
      </div>
      {item.correctAnswer ? (
        <p
          style={{
            ...answerHeadingStyle,
            color: item.isCorrect ? 'var(--game-correct)' : 'var(--brand-ink)',
          }}
        >
          {item.correctAnswer}
        </p>
      ) : null}
      {(() => {
        const note = pickCreatorNote({
          isHuman: Boolean(item.authorName) && !item.authorIsHouse,
          authorName: item.authorName,
          creatorNote: item.creatorNote,
        })
        return note ? (
          <CreatorNote text={note.text} provenance={note.provenance} style={{ marginTop: 6 }} />
        ) : null
      })()}
      {(onRetry || (recheckAction && recheckState !== 'done')) ? (
        <div className="flex items-center justify-end gap-4 pt-2">
          {onRetry ? (
            <FeedActionLink onClick={onRetry}>Try again →</FeedActionLink>
          ) : null}
          {recheckAction && recheckState !== 'done' ? (
            <FeedActionLink
              onClick={() => void requestRecheck()}
              disabled={recheckState === 'submitting'}
            >
              {recheckState === 'submitting' ? 'Rechecking…' : 'Recheck →'}
            </FeedActionLink>
          ) : null}
        </div>
      ) : null}
      {recheckMessage ? (
        recheckAccepted ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-quiet font-medium"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--game-correct) 12%, var(--cream))',
              borderColor: 'color-mix(in srgb, var(--game-correct) 35%, var(--border-warm))',
              color: 'var(--game-correct)',
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
              color: recheckState === 'error' ? 'var(--game-wrong-strong)' : 'var(--ink)',
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

export function AnsweredByYouCard({ item, recheckAction, onRetry, overflow }: AnsweredByYouCardProps) {
  const category = visibleFeedCategory(item.category)
  const categoryColor = colorForCategory(item.category, item.broadCategory)

  return (
    <FeedCardShell accentColor={categoryColor} accentPlacement="left">
      <div
        className="px-3.5 pt-3.5 pb-3"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--ink) 5%, var(--cream))',
        }}
      >
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
                className="mt-1 truncate text-xs italic leading-tight"
                style={{
                  fontFamily: 'var(--font-serif)',
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
          className="mt-3 text-base leading-snug"
          style={{
            fontFamily: 'var(--font-serif)',
            color: 'var(--ink)',
            opacity: 0.65,
          }}
        >
          &ldquo;{item.question}&rdquo;
        </p>

        {item.personalMessage ? (
          <p
            className="mt-2 text-quiet italic leading-snug"
            style={{
              fontFamily: 'var(--font-serif)',
              color: 'var(--ink)',
              opacity: 0.65,
            }}
          >
            {item.personalMessage}
          </p>
        ) : null}
      </div>

      <div className="px-3.5 py-3">
        <AnsweredResult item={item} recheckAction={recheckAction} onRetry={onRetry} />
      </div>
    </FeedCardShell>
  )
}
