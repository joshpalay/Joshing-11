import type { ReactNode } from 'react'

import { GeometricProgress } from '@/components/play/GeometricProgress'

import { FeedCard } from './FeedCard'
import type { AnsweredByYouFeedItem } from './types'

type AnsweredByYouCardProps = {
  item: AnsweredByYouFeedItem
  actions?: ReactNode
  children?: ReactNode
}

function FeedProgressCircles({
  correct,
}: {
  correct: boolean | null | undefined
}) {
  return (
    <div aria-label="Feed answer progress">
      <GeometricProgress
        total={5}
        current={1}
        results={{ 1: correct ? 'correct' : 'expired' }}
      />
    </div>
  )
}

function AnsweredDetails({ item }: { item: AnsweredByYouFeedItem }) {
  return (
    <div className="rounded-xl bg-white/65 p-3 text-sm leading-6 text-stone-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-stone-900">
          {item.answerSummary ?? 'You answered this question.'}
        </p>
        <FeedProgressCircles correct={item.isCorrect} />
      </div>
      {item.submittedAnswer ? (
        <p className="mt-2">
          <span className="font-medium text-stone-900">Your answer:</span>{' '}
          {item.submittedAnswer}
        </p>
      ) : null}
      {item.correctAnswer ? (
        <p className="mt-1">
          <span className="font-medium text-stone-900">Correct answer:</span>{' '}
          {item.correctAnswer}
        </p>
      ) : null}
      {item.isCorrect && typeof item.awardedPoints === 'number' ? (
        <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-900">
          +{item.awardedPoints} points
        </p>
      ) : null}
      {item.isCorrect === false ? (
        <p className="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-stone-700">
          Added to your missed questions — you can try again for review later.
        </p>
      ) : null}
      {item.unverifiedAnswer ? (
        <p className="text-muted-foreground mt-2">LLM answer — unverified.</p>
      ) : null}
      {item.explanation ? (
        <p className="text-muted-foreground mt-2">{item.explanation}</p>
      ) : null}
    </div>
  )
}

export function AnsweredByYouCard({
  item,
  actions,
  children,
}: AnsweredByYouCardProps) {
  return (
    <FeedCard
      item={item}
      tone="gray"
      eyebrow={<span>{item.resultLabel ?? 'You answered'}</span>}
      actions={actions}
    >
      {children ?? <AnsweredDetails item={item} />}
    </FeedCard>
  )
}
